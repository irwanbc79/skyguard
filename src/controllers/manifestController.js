const Manifest = require('../models/Manifest');
const ManifestPassenger = require('../models/ManifestPassenger');
const { ingestManifest } = require('../services/manifestIngestService');
const { sanitizeCsv } = require('../utils/helpers');

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
    if (manifest.status === 'synced') {
      return res.json({ status: 'ok', message: 'Manifest sudah disinkronkan' });
    }
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
    const manifest = await Manifest.findById(req.params.id);
    const passengers = await ManifestPassenger.find({ manifest_id: req.params.id })
      .sort({ seq_no: 1 });
    const headers = [
      'flight_number',
      'flight_date',
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
      manifest?.flight_number || '',
      manifest?.flight_date ? new Date(manifest.flight_date).toISOString().split('T')[0] : '',
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
    const csv = [headers.join(','), ...rows.map(row => row.map(val => `"${sanitizeCsv(String(val || '').replace(/"/g, '""'))}"`).join(','))].join('\n');
    const fname = `manifest_${manifest?.flight_number || 'unknown'}_passengers.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
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
