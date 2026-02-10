const fs = require('fs');
const path = require('path');
const Manifest = require('../models/Manifest');
const ManifestPassenger = require('../models/ManifestPassenger');
const { ingestManifest, createManifestFromFile } = require('../services/manifestIngestService');

async function listManifests(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const manifests = await Manifest.find().sort({ createdAt: -1 }).limit(limit);
    res.json({ status: 'ok', data: manifests });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

async function getManifestDetail(req, res) {
  try {
    const manifest = await Manifest.findById(req.params.id);
    if (!manifest) return res.status(404).json({ status: 'error', message: 'Manifest tidak ditemukan' });
    res.json({ status: 'ok', data: manifest });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

async function uploadManifest(req, res) {
  try {
    if (!req.file) return res.status(400).json({ status: 'error', message: 'File tidak ditemukan' });
    const uploadedBy = req.body.uploaded_by || 'manual';
    const manifest = await ingestManifest({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      source: 'manual',
      uploadedBy
    });
    res.json({ status: 'ok', data: manifest });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

async function updateManifestStatus(req, res) {
  try {
    const { status, parsing_notes } = req.body;
    const allowed = ['approved', 'rejected', 'needs_review'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ status: 'error', message: 'Status tidak valid' });
    }
    const manifest = await Manifest.findByIdAndUpdate(
      req.params.id,
      { status, parsing_notes },
      { new: true }
    );
    if (!manifest) return res.status(404).json({ status: 'error', message: 'Manifest tidak ditemukan' });
    res.json({ status: 'ok', data: manifest });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

async function syncManifestPassengers(req, res) {
  try {
    const manifest = await Manifest.findById(req.params.id);
    if (!manifest) return res.status(404).json({ status: 'error', message: 'Manifest tidak ditemukan' });
    // Allow re-sync even if already synced
    const segments = manifest.parsed_fields?.segments || [];
    if (!segments.length) {
      return res.status(400).json({ status: 'error', message: 'Manifest belum diparse atau tidak ada penumpang' });
    }

    const docs = [];
    segments.forEach((segment, index) => {
      const passengers = segment.passengers || [];
      passengers.forEach((p) => {
        docs.push({
          manifest_id: manifest._id,
          flight_number: segment.flight_number,
          flight_date: segment.flight_date,
          segment_index: index,
          status: 'checked_in',
          name: p.name,
          level: p.level,
          pnr: p.pnr,
          fare_class: p.fare_class,
          seq_no: p.seq_no,
          travel_date: p.travel_date,
          seat_no: p.seat_no,
          destination_code: p.destination_code,
          flight_no: p.flight_no,
          raw_line: p.raw_line
        });
      });
      const noShows = segment.no_shows || [];
      noShows.forEach((p) => {
        docs.push({
          manifest_id: manifest._id,
          flight_number: segment.flight_number,
          flight_date: segment.flight_date,
          segment_index: index,
          status: 'no_show',
          name: p.name,
          level: p.level,
          pnr: p.pnr,
          fare_class: p.fare_class,
          seq_no: p.seq_no,
          travel_date: p.travel_date,
          seat_no: p.seat_no,
          destination_code: p.destination_code,
          flight_no: p.flight_no,
          raw_line: p.raw_line
        });
      });
    });

    if (docs.length) {
      await ManifestPassenger.deleteMany({ manifest_id: manifest._id });
      await ManifestPassenger.insertMany(docs);
    }

    manifest.status = 'synced';
    await manifest.save();
    res.json({ status: 'ok', message: 'Manifest berhasil disinkronkan', total: docs.length });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

async function listManifestPassengers(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const passengers = await ManifestPassenger.find({ manifest_id: req.params.id })
      .sort({ seq_no: 1 })
      .limit(limit);
    res.json({ status: 'ok', data: passengers });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

async function exportManifestPassengers(req, res) {
  try {
    const passengers = await ManifestPassenger.find({ manifest_id: req.params.id })
      .sort({ seq_no: 1 });
    const headers = [
      'status',
      'name',
      'pnr',
      'fare_class',
      'seq_no',
      'travel_date',
      'seat_no',
      'destination_code',
      'flight_no'
    ];
    const rows = passengers.map(p => [
      p.status,
      p.name,
      p.pnr,
      p.fare_class,
      p.seq_no,
      p.travel_date,
      p.seat_no,
      p.destination_code,
      p.flight_no
    ]);
    const csv = [headers.join(','), ...rows.map(row => row.map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="manifest_passengers.csv"');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

async function ingestSampleManifests(req, res) {
  try {
    const samplesDir = path.join(__dirname, '../../uploads/manifests');
    if (!fs.existsSync(samplesDir)) {
      return res.status(404).json({ status: 'error', message: 'Folder sample tidak ditemukan' });
    }

    const folders = fs.readdirSync(samplesDir).filter(f => {
      const full = path.join(samplesDir, f);
      return fs.statSync(full).isDirectory();
    });

    const results = [];
    for (const folder of folders) {
      const folderPath = path.join(samplesDir, folder);
      const files = fs.readdirSync(folderPath).filter(f => /\.(txt)$/i.test(f));

      for (const file of files) {
        const filePath = path.join(folderPath, file);
        const existing = await Manifest.findOne({ filename: file, source: 'sample' });
        if (existing) {
          results.push({ file, status: 'skipped', reason: 'already exists' });
          continue;
        }
        const buffer = fs.readFileSync(filePath);
        const manifest = await createManifestFromFile({
          buffer,
          filename: file,
          source: 'sample',
          uploadedBy: 'system',
          filePath
        });

        // Auto-sync passengers
        const segments = manifest.parsed_fields?.segments || [];
        const docs = [];
        segments.forEach((segment, index) => {
          (segment.passengers || []).forEach(p => {
            docs.push({
              manifest_id: manifest._id,
              flight_number: segment.flight_number,
              flight_date: segment.flight_date,
              segment_index: index,
              status: p.status || 'checked_in',
              name: p.name,
              level: p.level,
              pnr: p.pnr,
              fare_class: p.fare_class,
              seq_no: p.seq_no,
              travel_date: p.travel_date,
              seat_no: p.seat_no,
              destination_code: p.destination_code,
              flight_no: p.flight_no,
              raw_line: p.raw_line
            });
          });
          (segment.no_shows || []).forEach(p => {
            docs.push({
              manifest_id: manifest._id,
              flight_number: segment.flight_number,
              flight_date: segment.flight_date,
              segment_index: index,
              status: 'no_show',
              name: p.name,
              level: p.level,
              pnr: p.pnr,
              fare_class: p.fare_class,
              seq_no: p.seq_no,
              travel_date: p.travel_date,
              seat_no: p.seat_no,
              destination_code: p.destination_code,
              flight_no: p.flight_no,
              raw_line: p.raw_line
            });
          });
        });

        if (docs.length) {
          await ManifestPassenger.insertMany(docs);
          manifest.status = 'synced';
          await manifest.save();
        }

        results.push({ file, status: 'ingested', passengers: docs.length, flight: manifest.flight_number });
      }
    }

    res.json({ status: 'ok', data: results });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

async function resyncManifest(req, res) {
  try {
    const manifest = await Manifest.findById(req.params.id);
    if (!manifest) return res.status(404).json({ status: 'error', message: 'Manifest tidak ditemukan' });

    // Re-parse the file if we have a file path and it's a txt
    if (manifest.file_path && fs.existsSync(manifest.file_path)) {
      const buffer = fs.readFileSync(manifest.file_path);
      const { parseManifestText, buildManifestSummary } = require('../services/manifestService');
      const text = buffer.toString('utf-8');
      const segments = parseManifestText(text);
      const summary = buildManifestSummary(segments);
      manifest.parsed_fields = { segments };
      manifest.flight_number = summary.flight_number || manifest.flight_number;
      manifest.flight_date = summary.flight_date || manifest.flight_date;
      manifest.origin = summary.origin || manifest.origin;
      manifest.destination = summary.destination || manifest.destination;
      manifest.carrier = summary.carrier || manifest.carrier;
    }

    const segments = manifest.parsed_fields?.segments || [];
    const docs = [];
    segments.forEach((segment, index) => {
      (segment.passengers || []).forEach(p => {
        docs.push({
          manifest_id: manifest._id,
          flight_number: segment.flight_number,
          flight_date: segment.flight_date,
          segment_index: index,
          status: p.status || 'checked_in',
          name: p.name, level: p.level, pnr: p.pnr,
          fare_class: p.fare_class, seq_no: p.seq_no,
          travel_date: p.travel_date, seat_no: p.seat_no,
          destination_code: p.destination_code,
          flight_no: p.flight_no, raw_line: p.raw_line
        });
      });
      (segment.no_shows || []).forEach(p => {
        docs.push({
          manifest_id: manifest._id,
          flight_number: segment.flight_number,
          flight_date: segment.flight_date,
          segment_index: index,
          status: 'no_show',
          name: p.name, level: p.level, pnr: p.pnr,
          fare_class: p.fare_class, seq_no: p.seq_no,
          travel_date: p.travel_date, seat_no: p.seat_no,
          destination_code: p.destination_code,
          flight_no: p.flight_no, raw_line: p.raw_line
        });
      });
    });

    await ManifestPassenger.deleteMany({ manifest_id: manifest._id });
    if (docs.length) {
      await ManifestPassenger.insertMany(docs);
    }
    manifest.status = docs.length ? 'synced' : 'needs_review';
    await manifest.save();

    res.json({ status: 'ok', message: 'Manifest berhasil di-resync', total: docs.length });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  listManifests,
  getManifestDetail,
  uploadManifest,
  updateManifestStatus,
  syncManifestPassengers,
  listManifestPassengers,
  exportManifestPassengers,
  ingestSampleManifests,
  resyncManifest
};
