const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const cargoService = require('../services/cargoService');

// Rate limiter khusus upload
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { status: 'error', message: 'Terlalu banyak upload, coba lagi nanti' }
});

// Allowed file extensions
const allowedExtensions = ['.csv', '.xlsx', '.xls'];

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/cargo');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `cnpibk_${Date.now()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file CSV dan Excel (.csv, .xlsx, .xls) yang diizinkan'));
    }
  }
});

// GET /api/cargo/stats - Executive Dashboard Statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await cargoService.getStats();
    res.json(stats);
  } catch (e) {
    console.error('Stats error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/cargo/search - Search CN-PIBK
router.get('/search', async (req, res) => {
  try {
    const result = await cargoService.search(req.query);
    res.json(result);
  } catch (e) {
    console.error('Search error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/cargo/detail/:nomorAju - Get single record
router.get('/detail/:nomorAju', async (req, res) => {
  try {
    const doc = await cargoService.getByNomorAju(req.params.nomorAju);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/cargo/upload - Upload CN-PIBK CSV/Excel
router.post('/upload', uploadLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const uploadedBy = req.body.uploaded_by || 'Anonymous';
    const stats = await cargoService.importCnpibk(req.file.path, uploadedBy);

    // Cleanup uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      message: `Import selesai: ${stats.new} baru, ${stats.duplicate} update, ${stats.error} error`,
      stats
    });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/cargo/upload-logs - Get upload history
router.get('/upload-logs', async (req, res) => {
  try {
    const logs = await cargoService.getUploadLogs();
    res.json(logs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
