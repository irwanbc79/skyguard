const express = require('express');
const router = express.Router();
const { getAllKurs, getKurs, setKurs, bulkUpdateKurs, scrapeKurs, hitungPajak } = require('../services/kursService');

// GET /api/kurs - Ambil kurs USD (default)
router.get('/', async (req, res) => {
  try {
    const data = await getKurs('USD');
    res.json({ status: 'ok', data });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

// GET /api/kurs/all - Ambil semua kurs
router.get('/all', async (req, res) => {
  try {
    const data = await getAllKurs();
    res.json({ status: 'ok', data });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

// GET /api/kurs/:code - Ambil kurs spesifik
router.get('/:code', async (req, res) => {
  try {
    const data = await getKurs(req.params.code.toUpperCase());
    if (!data) return res.status(404).json({ status: 'error', message: 'Currency not found' });
    res.json({ status: 'ok', data });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

// POST /api/kurs/refresh - Scrape kurs terbaru
router.post('/refresh', async (req, res) => {
  try {
    const data = await scrapeKurs();
    res.json({ status: 'ok', data, message: 'Kurs refreshed from Kemenkeu' });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

// POST /api/kurs/set - Set kurs manual (single)
router.post('/set', async (req, res) => {
  try {
    const { code, rate } = req.body;
    if (!code || !rate || rate < 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid data' });
    }
    const data = await setKurs(code.toUpperCase(), rate);
    res.json({ status: 'ok', data });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

// POST /api/kurs/bulk-update - Bulk update kurs (admin)
router.post('/bulk-update', async (req, res) => {
  try {
    const { currencies, periode, kmk_number, updated_by } = req.body;
    if (!currencies || !Array.isArray(currencies) || !periode) {
      return res.status(400).json({ status: 'error', message: 'currencies array and periode required' });
    }
    const result = await bulkUpdateKurs(currencies, periode, kmk_number, updated_by || 'admin');
    res.json(result);
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

// POST /api/kurs/hitung - Hitung pajak
router.post('/hitung', async (req, res) => {
  try {
    const { fob_usd, jumlah_unit, currency } = req.body;
    if (!fob_usd || fob_usd < 0) {
      return res.status(400).json({ status: 'error', message: 'FOB USD tidak valid' });
    }
    const data = await hitungPajak(fob_usd, jumlah_unit || 1, currency || 'USD');
    res.json({ status: 'ok', data });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

module.exports = router;
