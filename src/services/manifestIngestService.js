const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const Manifest = require("../models/Manifest");
const {
  getFileType,
  detectAndParseText,
  classifyByFilename,
} = require("./manifestService");
const { notifyManifestReceived } = require("./notificationService");

const MANIFEST_DIR = path.join(__dirname, "../../uploads/manifests");

function ensureManifestDir() {
  if (!fs.existsSync(MANIFEST_DIR)) {
    fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  }
}

function buildFilePath(filename) {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(MANIFEST_DIR, `${Date.now()}_${sanitized}`);
}

async function extractText(buffer, fileType) {
  if (fileType === "pdf") {
    try {
      const pdfParse = require("pdf-parse");
      const data = await pdfParse(buffer);
      return data.text || "";
    } catch (err) {
      console.warn("[Manifest Ingest] PDF parse gagal:", err.message);
      return "";
    }
  }
  if (fileType === "docx") {
    try {
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return result.value || "";
    } catch (err) {
      console.warn("[Manifest Ingest] DOCX parse gagal:", err.message);
      return "";
    }
  }
  return buffer.toString("utf-8");
}

async function createManifestFromFile({
  buffer,
  filename,
  source,
  uploadedBy,
  sender,
  emailSubject,
  filePath,
}) {
  const fileType = getFileType(filename);
  const manifest = new Manifest({
    filename,
    file_path: filePath,
    file_type: fileType,
    source,
    uploaded_by: uploadedBy,
    sender,
    email_subject: emailSubject,
    status: "received",
  });

  const isTextBased = ["txt", "csv", "pdf", "docx"].includes(fileType);

  if (isTextBased) {
    const rawText = await extractText(buffer, fileType);
    const parsed = detectAndParseText(rawText, filename);

    if (parsed) {
      manifest.parsed_fields = {
        format: parsed.format,
        segments: parsed.segments || [],
        passengers: parsed.passengers || [],
        no_shows: parsed.no_shows || [],
      };
      manifest.status = "parsed";
      manifest.flight_number = parsed.flight_number || null;
      manifest.flight_date = parsed.flight_date || null;
      manifest.origin = parsed.origin || null;
      manifest.destination = parsed.destination || null;
      manifest.carrier = parsed.carrier || null;
    } else {
      // Try filename-based classification for non-manifest docs
      const docClass = classifyByFilename(filename);
      if (docClass) {
        manifest.status = "classified";
        manifest.parsing_notes = `Dokumen operasional: ${docClass}. Bukan manifest penumpang.`;
        manifest.parsed_fields = { format: docClass, doc_type: docClass };
      } else {
        manifest.status = "needs_review";
        manifest.parsing_notes = `Format tidak dikenali (${fileType}). Perlu review manual.`;
      }
    }
  } else {
    // For unsupported file types, try filename classification first
    const docClass = classifyByFilename(filename);
    if (docClass) {
      manifest.status = "classified";
      manifest.parsing_notes = `Dokumen operasional: ${docClass}. Bukan manifest penumpang.`;
      manifest.parsed_fields = { format: docClass, doc_type: docClass };
    } else {
      manifest.status = "needs_review";
      manifest.parsing_notes = `Format ${fileType} tidak didukung untuk parsing otomatis.`;
    }
  }

  await manifest.save();

  // === AUTO-NOTIFY: New manifest received ===
  try {
    await notifyManifestReceived(manifest);
  } catch (e) {
    console.error("[Manifest Ingest] Notification error:", e.message);
  }

  return manifest;
}

async function ingestManifest({
  buffer,
  filename,
  source = "manual",
  uploadedBy = "system",
  sender = null,
  emailSubject = null,
}) {
  ensureManifestDir();
  const filePath = buildFilePath(filename);
  await fsp.writeFile(filePath, buffer);
  try {
    return await createManifestFromFile({
      buffer,
      filename,
      source,
      uploadedBy,
      sender,
      emailSubject,
      filePath,
    });
  } catch (err) {
    // Cleanup file if DB save failed
    try {
      await fsp.unlink(filePath);
    } catch (_) {}
    throw err;
  }
}

module.exports = {
  ingestManifest,
  createManifestFromFile,
};
