const express = require('express');
const router = express.Router();
const { scrapeKurs, getAllKurs, getKurs, setKurs, hitungPajak } = require('../services/kursService');

// GET /api/kurs - Ambil kurs USD (default)
router.get('/', (req, res) => {
  res.json({ status: 'ok', data: getKurs('USD') });
});

// GET /api/kurs/all - Ambil semua kurs
router.get('/all', (req, res) => {
  res.json({ status: 'ok', data: getAllKurs() });
});

// GET /api/kurs/:code - Ambil kurs spesifik
router.get('/:code', (req, res) => {
  const data = getKurs(req.params.code.toUpperCase());
  if (!data) return res.status(404).json({ status: 'error', message: 'Currency not found' });
  res.json({ status: 'ok', data });
});

// POST /api/kurs/refresh - Scrape kurs terbaru
router.post('/refresh', async (req, res) => {
  const kurs = await scrapeKurs();
  res.json({ status: 'ok', data: kurs });
});

// POST /api/kurs/set - Set kurs manual
router.post('/set', (req, res) => {
  const { code, rate } = req.body;
  if (!code || !rate || rate < 0) {
    return res.status(400).json({ status: 'error', message: 'Invalid data' });
  }
  res.json({ status: 'ok', data: setKurs(code.toUpperCase(), rate) });
});

// POST /api/kurs/hitung - Hitung pajak
router.post('/hitung', (req, res) => {
  const { fob_usd, jumlah_unit, currency } = req.body;
  if (!fob_usd || fob_usd < 0) {
    return res.status(400).json({ status: 'error', message: 'FOB USD tidak valid' });
  }
  res.json({ status: 'ok', data: hitungPajak(fob_usd, jumlah_unit || 1, currency || 'USD') });
});

module.exports = router;
