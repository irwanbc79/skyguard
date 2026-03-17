/**
 * ============================================================
 * PUSAT INTELIJEN — Intelligence Center API
 * Comprehensive search, tracking, and flight route mapping
 * for customs officers at BC Kualanamu
 * ============================================================
 */
const express = require("express");
const router = express.Router();
const ManifestPassenger = require("../models/ManifestPassenger");
const Manifest = require("../models/Manifest");
const Passenger = require("../models/Passenger");
const ImeiRegistration = require("../models/ImeiRegistration");
const ImeiDetail = require("../models/ImeiDetail");
const Suspect = require("../models/Suspect");
const { getKantorName, AIRPORTS } = require("../utils/constants");

function kantorName(c) {
  return getKantorName(c);
}

// ─── Utility: Detect search type ───
function detectSearchType(q) {
  if (!q) return "unknown";
  q = q.trim();
  if (/^\d{15}$/.test(q)) return "imei";
  if (/^[A-Z]{1,2}\s?\d{2,4}$/i.test(q)) return "flight";
  if (
    /^[A-Z]\d{7,8}[A-Z]?$/i.test(q) ||
    /^[A-Z]{2}\d{6,7}$/i.test(q) ||
    /^\d{9,}$/.test(q)
  )
    return "passport";
  if (/^[A-Z]{6}$/i.test(q)) return "pnr";
  if (/[A-Za-z]{2,}/.test(q)) return "name";
  return "passport"; // fallback
}

// ============================================================
// 1) ADVANCED SEARCH — Multi-source unified search
//    GET /api/intel/search?q=...&type=auto&dateFrom=&dateTo=&nationality=
// ============================================================
router.get("/search", async (req, res) => {
  try {
    const { q, type = "auto", dateFrom, dateTo, nationality } = req.query;
    if (!q || q.trim().length < 2)
      return res
        .status(400)
        .json({ status: "error", message: "Query minimal 2 karakter" });

    const query = q.trim();
    const searchType = type === "auto" ? detectSearchType(query) : type;
    const results = [];
    const dateFilter = {};
    if (dateFrom) dateFilter.$gte = new Date(dateFrom);
    if (dateTo) dateFilter.$lte = new Date(dateTo + "T23:59:59Z");
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    if (searchType === "passport" || searchType === "name") {
      const isPassport = searchType === "passport";
      const mpQuery = isPassport
        ? { passport_number: new RegExp("^" + escaped + "$", "i") }
        : { name: new RegExp(escaped, "i") };
      if (hasDateFilter) mpQuery.flight_date = dateFilter;
      if (nationality)
        mpQuery.nationality = new RegExp("^" + nationality + "$", "i");

      // Parallel: ManifestPassenger aggregate + CEISA + ImeiDetail + Suspect
      const [mpAgg, ceisaPax, imeiDetails, suspects] = await Promise.all([
        ManifestPassenger.aggregate([
          { $match: mpQuery },
          {
            $group: {
              _id: isPassport
                ? { $toUpper: "$passport_number" }
                : { $toUpper: "$name" },
              name: { $first: "$name" },
              passport_number: { $first: "$passport_number" },
              nationality: { $first: "$nationality" },
              gender: { $first: "$gender" },
              total_flights: { $sum: 1 },
              first_seen: { $min: "$flight_date" },
              last_seen: { $max: "$flight_date" },
              flights: {
                $addToSet: {
                  flight_number: "$flight_number",
                  flight_date: "$flight_date",
                },
              },
            },
          },
          { $sort: { total_flights: -1 } },
          { $limit: 50 },
        ]).option({ maxTimeMS: 15000 }),

        isPassport
          ? Passenger.find({ paspor: new RegExp("^" + escaped + "$", "i") })
              .sort({ tanggal_dokumen: -1 })
              .limit(20)
              .lean()
          : Passenger.find({ nama_lengkap: new RegExp(escaped, "i") })
              .sort({ tanggal_dokumen: -1 })
              .limit(20)
              .lean(),

        isPassport
          ? ImeiDetail.find({
              no_identitas: new RegExp("^" + escaped + "$", "i"),
            })
              .sort({ waktu_kedatangan: -1 })
              .limit(20)
              .lean()
          : ImeiDetail.find({ nama: new RegExp(escaped, "i") })
              .sort({ waktu_kedatangan: -1 })
              .limit(20)
              .lean(),

        Suspect.find(
          isPassport
            ? { passport_number: new RegExp("^" + escaped + "$", "i") }
            : { full_name: new RegExp(escaped, "i") },
        )
          .limit(10)
          .lean(),
      ]);

      // Build unified results
      const seenPassports = new Set();
      for (const mp of mpAgg) {
        const pp = (mp.passport_number || "").toUpperCase();
        if (pp) seenPassports.add(pp);
        const isSuspect = suspects.some(
          (s) => s.passport_number?.toUpperCase() === pp,
        );
        results.push({
          type: "passenger",
          source: "manifest",
          passport_number: mp.passport_number,
          name: mp.name,
          nationality: mp.nationality,
          gender: mp.gender,
          total_flights: mp.total_flights,
          first_seen: mp.first_seen,
          last_seen: mp.last_seen,
          is_suspect: isSuspect,
          ceisa_count: ceisaPax.filter((c) => c.paspor?.toUpperCase() === pp)
            .length,
          imei_count: imeiDetails.filter(
            (d) => d.no_identitas?.toUpperCase() === pp,
          ).length,
        });
      }

      // CEISA-only passengers not already in manifest results
      const ceisaGroups = {};
      for (const c of ceisaPax) {
        const pp = (c.paspor || "").toUpperCase();
        if (seenPassports.has(pp)) continue;
        if (!ceisaGroups[pp]) {
          ceisaGroups[pp] = {
            name: c.nama_lengkap,
            passport_number: c.paspor,
            count: 0,
            last_date: c.tanggal_dokumen,
          };
        }
        ceisaGroups[pp].count++;
      }
      for (const g of Object.values(ceisaGroups)) {
        results.push({
          type: "passenger",
          source: "ceisa",
          passport_number: g.passport_number,
          name: g.name,
          nationality: null,
          gender: null,
          total_flights: 0,
          ceisa_count: g.count,
          imei_count: 0,
          last_seen: g.last_date,
          is_suspect: suspects.some(
            (s) =>
              s.passport_number?.toUpperCase() ===
              g.passport_number?.toUpperCase(),
          ),
        });
      }
    } else if (searchType === "flight") {
      const normalized = query.replace(/\s+/g, "").toUpperCase();
      const flightRegex = new RegExp(escaped.replace(/\s+/g, "\\s*"), "i");
      const mpQuery = { flight_number: flightRegex };
      if (hasDateFilter) mpQuery.flight_date = dateFilter;

      const [passengers, manifests] = await Promise.all([
        ManifestPassenger.aggregate([
          { $match: mpQuery },
          {
            $group: {
              _id: {
                $toUpper: {
                  $trim: { input: { $ifNull: ["$passport_number", "$name"] } },
                },
              },
              name: { $first: "$name" },
              passport_number: { $first: "$passport_number" },
              nationality: { $first: "$nationality" },
              gender: { $first: "$gender" },
              total_flights: { $sum: 1 },
              first_seen: { $min: "$flight_date" },
              last_seen: { $max: "$flight_date" },
              seats: { $addToSet: "$seat_no" },
            },
          },
          { $sort: { last_seen: -1 } },
          { $limit: 100 },
        ]).option({ maxTimeMS: 15000 }),
        Manifest.find({
          flight_number: flightRegex,
          status: { $in: ["synced", "parsed", "approved"] },
        })
          .sort({ flight_date: -1 })
          .limit(30)
          .lean(),
      ]);

      for (const p of passengers) {
        results.push({
          type: "passenger",
          source: "manifest",
          passport_number: p.passport_number,
          name: p.name,
          nationality: p.nationality,
          gender: p.gender,
          total_flights: p.total_flights,
          first_seen: p.first_seen,
          last_seen: p.last_seen,
          seats: p.seats,
        });
      }
    } else if (searchType === "imei") {
      const devices = await ImeiDetail.find({
        $or: [{ imei1: query }, { imei2: query }],
      })
        .sort({ waktu_kedatangan: -1 })
        .limit(20)
        .lean();

      for (const d of devices) {
        results.push({
          type: "device",
          source: "imei",
          passport_number: d.no_identitas,
          name: d.nama,
          imei1: d.imei1,
          imei2: d.imei2,
          merk: d.merk,
          tipe: d.tipe,
          storage: d.storage,
          harga_fob_usd: d.harga_fob_usd,
          arrival_date: d.waktu_kedatangan,
          flight: d.flight_voyage,
          kantor: kantorName(d.kode_kantor),
          cara_pembayaran: d.cara_pembayaran,
        });
      }
    } else if (searchType === "pnr") {
      const pnrRegex = new RegExp("^" + escaped + "$", "i");
      const passengers = await ManifestPassenger.find({ pnr: pnrRegex })
        .sort({ flight_date: -1 })
        .limit(50)
        .lean();

      for (const p of passengers) {
        results.push({
          type: "passenger",
          source: "manifest",
          passport_number: p.passport_number,
          name: p.name,
          nationality: p.nationality,
          gender: p.gender,
          flight_number: p.flight_number,
          flight_date: p.flight_date,
          seat_no: p.seat_no,
          pnr: p.pnr,
        });
      }
    }

    // Sort: suspects first, then by activity
    results.sort((a, b) => {
      if (a.is_suspect && !b.is_suspect) return -1;
      if (!a.is_suspect && b.is_suspect) return 1;
      return (b.total_flights || 0) - (a.total_flights || 0);
    });

    res.json({
      status: "ok",
      search_type: searchType,
      query,
      total: results.length,
      data: results,
    });
  } catch (err) {
    console.error("[Intel Search]", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// 2) PASSENGER DOSSIER — Complete intelligence profile
//    GET /api/intel/dossier/:passport
// ============================================================
router.get("/dossier/:passport", async (req, res) => {
  try {
    const passport = req.params.passport.toUpperCase().trim();
    if (!passport || passport.length < 3)
      return res.status(400).json({ status: "error", message: "Invalid" });

    const esc = passport.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pRx = new RegExp("^" + esc + "$", "i");

    // Parallel fetch ALL data sources
    const [mpRecords, ceisaRecords, imeiRegs, imeiDetails, suspect] =
      await Promise.all([
        ManifestPassenger.find({ passport_number: pRx })
          .sort({ flight_date: -1 })
          .limit(300)
          .lean(),
        Passenger.find({ paspor: pRx })
          .sort({ tanggal_dokumen: -1 })
          .limit(100)
          .lean(),
        ImeiRegistration.find({ no_identitas: pRx })
          .sort({ tgl_kedatangan: -1 })
          .limit(100)
          .lean(),
        ImeiDetail.find({ no_identitas: pRx })
          .sort({ waktu_kedatangan: -1 })
          .limit(200)
          .lean(),
        Suspect.findOne({ passport_number: pRx }).lean(),
      ]);

    if (
      !mpRecords.length &&
      !ceisaRecords.length &&
      !imeiRegs.length &&
      !imeiDetails.length
    )
      return res.json({ status: "ok", data: { found: false } });

    // ─── Identity ───
    const identity = { passport_number: passport };
    const src = mpRecords[0] || {};
    identity.name =
      src.name || ceisaRecords[0]?.nama_lengkap || imeiDetails[0]?.nama || "-";
    identity.nationality = src.nationality || imeiDetails[0]?.kebangsaan || "-";
    identity.gender = src.gender || "-";

    // ─── Flight timeline (enrich with manifest origin/dest) ───
    const manifestIds = [
      ...new Set(mpRecords.map((r) => String(r.manifest_id))),
    ];
    const manifestDocs = await Manifest.find({
      _id: { $in: manifestIds },
    })
      .select("flight_number flight_date origin destination carrier direction")
      .lean();
    const manifestMap = {};
    manifestDocs.forEach((m) => (manifestMap[String(m._id)] = m));

    const flights = mpRecords.map((r) => {
      const m = manifestMap[String(r.manifest_id)] || {};
      return {
        flight_number: r.flight_number || m.flight_number,
        flight_date: r.flight_date || m.flight_date,
        origin: m.origin || "-",
        destination: m.destination || r.destination_code || "-",
        carrier: m.carrier || "-",
        direction: m.direction || m.direction || "-",
        seat_no: r.seat_no,
        pnr: r.pnr,
        status: r.status,
        pax_type: r.pax_type,
        bag_weight: r.bag_weight,
      };
    });

    // ─── Route statistics ───
    const routeCount = {};
    const airlineSet = new Set();
    const destCount = {};
    const originCount = {};
    for (const f of flights) {
      const route = `${f.origin}-${f.destination}`;
      routeCount[route] = (routeCount[route] || 0) + 1;
      if (f.carrier && f.carrier !== "-") airlineSet.add(f.carrier);
      if (f.destination && f.destination !== "-")
        destCount[f.destination] = (destCount[f.destination] || 0) + 1;
      if (f.origin && f.origin !== "-")
        originCount[f.origin] = (originCount[f.origin] || 0) + 1;
    }
    const topRoutes = Object.entries(routeCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([route, count]) => ({ route, count }));

    // ─── Flight map data (with coordinates) ───
    const routeLines = [];
    const airportMarkers = {};
    for (const f of flights) {
      const orig = AIRPORTS[f.origin];
      const dest = AIRPORTS[f.destination];
      if (orig && !airportMarkers[f.origin])
        airportMarkers[f.origin] = {
          code: f.origin,
          ...orig,
          count: 0,
          type: "origin",
        };
      if (dest && !airportMarkers[f.destination])
        airportMarkers[f.destination] = {
          code: f.destination,
          ...dest,
          count: 0,
          type: "destination",
        };
      if (airportMarkers[f.origin]) airportMarkers[f.origin].count++;
      if (airportMarkers[f.destination]) airportMarkers[f.destination].count++;
      if (orig && dest) {
        routeLines.push({
          from: f.origin,
          to: f.destination,
          fromCoords: [orig.lat, orig.lng],
          toCoords: [dest.lat, dest.lng],
          flight_number: f.flight_number,
          flight_date: f.flight_date,
        });
      }
    }

    // ─── Travel companions ───
    const companionManifestIds = mpRecords.map((r) => r.manifest_id);
    let companions = [];
    if (companionManifestIds.length > 0 && companionManifestIds.length <= 100) {
      const coPassengers = await ManifestPassenger.aggregate([
        {
          $match: {
            manifest_id: { $in: companionManifestIds },
            passport_number: { $exists: true, $ne: null, $not: pRx },
          },
        },
        {
          $group: {
            _id: { $toUpper: "$passport_number" },
            name: { $first: "$name" },
            nationality: { $first: "$nationality" },
            shared_flights: { $sum: 1 },
            flights: {
              $addToSet: {
                flight_number: "$flight_number",
                flight_date: "$flight_date",
              },
            },
          },
        },
        { $match: { shared_flights: { $gte: 2 } } },
        { $sort: { shared_flights: -1 } },
        { $limit: 20 },
      ]).option({ maxTimeMS: 15000 });

      companions = coPassengers.map((c) => ({
        passport_number: c._id,
        name: c.name,
        nationality: c.nationality,
        shared_flights: c.shared_flights,
        flights: c.flights.slice(0, 10),
      }));
    }

    // ─── Devices from ImeiDetail ───
    const devices = imeiDetails.map((d) => ({
      merk: d.merk,
      tipe: d.tipe,
      storage: d.storage,
      warna: d.warna,
      imei1: d.imei1,
      imei2: d.imei2,
      harga_fob_usd: d.harga_fob_usd,
      total_pungutan: d.total_pungutan,
      cara_pembayaran: d.cara_pembayaran,
      flight: d.flight_voyage,
      tanggal: d.waktu_kedatangan,
      kantor: kantorName(d.kode_kantor),
      no_dokumen: d.no_dokumen,
    }));

    // ─── CEISA records ───
    const ceisa = ceisaRecords.map((c) => ({
      nomor_dokumen: c.nomor_dokumen,
      tanggal: c.tanggal_dokumen,
      nama: c.nama_lengkap,
      status: c.status,
      status_penelitian: c.status_penelitian,
      hkt1: c.hkt1,
      hkt2: c.hkt2,
      kantor: kantorName(c.kode_kantor),
    }));

    // ─── Risk scoring ───
    let score = 0;
    const anomalies = [];
    const uniqueFlights = new Set(
      flights.map((f) => `${f.flight_number}_${f.flight_date}`),
    ).size;
    const billingCount =
      ceisaRecords.filter((c) => c.status_penelitian === "BILLING").length +
      imeiDetails.filter((d) => d.cara_pembayaran === "BILLING").length;
    const totalDevices = imeiDetails.length;
    const totalFobUsd = imeiDetails.reduce(
      (s, d) => s + (d.harga_fob_usd || 0),
      0,
    );

    score += uniqueFlights * 2;
    score += ceisaRecords.length * 5;
    score += billingCount * 10;
    score += totalDevices >= 5 ? 20 : totalDevices * 3;
    score += totalFobUsd > 5000 ? 15 : 0;
    score += suspect ? 30 : 0;
    score += companions.length >= 3 ? 10 : 0;

    if (suspect)
      anomalies.push({ type: "WATCHLIST", desc: "Ada di daftar pantau" });
    if (billingCount >= 3)
      anomalies.push({ type: "BILLING", desc: `${billingCount}× billing` });
    if (totalDevices >= 5)
      anomalies.push({ type: "DEVICES", desc: `${totalDevices} perangkat` });
    if (uniqueFlights >= 10)
      anomalies.push({
        type: "FREQUENT",
        desc: `${uniqueFlights} penerbangan`,
      });
    if (totalFobUsd > 5000)
      anomalies.push({
        type: "VALUE",
        desc: `Total FOB $${totalFobUsd.toLocaleString()}`,
      });
    if (companions.length >= 3)
      anomalies.push({
        type: "COMPANIONS",
        desc: `${companions.length} teman perjalanan berulang`,
      });

    const level =
      score >= 60 || suspect || billingCount >= 3
        ? "HIGH"
        : score >= 25 || uniqueFlights >= 10
          ? "MEDIUM"
          : "LOW";

    res.json({
      status: "ok",
      data: {
        found: true,
        identity,
        risk: {
          score,
          level,
          color:
            level === "HIGH"
              ? "#ef4444"
              : level === "MEDIUM"
                ? "#f59e0b"
                : "#22c55e",
          anomalies,
        },
        summary: {
          total_flights: uniqueFlights,
          total_ceisa: ceisaRecords.length,
          total_devices: totalDevices,
          total_imei_reg: imeiRegs.length,
          billing_count: billingCount,
          total_fob_usd: totalFobUsd,
          airlines: [...airlineSet],
          top_routes: topRoutes,
        },
        flights,
        flight_map: {
          airports: Object.values(airportMarkers),
          routes: routeLines,
        },
        companions,
        devices,
        ceisa,
        watchlist: suspect
          ? {
              is_suspect: true,
              status: suspect.status,
              risk_level: suspect.risk_level,
              categories: suspect.categories,
              description: suspect.description,
            }
          : { is_suspect: false },
      },
    });
  } catch (err) {
    console.error("[Intel Dossier]", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// 3) TRACKING DASHBOARD — Recent arrivals + active alerts
//    GET /api/intel/tracking?days=7
// ============================================================
router.get("/tracking", async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 30);
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Parallel: recent manifests, active suspects, recent billing, anomalies
    const [recentManifests, activeSuspects, recentBilling, recentImei] =
      await Promise.all([
        Manifest.find({
          status: { $in: ["synced", "parsed"] },
          flight_date: { $gte: since },
        })
          .sort({ flight_date: -1 })
          .limit(50)
          .lean(),

        Suspect.find({ status: { $in: ["ACTIVE", "MONITORING"] } })
          .sort({ last_seen: -1 })
          .limit(30)
          .lean(),

        ImeiDetail.find({
          cara_pembayaran: "BILLING",
          waktu_kedatangan: { $gte: since },
        })
          .sort({ waktu_kedatangan: -1 })
          .limit(30)
          .lean(),

        ImeiDetail.aggregate([
          { $match: { waktu_kedatangan: { $gte: since } } },
          {
            $group: {
              _id: "$no_identitas",
              nama: { $first: "$nama" },
              total_devices: { $sum: 1 },
              total_fob: { $sum: "$harga_fob_usd" },
              last_date: { $max: "$waktu_kedatangan" },
            },
          },
          { $match: { total_devices: { $gte: 3 } } },
          { $sort: { total_devices: -1 } },
          { $limit: 20 },
        ]).option({ maxTimeMS: 15000 }),
      ]);

    // Check if any recent manifest passengers are suspects
    const suspectPassports = new Set(
      activeSuspects.map((s) => s.passport_number?.toUpperCase()),
    );
    const recentFlightIds = recentManifests.map((m) => m._id);
    let suspectHits = [];
    if (recentFlightIds.length && suspectPassports.size) {
      const paxHits = await ManifestPassenger.find({
        manifest_id: { $in: recentFlightIds },
        passport_number: {
          $in: [...suspectPassports].map((p) => new RegExp("^" + p + "$", "i")),
        },
      })
        .limit(50)
        .lean();
      suspectHits = paxHits.map((p) => ({
        name: p.name,
        passport: p.passport_number,
        flight_number: p.flight_number,
        flight_date: p.flight_date,
        seat_no: p.seat_no,
        suspect:
          activeSuspects.find(
            (s) =>
              s.passport_number?.toUpperCase() ===
              p.passport_number?.toUpperCase(),
          ) || null,
      }));
    }

    res.json({
      status: "ok",
      data: {
        period_days: days,
        recent_flights: recentManifests.map((m) => ({
          flight_number: m.flight_number,
          flight_date: m.flight_date,
          origin: m.origin,
          destination: m.destination,
          carrier: m.carrier,
          pax_count: m.parsedPax || 0,
          status: m.status,
        })),
        suspect_hits: suspectHits,
        active_suspects: activeSuspects.map((s) => ({
          passport: s.passport_number,
          name: s.full_name,
          risk_level: s.risk_level,
          categories: s.categories,
          status: s.status,
          last_seen: s.last_seen,
          last_flight: s.last_flight,
        })),
        billing_alerts: recentBilling.map((d) => ({
          passport: d.no_identitas,
          name: d.nama,
          device: `${d.merk} ${d.tipe}`,
          harga_usd: d.harga_fob_usd,
          total_pungutan: d.total_pungutan,
          tanggal: d.waktu_kedatangan,
          kantor: kantorName(d.kode_kantor),
        })),
        bulk_device_alerts: recentImei.map((d) => ({
          passport: d._id,
          name: d.nama,
          total_devices: d.total_devices,
          total_fob_usd: d.total_fob,
          last_date: d.last_date,
        })),
      },
    });
  } catch (err) {
    console.error("[Intel Tracking]", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// 4) AIRPORT LOOKUP — Get airport info for the map
//    GET /api/intel/airports
// ============================================================
router.get("/airports", (req, res) => {
  res.json({ status: "ok", data: AIRPORTS });
});

module.exports = router;
