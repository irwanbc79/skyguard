const fs = require('fs');
const path = require('path');
const Manifest = require('../models/Manifest');
const ManifestPassenger = require('../models/ManifestPassenger');
const { ingestManifest } = require('../services/manifestIngestService');
const { parseManifestText, parseManifestAuto, buildManifestSummary, parsePassengerLine } = require('../services/manifestService');
const { parseApisText, findApisFile } = require('../services/apisService');
const Watchlist = require('../models/Watchlist');

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
    let manifestText = null;
    if (manifest.file_path && manifest.file_type === 'txt') {
      try {
        if (fs.existsSync(manifest.file_path)) {
          manifestText = fs.readFileSync(manifest.file_path, 'utf-8');
          const freshSegments = parseManifestAuto(manifestText);
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

    // ── Cari dan parse file APIS pendamping ──────────────────────────────────
    // apisMap: { pnr → { doc_number, nationality, gender, dob, doc_expiry, ... } }
    const apisMap = new Map();
    if (manifest.file_path) {
      try {
        const apisFilePath = findApisFile(manifest.file_path);
        if (apisFilePath && fs.existsSync(apisFilePath)) {
          const apisText = fs.readFileSync(apisFilePath, 'utf-8');
          const apisPax = parseApisText(apisText);
          apisPax.forEach(ap => {
            if (ap.pnr) apisMap.set(ap.pnr.toUpperCase(), ap);
          });
        }
      } catch {
        // APIS file tidak bisa dibaca – lanjut tanpa data APIS
      }
    }

    const docs = [];
    const buildDoc = (raw, status, segmentIndex, segment) => {
      const p = resolvePassenger(raw);
      // Merge data APIS jika tersedia (via PNR)
      const apis = p.pnr ? apisMap.get(p.pnr.toUpperCase()) : null;
      return {
        manifest_id: manifest._id,
        flight_number: segment.flight_number,
        flight_date: segment.flight_date,
        segment_index: segmentIndex,
        status,
        name: p.name,
        level: p.level,
        pnr: p.pnr,
        fare_class: p.fare_class,
        seq_no: p.seq_no,
        travel_date: p.travel_date,
        seat_no: p.seat_no || p.seat_no,
        destination_code: p.destination_code,
        flight_no: p.flight_no,
        raw_line: p.raw_line,
        // APIS / Paspor fields — dari file APIS atau embedded (GSPM)
        doc_number: (apis ? apis.doc_number : null) || p.doc_number || null,
        doc_type: (apis ? apis.doc_type : null) || p.doc_type || null,
        doc_expiry: (apis ? apis.doc_expiry : null) || p.doc_expiry || null,
        nationality: (apis ? apis.nationality : null) || p.nationality || null,
        residence: apis ? apis.residence : null,
        gender: (apis ? apis.gender : null) || p.gender || null,
        dob: apis ? apis.dob : null,
        country_of_issue: apis ? apis.country_of_issue : null,
        full_name_apis: apis ? apis.full_name_apis : null,
        apis_synced: !!(apis || p.apis_synced)
      };
    };

    segments.forEach((segment, index) => {
      (segment.passengers || []).forEach(raw => docs.push(buildDoc(raw, 'checked_in', index, segment)));
      (segment.no_shows || []).forEach(raw => docs.push(buildDoc(raw, 'no_show', index, segment)));
    });

    if (docs.length) {
      await ManifestPassenger.deleteMany({ manifest_id: manifest._id });
      await ManifestPassenger.insertMany(docs);
    }

    // ── Cek watchlist: apakah ada paspor yang masuk daftar pantau ──────────
    let watchlistHits = [];
    const docNumbers = [...new Set(docs.map(d => d.doc_number).filter(Boolean))];
    if (docNumbers.length) {
      const watchlistMatches = await Watchlist.find({
        doc_number: { $in: docNumbers.map(n => n.toUpperCase()) },
        is_active: true
      });
      if (watchlistMatches.length) {
        watchlistHits = watchlistMatches.map(w => ({
          doc_number: w.doc_number,
          name: w.name,
          priority: w.priority,
          reason: w.reason
        }));
        // Update hit_count dan last_hit di watchlist
        for (const w of watchlistMatches) {
          const paxHit = docs.find(d => d.doc_number && d.doc_number.toUpperCase() === w.doc_number);
          await Watchlist.updateOne({ _id: w._id }, {
            $inc: { hit_count: 1 },
            $set: {
              last_hit_flight: paxHit?.flight_number || manifest.flight_number,
              last_hit_date: paxHit?.flight_date || manifest.flight_date
            }
          });
        }
      }
    }

    manifest.status = 'synced';
    await manifest.save();
    res.json({
      status: 'ok',
      message: 'Manifest berhasil disinkronkan',
      total: docs.length,
      watchlist_hits: watchlistHits.length,
      watchlist_alerts: watchlistHits
    });
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
