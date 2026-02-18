/**
 * intelligenceController.js
 * Endpoint investigatif untuk petugas pengawas Bea Cukai
 *
 * Fitur utama:
 * - Cari riwayat penerbangan berdasarkan nomor paspor
 * - Cari berdasarkan nama
 * - Statistik intelijen (kewarganegaraan, frekuensi, paspor kedaluwarsa, dll.)
 * - Profil penumpang lintas penerbangan
 */

const ManifestPassenger = require('../models/ManifestPassenger');
const Manifest = require('../models/Manifest');
const Passenger = require('../models/Passenger');
const Watchlist = require('../models/Watchlist');
const { escapeRegex } = require('../utils/helpers');

// ─── Utilitas ─────────────────────────────────────────────────────────────────

function formatDate(d) {
  if (!d) return null;
  try { return new Date(d).toISOString().split('T')[0]; } catch { return null; }
}

function calculateAge(dob) {
  if (!dob) return null;
  const agems = Date.now() - new Date(dob).getTime();
  return Math.floor(agems / (365.25 * 24 * 3600 * 1000));
}

function isExpired(expiry) {
  if (!expiry) return null;
  return new Date(expiry) < new Date();
}

function riskLevel(records) {
  const flights = records.length;
  const expired = records.some(r => isExpired(r.doc_expiry));
  const multiplePassports = new Set(records.map(r => r.doc_number).filter(Boolean)).size > 1;
  const noShows = records.filter(r => r.status === 'no_show').length;

  if (expired || multiplePassports) return 'HIGH';
  if (flights >= 10 || noShows >= 3) return 'MEDIUM';
  return 'LOW';
}

// ─── 1. Cari berdasarkan nomor paspor ────────────────────────────────────────

async function searchByPassport(req, res) {
  try {
    const { doc_number } = req.params;
    if (!doc_number || doc_number.trim().length < 3) {
      return res.status(400).json({ status: 'error', message: 'Nomor dokumen minimal 3 karakter' });
    }

    const docNum = doc_number.trim().toUpperCase();
    const query = { doc_number: new RegExp(escapeRegex(docNum), 'i') };

    // Jalankan semua query secara paralel
    const [records, ceisaRecords, watchlistEntry] = await Promise.all([
      ManifestPassenger.find(query)
        .populate('manifest_id', 'origin destination carrier filename')
        .sort({ flight_date: -1 })
        .limit(500),
      // Cross-reference dengan data CEISA Bea Cukai
      Passenger.find({ paspor: new RegExp(escapeRegex(docNum), 'i') })
        .sort({ tanggal_dokumen: -1 })
        .limit(100),
      // Cek status watchlist
      Watchlist.findOne({ doc_number: docNum, is_active: true })
    ]);

    if (!records.length && !ceisaRecords.length) {
      return res.json({ status: 'ok', data: null, message: 'Data tidak ditemukan' });
    }

    // Identitas utama dari data APIS (terlengkap)
    const withApis = records.find(r => r.apis_synced) || records[0];

    const passport_numbers = [...new Set(records.map(r => r.doc_number).filter(Boolean))];
    const names_found = [...new Set([
      ...records.map(r => [r.full_name_apis, r.name]).flat(),
      ...ceisaRecords.map(r => r.nama_lengkap)
    ].filter(Boolean))];

    const flights = records.map(r => ({
      flight_id: r._id,
      flight_number: r.flight_number || r.flight_no,
      flight_date: formatDate(r.flight_date),
      origin: r.manifest_id?.origin || null,
      destination: r.manifest_id?.destination || r.destination_code || null,
      carrier: r.manifest_id?.carrier || null,
      seat_no: r.seat_no,
      pnr: r.pnr,
      fare_class: r.fare_class,
      status: r.status,
      name_on_manifest: r.name,
      name_on_apis: r.full_name_apis,
      nationality: r.nationality,
      gender: r.gender,
      dob: formatDate(r.dob),
      age: calculateAge(r.dob),
      doc_expiry: formatDate(r.doc_expiry),
      doc_expired: isExpired(r.doc_expiry),
      apis_synced: r.apis_synced
    }));

    // Ringkasan data CEISA Bea Cukai
    const devices_used = [...new Set(
      ceisaRecords.flatMap(r => [r.hkt1, r.hkt2]).filter(Boolean)
    )];
    const billing_count = ceisaRecords.filter(r => r.status_penelitian === 'BILLING').length;
    const ceisa_summary = {
      total_records: ceisaRecords.length,
      billing_count,
      pembebasan_count: ceisaRecords.filter(r => r.status_penelitian === 'PEMBEBASAN').length,
      unique_devices: devices_used.length,
      devices_used,
      officers: [...new Set(ceisaRecords.map(r => r.nama_petugas).filter(Boolean))],
      first_arrival_ceisa: ceisaRecords.length ? formatDate(ceisaRecords[ceisaRecords.length - 1]?.tanggal_dokumen) : null,
      last_arrival_ceisa: ceisaRecords.length ? formatDate(ceisaRecords[0]?.tanggal_dokumen) : null,
      records: ceisaRecords.map(r => ({
        qr_code: r.qr_code,
        tanggal_dokumen: formatDate(r.tanggal_dokumen),
        waktu_rekam: formatDate(r.waktu_rekam),
        hkt1: r.hkt1,
        hkt2: r.hkt2,
        status: r.status,
        status_penelitian: r.status_penelitian,
        nama_petugas: r.nama_petugas,
        nip_petugas: r.nip_petugas
      }))
    };

    const profile = {
      // Identitas
      doc_number: withApis?.doc_number || docNum,
      doc_type: withApis?.doc_type || 'P',
      nationality: withApis?.nationality || null,
      residence: withApis?.residence || null,
      country_of_issue: withApis?.country_of_issue || null,
      gender: withApis?.gender || null,
      dob: formatDate(withApis?.dob),
      age: calculateAge(withApis?.dob),
      doc_expiry: formatDate(withApis?.doc_expiry),
      doc_expired: isExpired(withApis?.doc_expiry),

      // Status Watchlist
      watchlist: watchlistEntry ? {
        is_watched: true,
        priority: watchlistEntry.priority,
        reason: watchlistEntry.reason,
        notes: watchlistEntry.notes,
        case_number: watchlistEntry.case_number,
        added_by: watchlistEntry.added_by,
        added_at: formatDate(watchlistEntry.createdAt),
        hit_count: watchlistEntry.hit_count
      } : { is_watched: false },

      // Intelijen lintas penerbangan
      names_found,
      passport_numbers,
      multiple_passports: passport_numbers.length > 1,
      total_flights: flights.length,
      no_show_count: flights.filter(f => f.status === 'no_show').length,
      risk_level: riskLevel(records),

      // Riwayat penerbangan (dari manifest)
      flights,

      // Data CEISA Bea Cukai (cross-reference)
      ceisa: ceisa_summary,

      // Statistik tambahan
      routes: [...new Set(flights.map(f => `${f.origin || '?'} → ${f.destination || '?'}`))],
      first_seen: records.length ? formatDate(Math.min(...records.map(r => new Date(r.flight_date || 0)))) : null,
      last_seen: records.length ? formatDate(Math.max(...records.map(r => new Date(r.flight_date || 0)))) : null
    };

    res.json({ status: 'ok', data: profile });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

// ─── 2. Cari berdasarkan nama ─────────────────────────────────────────────────

async function searchByName(req, res) {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ status: 'error', message: 'Kata kunci minimal 2 karakter' });
    }

    const regex = new RegExp(escapeRegex(q.trim()), 'i');
    const records = await ManifestPassenger.find({
      $or: [{ name: regex }, { full_name_apis: regex }]
    })
      .populate('manifest_id', 'origin destination carrier')
      .sort({ flight_date: -1 })
      .limit(200);

    // Kelompokkan per nomor paspor (atau per nama jika belum ada paspor)
    const grouped = new Map();
    records.forEach(r => {
      const key = r.doc_number || `NAME:${(r.full_name_apis || r.name || '').toUpperCase()}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(r);
    });

    const results = [];
    for (const [key, recs] of grouped) {
      const latest = recs[0];
      results.push({
        doc_number: latest.doc_number || null,
        nationality: latest.nationality || null,
        name: latest.full_name_apis || latest.name,
        gender: latest.gender,
        dob: formatDate(latest.dob),
        doc_expiry: formatDate(latest.doc_expiry),
        doc_expired: isExpired(latest.doc_expiry),
        total_flights: recs.length,
        no_show_count: recs.filter(r => r.status === 'no_show').length,
        risk_level: riskLevel(recs),
        last_flight: formatDate(latest.flight_date),
        last_flight_number: latest.flight_number,
        apis_synced: recs.some(r => r.apis_synced)
      });
    }

    res.json({ status: 'ok', total: results.length, data: results });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

// ─── 3. Cari multi-kriteria ───────────────────────────────────────────────────

async function advancedSearch(req, res) {
  try {
    const { passport, name, nationality, flight, date_from, date_to, risk, expired_only } = req.query;
    const filter = {};

    if (passport) filter.doc_number = new RegExp(escapeRegex(passport.trim()), 'i');
    if (name) filter.$or = [
      { name: new RegExp(escapeRegex(name.trim()), 'i') },
      { full_name_apis: new RegExp(escapeRegex(name.trim()), 'i') }
    ];
    if (nationality) filter.nationality = nationality.trim().toUpperCase();
    if (flight) filter.flight_number = new RegExp(escapeRegex(flight.trim()), 'i');
    if (date_from || date_to) {
      filter.flight_date = {};
      if (date_from) filter.flight_date.$gte = new Date(date_from);
      if (date_to) filter.flight_date.$lte = new Date(date_to);
    }
    if (expired_only === 'true') {
      filter.doc_expiry = { $lt: new Date() };
      filter.doc_expiry.$exists = true;
    }

    const records = await ManifestPassenger.find(filter)
      .populate('manifest_id', 'origin destination carrier')
      .sort({ flight_date: -1 })
      .limit(500);

    const results = records.map(r => ({
      _id: r._id,
      name: r.full_name_apis || r.name,
      doc_number: r.doc_number,
      doc_type: r.doc_type,
      nationality: r.nationality,
      gender: r.gender,
      dob: formatDate(r.dob),
      age: calculateAge(r.dob),
      doc_expiry: formatDate(r.doc_expiry),
      doc_expired: isExpired(r.doc_expiry),
      flight_number: r.flight_number,
      flight_date: formatDate(r.flight_date),
      origin: r.manifest_id?.origin,
      destination: r.manifest_id?.destination || r.destination_code,
      seat_no: r.seat_no,
      pnr: r.pnr,
      status: r.status,
      apis_synced: r.apis_synced
    }));

    res.json({ status: 'ok', total: results.length, data: results });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

// ─── 4. Statistik Intelijen ───────────────────────────────────────────────────

async function getIntelStats(req, res) {
  try {
    const [
      totalPassengers,
      totalWithPassport,
      totalExpired,
      nationalityStats,
      topFrequent,
      noShowStats,
      multiPassport,
      recentFlights
    ] = await Promise.all([
      // Total penumpang dengan data APIS
      ManifestPassenger.countDocuments({ apis_synced: true }),

      // Total yang punya data paspor
      ManifestPassenger.countDocuments({ doc_number: { $exists: true, $ne: null } }),

      // Paspor kedaluwarsa
      ManifestPassenger.countDocuments({
        doc_expiry: { $lt: new Date(), $exists: true },
        doc_number: { $ne: null }
      }),

      // Top 15 kewarganegaraan
      ManifestPassenger.aggregate([
        { $match: { nationality: { $ne: null } } },
        { $group: { _id: '$nationality', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 15 }
      ]),

      // Top 20 penumpang paling sering (by nomor paspor)
      ManifestPassenger.aggregate([
        { $match: { doc_number: { $ne: null } } },
        {
          $group: {
            _id: '$doc_number',
            name: { $first: { $ifNull: ['$full_name_apis', '$name'] } },
            nationality: { $first: '$nationality' },
            flights: { $sum: 1 },
            no_shows: { $sum: { $cond: [{ $eq: ['$status', 'no_show'] }, 1, 0] } },
            last_flight: { $max: '$flight_date' },
            doc_expiry: { $first: '$doc_expiry' }
          }
        },
        { $sort: { flights: -1 } },
        { $limit: 20 }
      ]),

      // Statistik no-show per penerbangan
      ManifestPassenger.aggregate([
        { $match: { status: 'no_show', doc_number: { $ne: null } } },
        {
          $group: {
            _id: '$doc_number',
            name: { $first: { $ifNull: ['$full_name_apis', '$name'] } },
            nationality: { $first: '$nationality' },
            no_show_count: { $sum: 1 },
            last_flight: { $max: '$flight_date' }
          }
        },
        { $match: { no_show_count: { $gte: 2 } } },
        { $sort: { no_show_count: -1 } },
        { $limit: 10 }
      ]),

      // Penumpang dengan >1 nomor paspor berbeda (indikasi multi-identitas)
      ManifestPassenger.aggregate([
        { $match: { doc_number: { $ne: null }, name: { $ne: null } } },
        {
          $group: {
            _id: { $toUpper: { $trim: { input: { $ifNull: ['$full_name_apis', '$name'] } } } },
            passports: { $addToSet: '$doc_number' },
            nationalities: { $addToSet: '$nationality' },
            total_flights: { $sum: 1 }
          }
        },
        { $match: { $expr: { $gt: [{ $size: '$passports' }, 1] } } },
        { $sort: { total_flights: -1 } },
        { $limit: 10 }
      ]),

      // Penerbangan terakhir yang tersinkron
      Manifest.find({ status: 'synced' })
        .select('flight_number flight_date origin destination carrier')
        .sort({ flight_date: -1 })
        .limit(10)
    ]);

    res.json({
      status: 'ok',
      data: {
        summary: {
          total_pax_with_apis: totalPassengers,
          total_pax_with_passport: totalWithPassport,
          expired_passports: totalExpired,
          coverage_pct: totalPassengers > 0
            ? Math.round((totalWithPassport / totalPassengers) * 100)
            : 0
        },
        nationality_breakdown: nationalityStats.map(n => ({
          nationality: n._id,
          count: n.count
        })),
        frequent_flyers: topFrequent.map(p => ({
          passport: p._id,
          name: p.name,
          nationality: p.nationality,
          total_flights: p.flights,
          no_shows: p.no_shows,
          last_flight: formatDate(p.last_flight),
          doc_expired: isExpired(p.doc_expiry)
        })),
        repeat_no_shows: noShowStats.map(p => ({
          passport: p._id,
          name: p.name,
          nationality: p.nationality,
          no_show_count: p.no_show_count,
          last_flight: formatDate(p.last_flight)
        })),
        multi_passport_suspects: multiPassport.map(p => ({
          name: p._id,
          passports: p.passports,
          nationalities: p.nationalities,
          total_flights: p.total_flights
        })),
        recent_synced_flights: recentFlights
      }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

// ─── 5. Profil penerbangan lengkap ───────────────────────────────────────────

async function getFlightIntelligence(req, res) {
  try {
    const { flight_number, date } = req.query;
    if (!flight_number) {
      return res.status(400).json({ status: 'error', message: 'Parameter flight_number wajib diisi' });
    }

    const filter = { flight_number: new RegExp(escapeRegex(flight_number.trim()), 'i') };
    if (date) {
      const d = new Date(date);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      filter.flight_date = { $gte: d, $lt: next };
    }

    const records = await ManifestPassenger.find(filter)
      .populate('manifest_id', 'origin destination carrier filename')
      .sort({ seq_no: 1 });

    if (!records.length) {
      return res.json({ status: 'ok', data: null, message: 'Penerbangan tidak ditemukan' });
    }

    const first = records[0];
    const manifest = first.manifest_id;

    const passengers = records.map(r => ({
      seq_no: r.seq_no,
      seat_no: r.seat_no,
      name: r.full_name_apis || r.name,
      pnr: r.pnr,
      status: r.status,
      gender: r.gender,
      nationality: r.nationality,
      dob: formatDate(r.dob),
      age: calculateAge(r.dob),
      doc_number: r.doc_number,
      doc_expiry: formatDate(r.doc_expiry),
      doc_expired: isExpired(r.doc_expiry),
      apis_synced: r.apis_synced
    }));

    const nationalities = {};
    passengers.forEach(p => {
      if (p.nationality) nationalities[p.nationality] = (nationalities[p.nationality] || 0) + 1;
    });

    res.json({
      status: 'ok',
      data: {
        flight_number: first.flight_number,
        flight_date: formatDate(first.flight_date),
        origin: manifest?.origin,
        destination: manifest?.destination,
        carrier: manifest?.carrier,
        total_pax: passengers.length,
        checked_in: passengers.filter(p => p.status === 'checked_in').length,
        no_shows: passengers.filter(p => p.status === 'no_show').length,
        expired_passports: passengers.filter(p => p.doc_expired).length,
        nationality_breakdown: Object.entries(nationalities)
          .sort((a, b) => b[1] - a[1])
          .map(([nat, count]) => ({ nationality: nat, count })),
        passengers
      }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

// ─── 6. Watchlist CRUD ───────────────────────────────────────────────────────

async function getWatchlist(req, res) {
  try {
    const { active_only = 'true', priority } = req.query;
    const filter = {};
    if (active_only !== 'false') filter.is_active = true;
    if (priority) filter.priority = priority.toUpperCase();

    const entries = await Watchlist.find(filter).sort({ priority: 1, createdAt: -1 });
    res.json({ status: 'ok', total: entries.length, data: entries });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

async function addToWatchlist(req, res) {
  try {
    const { doc_number, reason, priority = 'MEDIUM', notes, case_number, added_by, name, nationality } = req.body;
    if (!doc_number || !reason || !added_by) {
      return res.status(400).json({ status: 'error', message: 'doc_number, reason, dan added_by wajib diisi' });
    }

    const docNum = doc_number.trim().toUpperCase();

    // Cek apakah sudah ada
    const existing = await Watchlist.findOne({ doc_number: docNum });
    if (existing) {
      if (existing.is_active) {
        return res.status(409).json({ status: 'error', message: 'Nomor paspor sudah ada di watchlist' });
      }
      // Re-aktifkan jika pernah dinonaktifkan
      existing.is_active = true;
      existing.reason = reason;
      existing.priority = priority;
      existing.notes = notes || existing.notes;
      existing.case_number = case_number || existing.case_number;
      existing.added_by = added_by;
      if (name) existing.name = name;
      if (nationality) existing.nationality = nationality;
      await existing.save();
      return res.json({ status: 'ok', message: 'Watchlist diaktifkan kembali', data: existing });
    }

    // Coba ambil data identitas dari APIS jika belum diisi
    let resolvedName = name;
    let resolvedNat = nationality;
    if (!resolvedName || !resolvedNat) {
      const apisPax = await ManifestPassenger.findOne({ doc_number: docNum, apis_synced: true });
      if (apisPax) {
        resolvedName = resolvedName || apisPax.full_name_apis || apisPax.name;
        resolvedNat = resolvedNat || apisPax.nationality;
      }
    }

    const entry = await Watchlist.create({
      doc_number: docNum,
      reason,
      priority,
      notes,
      case_number,
      added_by,
      name: resolvedName,
      nationality: resolvedNat
    });

    res.json({ status: 'ok', message: 'Ditambahkan ke watchlist', data: entry });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

async function updateWatchlist(req, res) {
  try {
    const { id } = req.params;
    const { reason, priority, notes, case_number, is_active } = req.body;
    const update = {};
    if (reason !== undefined) update.reason = reason;
    if (priority !== undefined) update.priority = priority;
    if (notes !== undefined) update.notes = notes;
    if (case_number !== undefined) update.case_number = case_number;
    if (is_active !== undefined) update.is_active = is_active;

    const entry = await Watchlist.findByIdAndUpdate(id, update, { new: true });
    if (!entry) return res.status(404).json({ status: 'error', message: 'Data tidak ditemukan' });
    res.json({ status: 'ok', data: entry });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

async function removeFromWatchlist(req, res) {
  try {
    const { id } = req.params;
    const entry = await Watchlist.findByIdAndUpdate(id, { is_active: false }, { new: true });
    if (!entry) return res.status(404).json({ status: 'error', message: 'Data tidak ditemukan' });
    res.json({ status: 'ok', message: 'Dihapus dari watchlist aktif', data: entry });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

async function checkWatchlistHits(req, res) {
  try {
    // Cari paspor di watchlist yang muncul di manifest dalam N hari terakhir
    const days = parseInt(req.query.days) || 30;
    const since = new Date(); since.setDate(since.getDate() - days);

    const activeWatchlist = await Watchlist.find({ is_active: true }).select('doc_number');
    const watchedNums = activeWatchlist.map(w => w.doc_number);

    if (!watchedNums.length) return res.json({ status: 'ok', data: [], total: 0 });

    const hits = await ManifestPassenger.find({
      doc_number: { $in: watchedNums },
      flight_date: { $gte: since }
    })
      .populate('manifest_id', 'origin destination carrier')
      .sort({ flight_date: -1 });

    // Kelompokkan per paspor + update hit_count
    const grouped = {};
    for (const hit of hits) {
      const num = hit.doc_number;
      if (!grouped[num]) grouped[num] = [];
      grouped[num].push(hit);
    }

    // Update hit_count di watchlist
    for (const [docNum, flightHits] of Object.entries(grouped)) {
      const latest = flightHits[0];
      await Watchlist.updateOne({ doc_number: docNum }, {
        $inc: { hit_count: 0 }, // reset-free, just touch
        $set: {
          last_hit_flight: latest.flight_number,
          last_hit_date: latest.flight_date
        }
      });
    }

    const result = await Promise.all(
      Object.entries(grouped).map(async ([docNum, flightHits]) => {
        const wl = await Watchlist.findOne({ doc_number: docNum });
        return {
          watchlist: {
            id: wl._id,
            doc_number: docNum,
            name: wl.name,
            priority: wl.priority,
            reason: wl.reason,
            added_by: wl.added_by
          },
          hits: flightHits.map(h => ({
            flight_number: h.flight_number,
            flight_date: formatDate(h.flight_date),
            seat_no: h.seat_no,
            pnr: h.pnr,
            status: h.status,
            name_on_manifest: h.full_name_apis || h.name,
            origin: h.manifest_id?.origin,
            destination: h.manifest_id?.destination
          }))
        };
      })
    );

    res.json({ status: 'ok', total: result.length, data: result });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  searchByPassport,
  searchByName,
  advancedSearch,
  getIntelStats,
  getFlightIntelligence,
  getWatchlist,
  addToWatchlist,
  updateWatchlist,
  removeFromWatchlist,
  checkWatchlistHits
};
