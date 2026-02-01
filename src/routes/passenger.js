const express = require('express');
const router = express.Router();
const multer = require('multer');
const ps = require('../services/passengerService');
const upload = multer({ storage: multer.memoryStorage() });

router.get('/stats', async (req, res) => {
  try { res.json({ status: 'ok', data: await ps.getStats() }); }
  catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

router.get('/repeaters', async (req, res) => {
  try { res.json({ status: 'ok', data: await ps.getRepeaters(parseInt(req.query.min) || 5) }); }
  catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

router.get('/upload-logs', async (req, res) => {
  try { res.json({ status: 'ok', data: await ps.getUploadLogs() }); }
  catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

router.get('/:paspor', async (req, res) => {
  try {
    const result = await ps.getByPaspor(req.params.paspor);
    if (!result) return res.status(404).json({ status: 'error', message: 'Paspor tidak ditemukan' });
    res.json({ status: 'ok', data: result });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ status: 'error', message: 'No file' });
    const lines = req.file.buffer.toString('utf-8').split('\n').filter(l => l.trim());
    const result = await ps.importCSV(lines, req.body.uploaded_by || 'Unknown', req.file.originalname);
    res.json({ status: 'ok', data: { filename: req.file.originalname, uploaded_by: req.body.uploaded_by, ...result } });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

module.exports = router;
