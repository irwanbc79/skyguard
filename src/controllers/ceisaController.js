/**
 * ceisaController.js
 * Endpoint: Upload, List Batch, Stats, Records, Delete
 */

const ManifestCeisa = require("../models/ManifestCeisa");
const ManifestCeisaRecord = require("../models/ManifestCeisaRecord");
const { processCeisaXlsx } = require("../services/ceisaService");
const fs = require("fs");

// POST /api/ceisa/upload
async function uploadCeisa(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ status: "error", message: "File XLSX tidak ditemukan." });
    }
    const uploadedBy = (req.user && (req.user.email || String(req.user._id))) || "manual";
    const result = await processCeisaXlsx({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      uploadedBy,
    });
    res.json({
      status: "ok",
      message: `Import berhasil: ${result.inserted} penerbangan dimasukkan`,
      data: {
        batch_id: result.batch._id,
        periode: result.batch.periode_label,
        total_records: result.inserted,
        inward: result.batch.inward_count,
        outward: result.batch.outward_count,
        airlines_count: result.batch.airlines.length,
        csv_gz_size_kb: result.csv_gz_size_kb,
        skipped: result.skipped,
      },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

// GET /api/ceisa/batches
async function listBatches(req, res) {
  try {
    const batches = await ManifestCeisa.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .select("-csv_gz_path -airlines");
    res.json({ status: "ok", data: batches });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

// GET /api/ceisa/batches/:id
async function getBatch(req, res) {
  try {
    const batch = await ManifestCeisa.findById(req.params.id);
    if (!batch) return res.status(404).json({ status: "error", message: "Batch tidak ditemukan." });
    res.json({ status: "ok", data: batch });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

// DELETE /api/ceisa/batches/:id
async function deleteBatch(req, res) {
  try {
    const batch = await ManifestCeisa.findById(req.params.id);
    if (!batch) return res.status(404).json({ status: "error", message: "Batch tidak ditemukan." });

    // Hapus file CSV.gz jika ada
    if (batch.csv_gz_path && fs.existsSync(batch.csv_gz_path)) {
      fs.unlinkSync(batch.csv_gz_path);
    }

    // Hapus semua records
    const { deletedCount } = await ManifestCeisaRecord.deleteMany({ batch_id: batch._id });

    // Hapus batch
    await batch.deleteOne();

    res.json({
      status: "ok",
      message: `Batch dan ${deletedCount} record berhasil dihapus.`,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

// GET /api/ceisa/records
// Query params: batch_id, direction, sarana_angkut, pelabuhan_asal, status_ceisa,
//               date_from, date_to, search, limit, page
async function listRecords(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.batch_id) filter.batch_id = req.query.batch_id;
    if (req.query.direction) filter.direction = req.query.direction;
    if (req.query.sarana_angkut) filter.sarana_angkut = { $regex: req.query.sarana_angkut, $options: "i" };
    if (req.query.pelabuhan_asal) filter.pelabuhan_asal = req.query.pelabuhan_asal.toUpperCase();
    if (req.query.status_ceisa) filter.status_ceisa = req.query.status_ceisa;
    if (req.query.npwp) filter.npwp = req.query.npwp;
    if (req.query.date_from || req.query.date_to) {
      filter.tanggal_tiba = {};
      if (req.query.date_from) filter.tanggal_tiba.$gte = new Date(req.query.date_from);
      if (req.query.date_to) filter.tanggal_tiba.$lte = new Date(req.query.date_to);
    }
    if (req.query.search) {
      const re = { $regex: req.query.search, $options: "i" };
      filter.$or = [
        { nomor_voyage: re },
        { sarana_angkut: re },
        { nomor_aju: re },
        { nama_perusahaan: re },
        { pelabuhan_asal: re },
      ];
    }

    const [records, total] = await Promise.all([
      ManifestCeisaRecord.find(filter)
        .sort({ tanggal_tiba: -1 })
        .skip(skip)
        .limit(limit),
      ManifestCeisaRecord.countDocuments(filter),
    ]);

    res.json({
      status: "ok",
      data: records,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

// GET /api/ceisa/stats
// Query params: batch_id, date_from, date_to
async function getStats(req, res) {
  try {
    const match = {};
    if (req.query.batch_id) match.batch_id = require("mongoose").Types.ObjectId.createFromHexString(req.query.batch_id);
    if (req.query.date_from || req.query.date_to) {
      match.tanggal_tiba = {};
      if (req.query.date_from) match.tanggal_tiba.$gte = new Date(req.query.date_from);
      if (req.query.date_to) match.tanggal_tiba.$lte = new Date(req.query.date_to);
    }

    const [summary, byAirline, byDirection, byStatus, byPort, dailyTrend, perbaikanList] =
      await Promise.all([
        // Ringkasan total
        ManifestCeisaRecord.aggregate([
          { $match: match },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              total_berat: { $sum: "$berat" },
              total_pos: { $sum: "$jumlah_pos" },
              total_kemasan: { $sum: "$jumlah_kemasan" },
            },
          },
        ]),

        // Per maskapai
        ManifestCeisaRecord.aggregate([
          { $match: match },
          { $group: { _id: "$sarana_angkut", count: { $sum: 1 }, berat: { $sum: "$berat" } } },
          { $sort: { count: -1 } },
          { $limit: 15 },
        ]),

        // Inward vs Outward
        ManifestCeisaRecord.aggregate([
          { $match: match },
          { $group: { _id: "$direction", count: { $sum: 1 } } },
        ]),

        // Per status CEISA
        ManifestCeisaRecord.aggregate([
          { $match: match },
          { $group: { _id: "$status_ceisa", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),

        // Per pelabuhan asal (top 10)
        ManifestCeisaRecord.aggregate([
          { $match: match },
          { $group: { _id: "$pelabuhan_asal", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),

        // Trend harian (group by tanggal_tiba truncated to day)
        ManifestCeisaRecord.aggregate([
          { $match: { ...match, tanggal_tiba: { $ne: null } } },
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$tanggal_tiba", timezone: "Asia/Jakarta" },
              },
              total: { $sum: 1 },
              inward: { $sum: { $cond: [{ $eq: ["$direction", "inward"] }, 1, 0] } },
              outward: { $sum: { $cond: [{ $eq: ["$direction", "outward"] }, 1, 0] } },
              berat: { $sum: "$berat" },
            },
          },
          { $sort: { _id: 1 } },
        ]),

        // Daftar manifes PERSETUJUAN PERBAIKAN (flag)
        ManifestCeisaRecord.find({
          ...match,
          status_ceisa: "PERSETUJUAN PERBAIKAN",
        })
          .sort({ tanggal_tiba: -1 })
          .limit(50)
          .select("nomor_aju nomor_voyage sarana_angkut tanggal_tiba direction pelabuhan_asal"),
      ]);

    res.json({
      status: "ok",
      data: {
        summary: summary[0] || { total: 0, total_berat: 0, total_pos: 0, total_kemasan: 0 },
        by_airline: byAirline,
        by_direction: byDirection,
        by_status: byStatus,
        by_port: byPort,
        daily_trend: dailyTrend,
        flagged_perbaikan: perbaikanList,
      },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

module.exports = {
  uploadCeisa,
  listBatches,
  getBatch,
  deleteBatch,
  listRecords,
  getStats,
};
