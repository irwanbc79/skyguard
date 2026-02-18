const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/intelligenceController');

// ── Pencarian Intelijen ───────────────────────────────────────────────────────
router.get('/passport/:doc_number', ctrl.searchByPassport);   // Profil lengkap + CEISA
router.get('/search/name', ctrl.searchByName);                 // Cari by nama
router.get('/search', ctrl.advancedSearch);                    // Multi-kriteria
router.get('/stats', ctrl.getIntelStats);                      // Statistik global
router.get('/flight', ctrl.getFlightIntelligence);             // Profil satu penerbangan

// ── Watchlist Paspor ─────────────────────────────────────────────────────────
router.get('/watchlist', ctrl.getWatchlist);                   // Daftar watchlist
router.post('/watchlist', ctrl.addToWatchlist);                // Tambah ke watchlist
router.put('/watchlist/:id', ctrl.updateWatchlist);            // Edit watchlist
router.delete('/watchlist/:id', ctrl.removeFromWatchlist);     // Nonaktifkan
router.get('/watchlist/hits', ctrl.checkWatchlistHits);        // Cek manifest hits

module.exports = router;
