const fs = require('fs');
const Manifest = require('../models/Manifest');
const ManifestPassenger = require('../models/ManifestPassenger');
const { ingestManifest } = require('../services/manifestIngestService');
const { parseManifestText, buildManifestSummary, parsePassengerLine } = require('../services/manifestService');

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

    // Re-parse dari file asli jika tersedia (memastikan parser terbaru digunakan)
    let segments = manifest.parsed_fields?.segments || [];
    if (manifest.file_path && manifest.file_type === 'txt') {
      try {
        if (fs.existsSync(manifest.file_path)) {
          const text = fs.readFileSync(manifest.file_path, 'utf-8');
          const freshSegments = parseManifestText(text);
          if (freshSegments.length > 0) {
            segments = freshSegments;
            const summary = buildManifestSummary(freshSegments);
            manifest.parsed_fields = { segments: freshSegments };
            manifest.flight_number = summary.flight_number || manifest.flight_number;
            manifest.flight_date = summary.flight_date || manifest.flight_date;
            manifest.origin = summary.origin || manifest.origin;
            manifest.destination = summary.destination || manifest.destination;
            manifest.carrier = summary.carrier || manifest.carrier;
          }
        }
      } catch (parseErr) {
        // jika gagal re-parse, lanjutkan dengan data yang ada
      }
    }

    if (!segments.length) {
      return res.status(400).json({ status: 'error', message: 'Manifest belum diparse atau tidak ada penumpang' });
    }

    // Helper: jika data dari DB lama (nama kosong), coba re-parse dari raw_line
    const resolvePassenger = (p) => {
      if (!p.name && p.raw_line) {
        const reparsed = parsePassengerLine(p.raw_line);
        if (reparsed && reparsed.name) {
          return { ...p, ...reparsed };
        }
      }
      return p;
    };

    const docs = [];
    segments.forEach((segment, index) => {
      const passengers = segment.passengers || [];
      passengers.forEach((raw) => {
        const p = resolvePassenger(raw);
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
      noShows.forEach((raw) => {
        const p = resolvePassenger(raw);
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

module.exports = {
  listManifests,
  getManifestDetail,
  uploadManifest,
  updateManifestStatus,
  syncManifestPassengers,
  listManifestPassengers,
  exportManifestPassengers
};
