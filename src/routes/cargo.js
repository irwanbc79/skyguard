const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cargoService = require('../services/cargoService');

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = '/root/skyguard/uploads/cargo';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `cnpibk_${Date.now()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage });

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
router.post('/upload', upload.single('file'), async (req, res) => {
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
