const express = require("express");
const router = express.Router();
const fs = require("../services/flightService");

// GET /api/flights/board - Flight board KNO (?filter=all|international)
router.get("/board", (req, res) => {
  try {
    const filter = req.query.filter || "all";
    res.json({ status: "ok", data: fs.getBoard(filter) });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// GET /api/flights/positions - Live positions of tracked flights
router.get("/positions", (req, res) => {
  try {
    res.json({ status: "ok", data: fs.getPositions() });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// GET /api/flights/alerts - Geofence & delay alerts
router.get("/alerts", (req, res) => {
  try {
    res.json({ status: "ok", data: fs.getAlerts() });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// GET /api/flights/status - System status, credits usage
router.get("/status", (req, res) => {
  try {
    res.json({ status: "ok", data: fs.getStatus() });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// POST /api/flights/api-key - Set FR24 API key (protected)
router.post("/api-key", (req, res) => {
  try {
    const { key } = req.body;
    if (!key)
      return res
        .status(400)
        .json({ status: "error", message: "API key required" });
    fs.setApiKey(key);
    res.json({
      status: "ok",
      message: "API key updated, fetching live data...",
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// GET /api/flights/usage - FR24 API credit usage
router.get("/usage", async (req, res) => {
  try {
    const usage = await fs.fetchUsage();
    res.json({ status: "ok", data: usage });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// GET /api/flights/customs-intel - Cross-reference flights with manifest/passenger/suspect data
router.get("/customs-intel", async (req, res) => {
  try {
    const Manifest = require("../models/Manifest");
    const ManifestPassenger = require("../models/ManifestPassenger");
    const Suspect = require("../models/Suspect");

    // Get current board flights
    const board = fs.getBoard("all");
    const flights = board.flights || [];

    if (!flights.length) {
      return res.json({
        status: "ok",
        data: {
          intel: [],
          summary: { total: 0, intl: 0, with_manifest: 0, suspect_hits: 0 },
        },
      });
    }

    // --- Build flexible manifest matching ---
    // FR24: "QZ327", "AK13", "JT132"
    // DB:   "QZ 102", "JT 0132", "AK 390", "102" (number-only)
    // Strategy: normalize to {carrier}{numericPart} and match both ways

    // Extract unique flight number parts from FR24 flights
    const flightParts = []; // [{raw, carrier, num, normalized}]
    const seenNormalized = new Set();
    for (const f of flights) {
      const fn = (f.flight_number || "").replace(/\s|-/g, "");
      if (!fn) continue;
      const m = fn.match(/^([A-Z]{2,3})0*(\d+)$/i);
      const carrier = m ? m[1].toUpperCase() : "";
      const num = m ? m[2] : fn;
      const normalized = (carrier + num).toUpperCase();
      if (!seenNormalized.has(normalized)) {
        seenNormalized.add(normalized);
        flightParts.push({ raw: fn, carrier, num, normalized });
      }
    }

    // Build OR conditions for manifest lookup
    // Match: "QZ 102" or "QZ102" or "102" (number-only) or "QZ 0102" (leading zeros)
    const manifestOrConditions = [];
    for (const fp of flightParts) {
      if (fp.carrier) {
        // Match with/without spaces, with/without leading zeros
        // e.g. QZ327 should match "QZ 327", "QZ327", "QZ 0327", "327"
        const re = new RegExp(
          "^" + fp.carrier + "\\s*-?\\s*0*" + fp.num + "$",
          "i",
        );
        manifestOrConditions.push({ flight_number: re });
        // Also match number-only (e.g. "327" when carrier is QZ)
        manifestOrConditions.push({
          flight_number: new RegExp("^0*" + fp.num + "$"),
        });
      } else {
        manifestOrConditions.push({
          flight_number: new RegExp(
            "^0*" + fp.num.replace(/^0+/, "") + "$",
            "i",
          ),
        });
      }
    }

    // Parallel queries
    const [manifests, suspectPassports] = await Promise.all([
      manifestOrConditions.length > 0
        ? Manifest.find({ $or: manifestOrConditions })
            .select(
              "flight_number flight_date origin destination status carrier direction source sender email_subject received_at filename",
            )
            .sort({ received_at: -1 })
            .lean()
        : Promise.resolve([]),
      Suspect.find({ status: { $ne: "CLEARED" } })
        .select("passport_number full_name risk_level categories")
        .lean(),
    ]);

    const suspectMap = new Map();
    suspectPassports.forEach((s) => {
      if (s.passport_number) suspectMap.set(s.passport_number.toUpperCase(), s);
    });

    // Build manifest-to-flight mapping using normalized keys
    // A manifest "QZ 102" normalizes to "QZ102", matches FR24 "QZ102"
    // A manifest "102" (number-only) must try matching by checking if any FR24 flight has that numeric part
    const manifestFlightMap = {}; // normalized flight key -> manifest[]
    const numOnlyManifests = []; // manifests with number-only flight_number

    manifests.forEach((m) => {
      const fn = (m.flight_number || "").replace(/\s|-/g, "");
      const mm = fn.match(/^([A-Z]{2,3})0*(\d+)$/i);
      if (mm) {
        const key = (mm[1] + mm[2]).toUpperCase();
        if (!manifestFlightMap[key]) manifestFlightMap[key] = [];
        manifestFlightMap[key].push(m);
      } else {
        // Number-only manifest
        numOnlyManifests.push(m);
      }
    });

    // Try to match number-only manifests to FR24 flights by numeric suffix
    for (const m of numOnlyManifests) {
      const numPart = (m.flight_number || "").replace(/^0+/, "");
      // Find FR24 flight whose numeric part matches
      for (const fp of flightParts) {
        if (fp.num === numPart) {
          const key = fp.normalized;
          if (!manifestFlightMap[key]) manifestFlightMap[key] = [];
          manifestFlightMap[key].push(m);
          break; // First match only
        }
      }
    }

    // Get manifest IDs for passenger queries
    const allManifestIds = manifests.map((m) => m._id);

    // Get passenger counts and suspect hits per manifest
    let paxData = [];
    if (allManifestIds.length > 0) {
      paxData = await ManifestPassenger.aggregate([
        { $match: { manifest_id: { $in: allManifestIds } } },
        {
          $group: {
            _id: "$flight_number",
            total_pax: { $sum: 1 },
            checked_in: {
              $sum: { $cond: [{ $eq: ["$status", "checked_in"] }, 1, 0] },
            },
            with_passport: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ["$passport_number", null] },
                      { $ne: ["$passport_number", ""] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            passports: { $addToSet: "$passport_number" },
            nationalities: { $addToSet: "$nationality" },
          },
        },
      ]);
    }

    // Build pax map (normalize keys same way)
    const paxMap = {};
    paxData.forEach((p) => {
      const fn = (p._id || "").replace(/\s|-/g, "");
      const mm = fn.match(/^([A-Z]{2,3})0*(\d+)$/i);
      const key = mm
        ? (mm[1] + mm[2]).toUpperCase()
        : fn.replace(/^0+/, "").toUpperCase();
      const passports = (p.passports || [])
        .filter(Boolean)
        .map((pp) => pp.toUpperCase());
      const suspectHits = passports.filter((pp) => suspectMap.has(pp));
      const nationalities = (p.nationalities || []).filter(Boolean);
      // Merge if key already exists (multiple manifest variants for same flight)
      if (paxMap[key]) {
        paxMap[key].total_pax += p.total_pax;
        paxMap[key].checked_in += p.checked_in;
        paxMap[key].with_passport += p.with_passport;
        paxMap[key].suspect_hits += suspectHits.length;
        paxMap[key].suspect_names.push(
          ...suspectHits
            .map((pp) => suspectMap.get(pp)?.full_name)
            .filter(Boolean),
        );
      } else {
        paxMap[key] = {
          total_pax: p.total_pax,
          checked_in: p.checked_in,
          with_passport: p.with_passport,
          suspect_hits: suspectHits.length,
          suspect_names: suspectHits
            .map((pp) => suspectMap.get(pp)?.full_name)
            .filter(Boolean),
          nationalities: nationalities.slice(0, 10),
        };
      }
    });

    // Build intel per flight
    let totalSuspectHits = 0;
    let withManifest = 0;
    const intel = flights.map((f) => {
      const fn = (f.flight_number || "").replace(/\s|-/g, "");
      const mm = fn.match(/^([A-Z]{2,3})0*(\d+)$/i);
      const normalizedKey = mm
        ? (mm[1] + mm[2]).toUpperCase()
        : fn.toUpperCase();
      const mList = manifestFlightMap[normalizedKey] || [];
      const pax = paxMap[normalizedKey] || null;
      const hasManifest = mList.length > 0;
      if (hasManifest) withManifest++;

      const suspectCount = pax?.suspect_hits || 0;
      totalSuspectHits += suspectCount;

      // Customs risk assessment
      let risk = "low";
      if (suspectCount > 0) risk = "critical";
      else if (f.is_international && !hasManifest && f.is_arrival)
        risk = "high";
      else if (f.is_international) risk = "medium";

      // Manifest detail: email receipt info
      let manifestDetail = null;
      if (hasManifest) {
        // Get the most recent manifest
        const latest = mList[0]; // already sorted by received_at desc
        // Count doc types
        const docTypes = {};
        mList.forEach((md) => {
          const fmt =
            md.parsed_fields?.format || md.parsed_fields?.doc_type || md.status;
          docTypes[fmt] = (docTypes[fmt] || 0) + 1;
        });
        manifestDetail = {
          total_files: mList.length,
          latest_received: latest.received_at,
          latest_status: latest.status,
          latest_source: latest.source,
          latest_sender: latest.sender || null,
          latest_filename: latest.filename || null,
          doc_types: docTypes,
          statuses: [...new Set(mList.map((md) => md.status))],
        };
      }

      return {
        flight_number: f.flight_number || f.callsign,
        callsign: f.callsign,
        airline: f.airline,
        origin: f.origin,
        destination: f.destination,
        is_arrival: f.is_arrival,
        is_international: f.is_international,
        status: f.status,
        sched_time: f.sched_time || null,
        est_time: f.est_time,
        landing_time: f.landing_time || null,
        aircraft: f.aircraft,
        registration: f.registration,
        // Customs intel
        has_manifest: hasManifest,
        manifest_count: mList.length,
        manifest_status: mList[0]?.status || null,
        manifest_detail: manifestDetail,
        direction:
          mList[0]?.direction || (f.is_arrival ? "inbound" : "outbound"),
        pax_total: pax?.total_pax || 0,
        pax_checked_in: pax?.checked_in || 0,
        pax_with_passport: pax?.with_passport || 0,
        suspect_hits: suspectCount,
        suspect_names: pax?.suspect_names || [],
        nationalities: pax?.nationalities || [],
        customs_risk: risk,
      };
    });

    // Sort: critical first, then international arrivals, then by ETA
    intel.sort((a, b) => {
      const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      if (riskOrder[a.customs_risk] !== riskOrder[b.customs_risk])
        return riskOrder[a.customs_risk] - riskOrder[b.customs_risk];
      if (a.is_international !== b.is_international)
        return a.is_international ? -1 : 1;
      if (a.is_arrival !== b.is_arrival) return a.is_arrival ? -1 : 1;
      return 0;
    });

    const intlCount = flights.filter((f) => f.is_international).length;

    res.json({
      status: "ok",
      data: {
        intel,
        summary: {
          total: flights.length,
          intl: intlCount,
          domestic: flights.length - intlCount,
          arrivals: flights.filter((f) => f.is_arrival).length,
          departures: flights.filter((f) => !f.is_arrival).length,
          with_manifest: withManifest,
          without_manifest: intlCount - withManifest,
          suspect_hits: totalSuspectHits,
          intl_arrivals: flights.filter(
            (f) => f.is_international && f.is_arrival,
          ).length,
          intl_departures: flights.filter(
            (f) => f.is_international && !f.is_arrival,
          ).length,
        },
        updated_at: board.updated_at,
        source: board.source,
      },
    });
  } catch (err) {
    console.error("[Customs Intel]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

module.exports = router;
