/**
 * pbcController.js
 * Endpoints: Master Petugas PBC, Upload Data Pendukung IKI, IKI Indicators & Realisasi
 */

const XLSX = require("xlsx");
const PbcOfficer = require("../models/PbcOfficer");
const PbcDataBatch = require("../models/PbcDataBatch");
const PbcDataRecord = require("../models/PbcDataRecord");
const PbcScheduleRecord = require("../models/PbcScheduleRecord");
const PbcIkiIndicator = require("../models/PbcIkiIndicator");
const PbcIkiRealization = require("../models/PbcIkiRealization");
const { processJadwalXlsx } = require("../services/pbcJadwalService");

// ─── OFFICER MASTER ──────────────────────────────────────────────────────────

// GET /api/pbc/officers?tahun=2026&active=true
async function listOfficers(req, res) {
  try {
    const filter = {};
    if (req.query.tahun) filter.tahun = Number(req.query.tahun);
    if (req.query.active !== undefined) filter.is_active = req.query.active !== "false";
    const officers = await PbcOfficer.find(filter).sort({ nomor_skp: 1 });
    res.json({ status: "ok", data: officers, total: officers.length });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

// POST /api/pbc/officers
async function createOfficer(req, res) {
  try {
    const { nip, nama, pangkat, golongan, nomor_skp, tahun } = req.body;
    if (!nip || !nama) return res.status(400).json({ status: "error", message: "NIP dan Nama wajib diisi." });
    const officer = await PbcOfficer.create({
      nip: String(nip).trim(),
      nama: String(nama).trim(),
      pangkat: pangkat ? String(pangkat).trim() : undefined,
      golongan: golongan ? String(golongan).trim() : undefined,
      nomor_skp: nomor_skp ? String(nomor_skp).trim() : undefined,
      tahun: tahun ? Number(tahun) : 2026,
    });
    res.status(201).json({ status: "ok", data: officer });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ status: "error", message: "NIP sudah terdaftar." });
    res.status(500).json({ status: "error", message: err.message });
  }
}

// PUT /api/pbc/officers/:id
async function updateOfficer(req, res) {
  try {
    const { nip, nama, pangkat, golongan, nomor_skp, tahun, is_active } = req.body;
    const officer = await PbcOfficer.findByIdAndUpdate(
      req.params.id,
      { nip, nama, pangkat, golongan, nomor_skp, tahun, is_active },
      { new: true, runValidators: true }
    );
    if (!officer) return res.status(404).json({ status: "error", message: "Petugas tidak ditemukan." });
    res.json({ status: "ok", data: officer });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ status: "error", message: "NIP sudah terdaftar." });
    res.status(500).json({ status: "error", message: err.message });
  }
}

// DELETE /api/pbc/officers/:id
async function deleteOfficer(req, res) {
  try {
    const officer = await PbcOfficer.findByIdAndDelete(req.params.id);
    if (!officer) return res.status(404).json({ status: "error", message: "Petugas tidak ditemukan." });
    res.json({ status: "ok", message: "Petugas berhasil dihapus." });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

// ─── DATA UPLOAD ─────────────────────────────────────────────────────────────

// POST /api/pbc/upload
// Form fields: source_type, period_month, period_year, notes
// File: req.file (xlsx/xls/csv)
async function uploadData(req, res) {
  try {
    if (!req.file) return res.status(400).json({ status: "error", message: "File tidak ditemukan." });

    const { source_type, period_month, period_year, notes } = req.body;
    if (!source_type) return res.status(400).json({ status: "error", message: "source_type wajib diisi." });

    const SOURCE_LABELS = {
      rao: "Data RAO (ECD Scanning)",
      lembur: "Data Lembur",
      uang_makan: "Data Uang Makan",
      custom: "Data Kustom",
    };
    const uploadedBy = (req.user && (req.user.email || String(req.user._id))) || "manual";

    const batch = await PbcDataBatch.create({
      source_type,
      source_label: SOURCE_LABELS[source_type] || source_type,
      original_filename: req.file.originalname,
      period_month: period_month ? Number(period_month) : undefined,
      period_year: period_year ? Number(period_year) : new Date().getFullYear(),
      uploaded_by: uploadedBy,
      notes,
      status: "processing",
    });

    try {
      const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
      const ws = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

      if (rows.length < 2) throw new Error("File kosong atau tidak ada data (min 2 baris).");

      const headers = rows[0].map((h) => (h ? String(h).trim().toUpperCase() : ""));
      const dataRows = rows.slice(1).filter((r) => r.some((v) => v !== null && v !== ""));

      // Normalisasi header per source_type
      const records = dataRows.map((row) => {
        const raw = {};
        headers.forEach((h, i) => { raw[h] = row[i] ?? null; });

        const nip = findField(raw, ["NIP", "NIPNIP", "NO NIP"]);
        const nama = findField(raw, ["NAMA", "NAMA PETUGAS", "NAMA LENGKAP"]);
        const tanggalRaw = findField(raw, ["TANGGAL", "TGL", "DATE"]);
        const nilaiRaw = findField(raw, [
          "JUMLAH", "JUMLAH ECD", "JUMLAH DOKUMEN", "JAM", "NILAI", "QTY", "COUNT",
        ]);
        const keterangan = findField(raw, ["KETERANGAN", "KET", "NOTES", "CATATAN"]);

        let nilai = 0;
        if (nilaiRaw !== null && nilaiRaw !== "") nilai = Number(nilaiRaw) || 0;

        let tanggal = null;
        if (tanggalRaw) {
          const d = new Date(tanggalRaw);
          if (!isNaN(d.getTime())) tanggal = d;
        }

        const SATUAN_MAP = { rao: "ECD", lembur: "jam", uang_makan: "hari", custom: "unit" };

        return {
          batch_id: batch._id,
          source_type,
          nip: nip ? String(nip).trim() : null,
          nama: nama ? String(nama).trim() : null,
          tanggal,
          period_month: batch.period_month,
          period_year: batch.period_year,
          nilai,
          satuan: SATUAN_MAP[source_type] || "unit",
          keterangan: keterangan ? String(keterangan).trim() : null,
          raw_data: raw,
        };
      });

      const CHUNK = 500;
      let inserted = 0;
      for (let i = 0; i < records.length; i += CHUNK) {
        const result = await PbcDataRecord.insertMany(records.slice(i, i + CHUNK), { ordered: false });
        inserted += result.length;
      }

      batch.total_records = inserted;
      batch.status = "imported";
      await batch.save();

      res.json({
        status: "ok",
        message: `Upload berhasil: ${inserted} record dimasukkan.`,
        data: { batch_id: batch._id, source_type, inserted },
      });
    } catch (parseErr) {
      batch.status = "failed";
      batch.error_message = parseErr.message;
      await batch.save();
      throw parseErr;
    }
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

function findField(raw, keys) {
  for (const k of keys) {
    if (raw[k] !== undefined && raw[k] !== null) return raw[k];
  }
  return null;
}

// GET /api/pbc/batches?source_type=&year=
async function listBatches(req, res) {
  try {
    const filter = {};
    if (req.query.source_type) filter.source_type = req.query.source_type;
    if (req.query.year) filter.period_year = Number(req.query.year);
    const batches = await PbcDataBatch.find(filter).sort({ createdAt: -1 }).limit(100);
    res.json({ status: "ok", data: batches });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

// DELETE /api/pbc/batches/:id
async function deleteBatch(req, res) {
  try {
    const batch = await PbcDataBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ status: "error", message: "Batch tidak ditemukan." });
    const { deletedCount } = await PbcDataRecord.deleteMany({ batch_id: batch._id });
    await batch.deleteOne();
    res.json({ status: "ok", message: `Batch dan ${deletedCount} record berhasil dihapus.` });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

// GET /api/pbc/records?source_type=&nip=&year=&month=&batch_id=
async function listRecords(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const filter = {};
    if (req.query.source_type) filter.source_type = req.query.source_type;
    if (req.query.nip) filter.nip = req.query.nip;
    if (req.query.year) filter.period_year = Number(req.query.year);
    if (req.query.month) filter.period_month = Number(req.query.month);
    if (req.query.batch_id) filter.batch_id = req.query.batch_id;

    const [records, total] = await Promise.all([
      PbcDataRecord.find(filter).sort({ tanggal: -1 }).skip((page - 1) * limit).limit(limit),
      PbcDataRecord.countDocuments(filter),
    ]);
    res.json({ status: "ok", data: records, pagination: { total, page, limit } });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

// GET /api/pbc/summary?year=2026&month=1
// Rekapitulasi nilai per NIP per source_type (cikal bakal hitung IKI)
async function getSummary(req, res) {
  try {
    const match = {};
    if (req.query.year) match.period_year = Number(req.query.year);
    if (req.query.month) match.period_month = Number(req.query.month);

    const [byNip, bySource, officers] = await Promise.all([
      PbcDataRecord.aggregate([
        { $match: match },
        {
          $group: {
            _id: { nip: "$nip", source_type: "$source_type" },
            nama: { $first: "$nama" },
            total_nilai: { $sum: "$nilai" },
            satuan: { $first: "$satuan" },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.nip": 1 } },
      ]),
      PbcDataRecord.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$source_type",
            total_nilai: { $sum: "$nilai" },
            total_records: { $sum: 1 },
            total_officers: { $addToSet: "$nip" },
          },
        },
        { $project: { _id: 1, total_nilai: 1, total_records: 1, total_officers: { $size: "$total_officers" } } },
      ]),
      PbcOfficer.find({ is_active: true }).sort({ nomor_skp: 1 }).select("nip nama pangkat golongan nomor_skp"),
    ]);

    res.json({ status: "ok", data: { by_nip: byNip, by_source: bySource, officers } });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

// ─── JADWAL BULANAN ──────────────────────────────────────────────────────────

// POST /api/pbc/jadwal/upload
async function uploadJadwal(req, res) {
  try {
    if (!req.file) return res.status(400).json({ status: "error", message: "File tidak ditemukan." });
    const { period_month, period_year } = req.body;
    if (!period_month || !period_year)
      return res.status(400).json({ status: "error", message: "Bulan dan tahun wajib diisi." });

    const uploadedBy = (req.user && (req.user.email || String(req.user._id))) || "manual";
    const result = await processJadwalXlsx({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      month: Number(period_month),
      year: Number(period_year),
      uploadedBy,
    });

    res.json({
      status: "ok",
      message: `Jadwal berhasil diimport: ${result.totalScheduleRecords} record jadwal dari ${result.processedSheets.length} sheet.`,
      data: {
        batch_id: result.batch._id,
        total_records: result.totalScheduleRecords,
        sheets: result.processedSheets,
        notes: result.batch.notes,
      },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

// GET /api/pbc/jadwal/summary?year=2026&month=5&nip=
// Rekap hari kerja, libur, dan distribusi shift per petugas
async function getJadwalSummary(req, res) {
  try {
    const match = {};
    if (req.query.year) match.period_year = Number(req.query.year);
    if (req.query.month) match.period_month = Number(req.query.month);
    if (req.query.nip) match.nip = req.query.nip;
    if (req.query.section) match.section = req.query.section;

    const [perOfficer, perSection, shiftDist, batches] = await Promise.all([
      // Rekap per petugas: hari kerja, libur, breakdown shift
      PbcScheduleRecord.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$nip",
            nama: { $first: "$nama" },
            total_hari: { $sum: 1 },
            hari_kerja: { $sum: { $cond: ["$is_working", 1, 0] } },
            hari_libur: { $sum: { $cond: ["$is_working", 0, 1] } },
            shift_M: { $sum: { $cond: [{ $eq: ["$shift", "M"] }, 1, 0] } },
            shift_S: { $sum: { $cond: [{ $eq: ["$shift", "S"] }, 1, 0] } },
            shift_P: { $sum: { $cond: [{ $eq: ["$shift", "P"] }, 1, 0] } },
            shift_L: { $sum: { $cond: [{ $eq: ["$shift", "L"] }, 1, 0] } },
            shift_LP: { $sum: { $cond: [{ $eq: ["$shift", "LP"] }, 1, 0] } },
          },
        },
        { $sort: { "_id": 1 } },
      ]),
      // Rekap per seksi
      PbcScheduleRecord.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$section",
            total_records: { $sum: 1 },
            officers: { $addToSet: "$nip" },
            hari_kerja: { $sum: { $cond: ["$is_working", 1, 0] } },
          },
        },
        { $project: { _id: 1, total_records: 1, hari_kerja: 1, officers: { $size: "$officers" } } },
      ]),
      // Distribusi shift keseluruhan
      PbcScheduleRecord.aggregate([
        { $match: match },
        { $group: { _id: "$shift", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      // Batches jadwal untuk periode ini
      PbcDataBatch.find({ source_type: "jadwal", ...( req.query.year ? { period_year: Number(req.query.year) } : {} ), ...( req.query.month ? { period_month: Number(req.query.month) } : {} ) })
        .sort({ createdAt: -1 }).limit(10).select("source_label period_month period_year total_records status notes createdAt"),
    ]);

    res.json({
      status: "ok",
      data: { per_officer: perOfficer, per_section: perSection, shift_distribution: shiftDist, batches },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

// DELETE /api/pbc/jadwal/batches/:id
async function deleteJadwalBatch(req, res) {
  try {
    const batch = await PbcDataBatch.findOne({ _id: req.params.id, source_type: "jadwal" });
    if (!batch) return res.status(404).json({ status: "error", message: "Batch tidak ditemukan." });
    const { deletedCount } = await PbcScheduleRecord.deleteMany({ batch_id: batch._id });
    await batch.deleteOne();
    res.json({ status: "ok", message: `Batch dan ${deletedCount} record jadwal berhasil dihapus.` });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

// ─── IKI MASTER INDICATORS ───────────────────────────────────────────────────

// GET /api/pbc/iki/indicators?tahun=2026&active=true
async function listIkiIndicators(req, res) {
  try {
    const filter = {};
    if (req.query.tahun) filter.tahun = Number(req.query.tahun);
    if (req.query.active !== "false") filter.is_active = true;
    const indicators = await PbcIkiIndicator.find(filter).sort({ urutan: 1, kode: 1 });
    res.json({ status: "ok", data: indicators, total: indicators.length });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

// POST /api/pbc/iki/indicators
async function createIkiIndicator(req, res) {
  try {
    const { nama, target, satuan, tahun, keterangan, urutan } = req.body;
    if (!nama || target === undefined)
      return res.status(400).json({ status: "error", message: "Nama dan target wajib diisi." });

    // Auto-generate kode IKI-NNN
    const last = await PbcIkiIndicator.findOne({ tahun: tahun || 2026 }).sort({ kode: -1 }).lean();
    let seq = 1;
    if (last && last.kode) {
      const m = last.kode.match(/IKI-(\d+)$/);
      if (m) seq = parseInt(m[1]) + 1;
    }
    const kode = `IKI-${String(seq).padStart(3, "0")}`;

    const indicator = await PbcIkiIndicator.create({
      kode,
      nama: String(nama).trim(),
      target: Number(target),
      satuan: satuan || "%",
      tahun: tahun ? Number(tahun) : 2026,
      keterangan: keterangan ? String(keterangan).trim() : undefined,
      urutan: urutan ? Number(urutan) : seq,
    });
    res.status(201).json({ status: "ok", data: indicator });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ status: "error", message: "Kode IKI sudah ada." });
    res.status(500).json({ status: "error", message: err.message });
  }
}

// PUT /api/pbc/iki/indicators/:id
async function updateIkiIndicator(req, res) {
  try {
    const { nama, target, satuan, tahun, keterangan, urutan, is_active } = req.body;
    const indicator = await PbcIkiIndicator.findByIdAndUpdate(
      req.params.id,
      { nama, target, satuan, tahun, keterangan, urutan, is_active },
      { new: true, runValidators: true }
    );
    if (!indicator) return res.status(404).json({ status: "error", message: "Indikator IKI tidak ditemukan." });
    res.json({ status: "ok", data: indicator });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

// DELETE /api/pbc/iki/indicators/:id
// Soft-delete jika sudah ada realisasi, hard-delete jika belum
async function deleteIkiIndicator(req, res) {
  try {
    const indicator = await PbcIkiIndicator.findById(req.params.id);
    if (!indicator) return res.status(404).json({ status: "error", message: "Indikator IKI tidak ditemukan." });

    const hasRealisasi = await PbcIkiRealization.exists({ iki_id: indicator._id });
    if (hasRealisasi) {
      indicator.is_active = false;
      await indicator.save();
      return res.json({ status: "ok", message: "Indikator dinonaktifkan (ada data realisasi terkait)." });
    }
    await indicator.deleteOne();
    res.json({ status: "ok", message: "Indikator IKI berhasil dihapus." });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

// ─── IKI REALISASI ────────────────────────────────────────────────────────────

// POST /api/pbc/iki/realisasi  { iki_id, nip, period_month, period_year, realisasi, keterangan }
async function upsertRealisasi(req, res) {
  try {
    const { iki_id, nip, period_month, period_year, realisasi, keterangan } = req.body;
    if (!iki_id || !nip || !period_month || !period_year || realisasi === undefined)
      return res.status(400).json({ status: "error", message: "iki_id, nip, period_month, period_year, realisasi wajib diisi." });

    const indicator = await PbcIkiIndicator.findById(iki_id).lean();
    if (!indicator) return res.status(404).json({ status: "error", message: "Indikator IKI tidak ditemukan." });

    const officer = await PbcOfficer.findOne({ nip: String(nip).trim() }).lean();
    const namaOfficer = officer ? officer.nama : null;

    const capaian_pct = indicator.target ? (Number(realisasi) / indicator.target) * 100 : 0;
    const input_by = (req.user && (req.user.email || String(req.user._id))) || "manual";

    const doc = await PbcIkiRealization.findOneAndUpdate(
      { iki_id, nip: String(nip).trim(), period_year: Number(period_year), period_month: Number(period_month) },
      {
        $set: {
          nama: namaOfficer,
          realisasi: Number(realisasi),
          capaian_pct: Math.round(capaian_pct * 100) / 100,
          input_by,
          keterangan: keterangan ? String(keterangan).trim() : undefined,
        },
      },
      { upsert: true, new: true }
    );
    res.json({ status: "ok", data: doc });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

// GET /api/pbc/iki/dashboard?year=2026&month=5
// Return: { indicators[], officers[], matrix: { nip: { iki_id: { realisasi, capaian_pct } } } }
async function getIkiDashboard(req, res) {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const month = req.query.month ? Number(req.query.month) : null;

    const matchRealisasi = { period_year: year };
    if (month) matchRealisasi.period_month = month;

    const [indicators, officers, realizations] = await Promise.all([
      PbcIkiIndicator.find({ is_active: true, tahun: year }).sort({ urutan: 1, kode: 1 }).lean(),
      PbcOfficer.find({ is_active: true }).sort({ nomor_skp: 1 }).lean(),
      PbcIkiRealization.find(matchRealisasi).lean(),
    ]);

    // Build matrix: nip → iki_id → { realisasi, capaian_pct, keterangan, period_month }
    const matrix = {};
    for (const r of realizations) {
      const k = String(r.nip);
      const ikiKey = String(r.iki_id);
      if (!matrix[k]) matrix[k] = {};
      if (!matrix[k][ikiKey]) {
        matrix[k][ikiKey] = { realisasi: r.realisasi, capaian_pct: r.capaian_pct, period_month: r.period_month, keterangan: r.keterangan };
      } else {
        // Jika multi-bulan (tanpa filter bulan): akumulasi rata-rata
        const prev = matrix[k][ikiKey];
        prev.realisasi = (prev.realisasi + r.realisasi) / 2;
        prev.capaian_pct = (prev.capaian_pct + r.capaian_pct) / 2;
      }
    }

    res.json({ status: "ok", data: { indicators, officers, matrix, year, month } });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

module.exports = {
  listOfficers,
  createOfficer,
  updateOfficer,
  deleteOfficer,
  uploadData,
  listBatches,
  deleteBatch,
  listRecords,
  getSummary,
  uploadJadwal,
  getJadwalSummary,
  deleteJadwalBatch,
  listIkiIndicators,
  createIkiIndicator,
  updateIkiIndicator,
  deleteIkiIndicator,
  upsertRealisasi,
  getIkiDashboard,
};
