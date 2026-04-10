const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const PmiRecord = require("../models/PmiRecord");
const { extractPmiFromImage } = require("../services/ocrService");

// ── Upload setup ──────────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, "../../uploads/pmi");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `pmi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error("Format tidak didukung. Gunakan JPG, PNG, atau PDF."));
  },
});

// ── Helper ────────────────────────────────────────────────────────────────────
function userInfo(req) {
  return {
    tagged_by_nip:  req.user?.nip || req.user?.email || "SYSTEM",
    tagged_by_nama: req.user?.nama || req.user?.name || req.user?.email || "Petugas",
  };
}

// ── GET /api/pmi/records — daftar semua PMI records (untuk PMI Intel) ─────────
router.get("/records", async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const status = req.query.status || "CONFIRMED";

    const filter = { status };
    if (req.query.q) {
      const rx = new RegExp(req.query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ passport_number: rx }, { nama: rx }];
    }
    if (req.query.date_from || req.query.date_to) {
      filter.tagged_at = {};
      if (req.query.date_from) filter.tagged_at.$gte = new Date(req.query.date_from);
      if (req.query.date_to)   filter.tagged_at.$lte = new Date(req.query.date_to);
    }

    const [records, total] = await Promise.all([
      PmiRecord.find(filter)
        .sort({ tagged_at: -1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      PmiRecord.countDocuments(filter),
    ]);

    res.json({ status: "ok", data: { records, total, limit, offset } });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ── GET /api/pmi/records/passport/:passport — cek PMI status 1 paspor ────────
router.get("/records/passport/:passport", async (req, res) => {
  try {
    const passport = req.params.passport.trim().toUpperCase();
    const records = await PmiRecord.find({ passport_number: passport })
      .sort({ tagged_at: -1 })
      .lean();

    const confirmed = records.filter(r => r.status === "CONFIRMED");
    res.json({
      status: "ok",
      data: {
        passport_number: passport,
        is_pmi: confirmed.length > 0,
        total_records: records.length,
        latest: confirmed[0] || null,
        records,
      },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ── POST /api/pmi/records — buat PMI record baru (dengan opsional dokumen) ───
router.post("/records", upload.array("dokumen", 5), async (req, res) => {
  try {
    const { passport_number, nama, no_kartu_pmi, lembaga, tgl_terbit, tgl_berlaku,
            negara_tujuan, catatan, imei_reg_id } = req.body;

    if (!passport_number || !catatan) {
      // Hapus file yang sudah terupload kalau validasi gagal
      (req.files || []).forEach(f => fs.unlink(f.path, () => {}));
      return res.status(400).json({
        status: "error",
        message: "passport_number dan catatan wajib diisi",
      });
    }

    const dokumen = (req.files || []).map(f => ({
      filename:     f.filename,
      originalname: f.originalname,
      mimetype:     f.mimetype,
      size:         f.size,
    }));

    const record = await PmiRecord.create({
      passport_number: passport_number.trim().toUpperCase(),
      nama:            nama ? nama.trim().toUpperCase() : undefined,
      no_kartu_pmi:    no_kartu_pmi || undefined,
      lembaga:         lembaga || "BP2MI",
      tgl_terbit:      tgl_terbit ? new Date(tgl_terbit) : undefined,
      tgl_berlaku:     tgl_berlaku ? new Date(tgl_berlaku) : undefined,
      negara_tujuan:   negara_tujuan || undefined,
      catatan:         catatan.trim(),
      imei_reg_id:     imei_reg_id ? Number(imei_reg_id) : undefined,
      dokumen,
      ...userInfo(req),
    });

    res.status(201).json({ status: "ok", data: record });
  } catch (err) {
    (req.files || []).forEach(f => fs.unlink(f.path, () => {}));
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ── POST /api/pmi/records/:id/dokumen — tambah dokumen ke record existing ─────
router.post("/records/:id/dokumen", upload.array("dokumen", 5), async (req, res) => {
  try {
    const record = await PmiRecord.findById(req.params.id);
    if (!record) {
      (req.files || []).forEach(f => fs.unlink(f.path, () => {}));
      return res.status(404).json({ status: "error", message: "Record tidak ditemukan" });
    }

    const newDokumen = (req.files || []).map(f => ({
      filename:     f.filename,
      originalname: f.originalname,
      mimetype:     f.mimetype,
      size:         f.size,
    }));

    record.dokumen.push(...newDokumen);
    await record.save();

    res.json({ status: "ok", data: record });
  } catch (err) {
    (req.files || []).forEach(f => fs.unlink(f.path, () => {}));
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ── PATCH /api/pmi/records/:id/status — revoke atau re-confirm ───────────────
router.patch("/records/:id/status", async (req, res) => {
  try {
    const { status, catatan } = req.body;
    if (!["CONFIRMED", "PENDING", "REVOKED"].includes(status)) {
      return res.status(400).json({ status: "error", message: "Status tidak valid" });
    }
    const record = await PmiRecord.findByIdAndUpdate(
      req.params.id,
      { status, ...(catatan ? { catatan } : {}) },
      { new: true }
    );
    if (!record) return res.status(404).json({ status: "error", message: "Record tidak ditemukan" });
    res.json({ status: "ok", data: record });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ── GET /api/pmi/stats — statistik untuk PMI Intel dashboard ─────────────────
router.get("/stats", async (req, res) => {
  try {
    const df = req.query.date_from ? new Date(req.query.date_from) : null;
    const dt = req.query.date_to   ? new Date(req.query.date_to)   : null;
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const filter = { status: "CONFIRMED" };
    if (df || dt) {
      filter.tagged_at = {};
      if (df) filter.tagged_at.$gte = df;
      if (dt) filter.tagged_at.$lte = dt;
    }

    const [candidates, byLembaga, byPetugas, monthlyTrend, totalCount] = await Promise.all([
      // Daftar kandidat (dedup by passport, ambil yang terbaru)
      PmiRecord.aggregate([
        { $match: filter },
        { $sort: { tagged_at: -1 } },
        { $group: {
          _id: "$passport_number",
          passport_number: { $first: "$passport_number" },
          nama:            { $first: "$nama" },
          lembaga:         { $first: "$lembaga" },
          no_kartu_pmi:    { $first: "$no_kartu_pmi" },
          negara_tujuan:   { $first: "$negara_tujuan" },
          catatan:         { $first: "$catatan" },
          tagged_by_nama:  { $first: "$tagged_by_nama" },
          tagged_by_nip:   { $first: "$tagged_by_nip" },
          tagged_at:       { $first: "$tagged_at" },
          has_dokumen:     { $first: { $gt: [{ $size: "$dokumen" }, 0] } },
          total_records:   { $sum: 1 },
        }},
        { $sort: { tagged_at: -1 } },
        { $limit: limit },
      ]),

      // Distribusi per lembaga
      PmiRecord.aggregate([
        { $match: filter },
        { $group: { _id: "$lembaga", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Distribusi per petugas (top 10)
      PmiRecord.aggregate([
        { $match: filter },
        { $group: { _id: "$tagged_by_nama", nip: { $first: "$tagged_by_nip" }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),

      // Trend bulanan
      PmiRecord.aggregate([
        { $match: { ...filter, tagged_at: { ...(filter.tagged_at || {}), $ne: null } } },
        { $group: {
          _id: { y: { $year: "$tagged_at" }, m: { $month: "$tagged_at" } },
          count: { $sum: 1 },
        }},
        { $sort: { "_id.y": 1, "_id.m": 1 } },
        { $limit: 24 },
      ]),

      // Total unik paspor PMI
      PmiRecord.aggregate([
        { $match: filter },
        { $group: { _id: "$passport_number" } },
        { $count: "total" },
      ]),
    ]);

    res.json({
      status: "ok",
      data: {
        summary: {
          total_candidates: totalCount?.[0]?.total || 0,
          returned: candidates.length,
          is_truncated: candidates.length >= limit,
        },
        by_lembaga:    byLembaga,
        by_petugas:    byPetugas,
        monthly_trend: monthlyTrend,
        candidates,
      },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ── POST /api/pmi/ocr — scan dokumen PMI, kembalikan field hasil OCR ──────────
// Frontend upload 1 gambar → pre-fill form modal, petugas koreksi → submit manual
router.post("/ocr", upload.single("dokumen"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: "error", message: "Tidak ada file yang diupload" });
  }
  try {
    const result = await extractPmiFromImage(req.file.path);
    // Hapus file tmp OCR setelah selesai (file asli tetap untuk disimpan saat konfirmasi)
    // Biarkan file tetap di uploads/pmi — bisa dipakai ulang saat submit form
    res.json({
      status: "ok",
      data: {
        fields: result.fields,
        confidence: result.fields?._confidence || "LOW",
        preview: result.fields?._raw_text_preview || "",
        filename: req.file.filename,  // dikirim balik ke frontend untuk disertakan saat submit
        ok: result.ok,
        error: result.error || null,
      },
    });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ status: "error", message: err.message });
  }
});

module.exports = router;
