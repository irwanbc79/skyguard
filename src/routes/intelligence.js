const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/intelligenceController');

// Cari riwayat penerbangan berdasarkan nomor paspor
router.get('/passport/:doc_number', ctrl.searchByPassport);

// Cari berdasarkan nama
router.get('/search/name', ctrl.searchByName);

// Pencarian lanjutan multi-kriteria
router.get('/search', ctrl.advancedSearch);

// Statistik intelijen global
router.get('/stats', ctrl.getIntelStats);

// Profil intelijen satu penerbangan
router.get('/flight', ctrl.getFlightIntelligence);

module.exports = router;
