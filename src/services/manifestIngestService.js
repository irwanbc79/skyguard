const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const Manifest = require("../models/Manifest");
const {
  getFileType,
  detectAndParseText,
  classifyByFilename,
  parseXLSXManifest,
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
    const { extractPdfText } = require("../utils/helpers");
    return await extractPdfText(buffer);
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
  const isExcel = ["xls", "xlsx"].includes(fileType);

  let parsed = null;

  if (isTextBased) {
    const rawText = await extractText(buffer, fileType);
    parsed = detectAndParseText(rawText, filename);
  } else if (isExcel) {
    // Parse XLS/XLSX using xlsx package
    try {
      parsed = parseXLSXManifest(buffer, filename);
    } catch (err) {
      console.warn(`[Manifest Ingest] Excel parse gagal: ${err.message}`);
    }
  }

  if (parsed) {
    manifest.parsed_fields = {
      format: parsed.format,
      segments: parsed.segments || [],
      passengers: parsed.passengers || [],
      no_shows: parsed.no_shows || [],
      totals: parsed.totals || null,
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
      manifest.parsing_notes = isExcel
        ? `Format Excel (${fileType}) tidak berhasil di-parsing. Perlu review manual.`
        : isTextBased
          ? `Format tidak dikenali (${fileType}). Perlu review manual.`
          : `Format ${fileType} tidak didukung untuk parsing otomatis.`;
    }
  }

  await manifest.save();

  // === AUTO-SYNC: Write passengers to manifest_passengers immediately ===
  if (manifest.status === "parsed") {
    try {
      const ManifestPassenger = require("../models/ManifestPassenger");
      const p = manifest.parsed_fields || {};
      const hasFlatPax = (p.passengers || []).length > 0;
      const hasSegPax = (p.segments || []).some(
        (s) => (s.passengers || []).length > 0 || (s.no_shows || []).length > 0,
      );
      if (hasFlatPax || hasSegPax) {
        const buildDoc = (px, defaultStatus, segIdx) => ({
          manifest_id: manifest._id,
          flight_number: manifest.flight_number,
          flight_date: manifest.flight_date,
          segment_index: segIdx,
          status: px.status || defaultStatus,
          name: px.name,
          level: px.level || null,
          pnr: px.pnr || null,
          fare_class: px.fare_class || null,
          seq_no: px.seq_no || null,
          travel_date: px.travel_date || null,
          seat_no: px.seat_no || null,
          destination_code: px.destination_code || null,
          flight_no: px.flight_no || null,
          raw_line: px.raw_line || null,
          passport_number: px.passport_number || null,
          nationality: px.nationality || null,
          gender: px.gender || null,
          date_of_birth: px.date_of_birth || null,
          passport_expiry: px.passport_expiry || null,
          doc_type: px.doc_type || null,
          bag_weight: px.bag_weight || null,
          ticket_number: px.ticket_number || null,
          pax_type: px.pax_type || null,
        });
        const docs = [];
        if (hasFlatPax) {
          (p.passengers || []).forEach((px) => docs.push(buildDoc(px, "checked_in", 0)));
          (p.no_shows || []).forEach((px) => docs.push(buildDoc(px, "no_show", 0)));
        }
        if (hasSegPax) {
          (p.segments || []).forEach((seg, idx) => {
            (seg.passengers || []).forEach((px) => docs.push(buildDoc(px, "checked_in", idx)));
            (seg.no_shows || []).forEach((px) => docs.push(buildDoc(px, "no_show", idx)));
          });
        }
        if (docs.length) {
          await ManifestPassenger.deleteMany({ manifest_id: manifest._id });
          await ManifestPassenger.insertMany(docs);
          manifest.status = "synced";
          await manifest.save();
          console.log(`[Manifest Ingest] Auto-synced ${docs.length} pax: ${manifest.filename}`);
        }
      }
    } catch (e) {
      console.error("[Manifest Ingest] Auto-sync error:", e.message);
    }
  }

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
