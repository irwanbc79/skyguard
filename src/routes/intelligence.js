/**
 * ============================================================
 *  SKYGUARD INTELLIGENCE RADAR — API Routes
 * ============================================================
 */
const express = require("express");
const router = express.Router();
const intelligence = require("../services/intelligenceService");

function toPositiveInt(value, fallback, min = 1, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

// GET /api/intelligence/radar — Main dashboard overview
router.get("/radar", async (req, res) => {
  try {
    const data = await intelligence.getRadarOverview();
    res.json({ status: "ok", data });
  } catch (err) {
    console.error("[Intelligence Radar]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// GET /api/intelligence/ghosts — Ghost passengers (manifest only, no CEISA)
router.get("/ghosts", async (req, res) => {
  try {
    const page = toPositiveInt(req.query.page, 1, 1, 1000000);
    const limit = toPositiveInt(req.query.limit, 50, 1, 200);
    const data = await intelligence.getGhostPassengers(page, limit);
    res.json({ status: "ok", data });
  } catch (err) {
    console.error("[Intelligence Ghosts]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// GET /api/intelligence/mismatches — Name mismatches (same passport, different names)
router.get("/mismatches", async (req, res) => {
  try {
    const page = toPositiveInt(req.query.page, 1, 1, 1000000);
    const limit = toPositiveInt(req.query.limit, 50, 1, 200);
    const data = await intelligence.getNameMismatches(page, limit);
    res.json({ status: "ok", data });
  } catch (err) {
    console.error("[Intelligence Mismatches]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// GET /api/intelligence/frequent — Frequent travelers
router.get("/frequent", async (req, res) => {
  try {
    const minFlights = toPositiveInt(req.query.min, 3, 1, 500);
    const page = toPositiveInt(req.query.page, 1, 1, 1000000);
    const limit = toPositiveInt(req.query.limit, 50, 1, 200);
    const data = await intelligence.getFrequentTravelers(
      minFlights,
      page,
      limit,
    );
    res.json({ status: "ok", data });
  } catch (err) {
    console.error("[Intelligence Frequent]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// GET /api/intelligence/watchlist — Watchlist cross-reference
router.get("/watchlist", async (req, res) => {
  try {
    const data = await intelligence.getWatchlistHits();
    res.json({ status: "ok", data });
  } catch (err) {
    console.error("[Intelligence Watchlist]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// GET /api/intelligence/multi-identity — Multi-identity anomalies
router.get("/multi-identity", async (req, res) => {
  try {
    const page = toPositiveInt(req.query.page, 1, 1, 1000000);
    const limit = toPositiveInt(req.query.limit, 50, 1, 200);
    const data = await intelligence.getMultiIdentity(page, limit);
    res.json({ status: "ok", data });
  } catch (err) {
    console.error("[Intelligence Multi-Identity]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

module.exports = router;
