const fs = require('fs');
const path = require('path');
const Manifest = require('../models/Manifest');
const { buildManifestSummary, getFileType, parseManifestAuto } = require('./manifestService');

const MANIFEST_DIR = path.join(__dirname, '../../uploads/manifests');

function ensureManifestDir() {
  if (!fs.existsSync(MANIFEST_DIR)) {
    fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  }
}

function buildFilePath(filename) {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(MANIFEST_DIR, `${Date.now()}_${sanitized}`);
}

async function createManifestFromFile({ buffer, filename, source, uploadedBy, sender, emailSubject, filePath }) {
  const fileType = getFileType(filename);
  const manifest = new Manifest({
    filename,
    file_path: filePath,
    file_type: fileType,
    source,
    uploaded_by: uploadedBy,
    sender,
    email_subject: emailSubject,
    status: 'received'
  });

  if (fileType === 'txt') {
    const text = buffer.toString('utf-8');
    const segments = parseManifestAuto(text);
    const summary = buildManifestSummary(segments);
    manifest.parsed_fields = { segments };
    manifest.status = segments.length ? 'parsed' : 'needs_review';
    manifest.flight_number = summary.flight_number;
    manifest.flight_date = summary.flight_date;
    manifest.origin = summary.origin;
    manifest.destination = summary.destination;
    manifest.carrier = summary.carrier;
  } else {
    manifest.status = 'needs_review';
  }

  await manifest.save();
  return manifest;
}

async function ingestManifest({ buffer, filename, source = 'manual', uploadedBy = 'system', sender = null, emailSubject = null }) {
  // Tolak file APIS — bukan manifest penumpang
  if (/^apis[\s_-]?\d+/i.test(filename.trim())) {
    throw Object.assign(
      new Error('File ini adalah data APIS, bukan manifest penumpang. File APIS (apis XXX.txt) akan otomatis dibaca saat sync manifest utama.'),
      { code: 'APIS_FILE_REJECTED' }
    );
  }

  ensureManifestDir();
  const filePath = buildFilePath(filename);
  fs.writeFileSync(filePath, buffer);
  return createManifestFromFile({
    buffer,
    filename,
    source,
    uploadedBy,
    sender,
    emailSubject,
    filePath
  });
}

module.exports = {
  ingestManifest,
  createManifestFromFile
};
