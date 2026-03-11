/**
 * ============================================================
 *  SKYGUARD QSVM ROUTES — Quantum SVM Under-Invoicing Detection API
 * ============================================================
 */
const express = require("express");
const router = express.Router();
const qsvmService = require("../services/qsvmService");

// ==========================================
// 1. RUN SCAN — Execute QSVM on CN-PIBK data
//    GET /api/qsvm/scan?limit=100&dateFrom=&dateTo=
// ==========================================
router.get("/scan", async (req, res) => {
  try {
    const { limit, dateFrom, dateTo } = req.query;
    const result = await qsvmService.runScan({
      limit: parseInt(limit) || 100,
      dateFrom,
      dateTo,
    });
    res.json({ success: true, ...result });
  } catch (e) {
    console.error("[QSVM Scan]", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==========================================
// 2. RESULTS — Get recent scan results
//    GET /api/qsvm/results?page=1&limit=10
// ==========================================
router.get("/results", async (req, res) => {
  try {
    const { page, limit } = req.query;
    const result = await qsvmService.getResults({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
    });
    res.json({ success: true, ...result });
  } catch (e) {
    console.error("[QSVM Results]", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==========================================
// 3. STATS — QSVM statistics overview
//    GET /api/qsvm/stats
// ==========================================
router.get("/stats", async (req, res) => {
  try {
    const stats = await qsvmService.getStats();
    res.json({ success: true, ...stats });
  } catch (e) {
    console.error("[QSVM Stats]", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==========================================
// 4. DETAIL — Get specific scan detail
//    GET /api/qsvm/detail/:scanId
// ==========================================
router.get("/detail/:scanId", async (req, res) => {
  try {
    const result = await qsvmService.getScanDetail(req.params.scanId);
    if (!result) {
      return res
        .status(404)
        .json({ success: false, error: "Scan not found" });
    }
    res.json({ success: true, data: result });
  } catch (e) {
    console.error("[QSVM Detail]", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==========================================
// 5. SELF-TEST — Check if QSVM engine is working
//    GET /api/qsvm/test
// ==========================================
router.get("/test", async (req, res) => {
  try {
    const result = await qsvmService.selfTest();
    res.json({ success: true, ...result });
  } catch (e) {
    console.error("[QSVM Test]", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
