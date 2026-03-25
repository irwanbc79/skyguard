const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/passengerController");
const suspectService = require("../services/suspectService");
const ManifestPassenger = require("../models/ManifestPassenger");
const Manifest = require("../models/Manifest");
const Passenger = require("../models/Passenger");
const ImeiRegistration = require("../models/ImeiRegistration");
const ImeiDetail = require("../models/ImeiDetail");
const { getKantorName } = require("../utils/constants");

router.get("/lookup/:passport", ctrl.lookup);
router.get("/alerts", ctrl.getAlerts);
router.get("/stats", ctrl.getStats);
router.get("/transactions", ctrl.searchTransactions);
router.post("/match-device", ctrl.matchDevice);

// Passenger 360° Intelligence Profile
router.get("/profile/:passport", async (req, res) => {
  try {
    const profile = await suspectService.getPassengerProfile(
      req.params.passport,
    );
    res.json({ status: "ok", data: profile });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// TRAVEL HISTORY INTELLIGENCE — Fitur Andalan Intelijen
// ============================================================

// GET /api/passengers/travel-history/search — Multi-criteria passenger search
router.get("/travel-history/search", async (req, res) => {
  try {
    const { q, type } = req.query;
    if (!q || q.length < 2) {
      return res
        .status(400)
        .json({ status: "error", message: "Query minimal 2 karakter" });
    }
    const query = q.trim();
    const searchType = type || "auto"; // auto, passport, name, pnr

    // ---- SOURCE 1: ManifestPassenger ----
    let mpFilter;
    if (searchType === "passport") {
      mpFilter = { passport_number: { $regex: query, $options: "i" } };
    } else if (searchType === "name") {
      mpFilter = { name: { $regex: query, $options: "i" } };
    } else if (searchType === "pnr") {
      mpFilter = { pnr: { $regex: "^" + query, $options: "i" } };
    } else {
      mpFilter = {
        $or: [
          { passport_number: { $regex: query, $options: "i" } },
          { name: { $regex: query, $options: "i" } },
          { pnr: { $regex: "^" + query, $options: "i" } },
        ],
      };
    }

    const rawResults = await ManifestPassenger.aggregate([
      { $match: mpFilter },
      {
        $group: {
          _id: {
            name: { $toLower: "$name" },
            passport: { $toLower: { $ifNull: ["$passport_number", ""] } },
          },
          name: { $first: "$name" },
          passport_number: { $first: "$passport_number" },
          nationality: { $first: "$nationality" },
          gender: { $first: "$gender" },
          total_flights: { $sum: 1 },
          first_seen: { $min: "$flight_date" },
          last_seen: { $max: "$flight_date" },
          flight_numbers: { $addToSet: "$flight_number" },
          pnrs: { $addToSet: "$pnr" },
          seats: { $addToSet: "$seat_no" },
        },
      },
      { $sort: { total_flights: -1 } },
      { $limit: 50 },
    ]);

    // Track which passports we already found from manifests
    const foundPassports = new Set();
    const foundNames = new Set();

    // Enrich manifest results with CEISA data
    const manifestResults = await Promise.all(
      rawResults.map(async (r) => {
        let ceisaCount = 0;
        let riskLevel = "NORMAL";
        if (r.passport_number) {
          foundPassports.add(r.passport_number.toUpperCase());
          ceisaCount = await Passenger.countDocuments({
            paspor: r.passport_number.toUpperCase(),
          });
          if (ceisaCount >= 5) riskLevel = "HIGH";
          else if (ceisaCount >= 2) riskLevel = "MEDIUM";
        }
        if (r.name) foundNames.add(r.name.toUpperCase());
        return {
          ...r,
          source: "manifest",
          ceisa_records: ceisaCount,
          risk_level: riskLevel,
          airlines: [
            ...new Set(
              (r.flight_numbers || []).map((f) =>
                (f || "").replace(/\s?\d+/g, "").trim(),
              ),
            ),
          ].filter(Boolean),
        };
      }),
    );

    // ---- SOURCE 2: CEISA Passenger (customs/kepabeanan) ----
    let ceisaFilter;
    if (searchType === "passport") {
      ceisaFilter = { paspor: { $regex: query, $options: "i" } };
    } else if (searchType === "name") {
      ceisaFilter = { nama_lengkap: { $regex: query, $options: "i" } };
    } else if (searchType === "pnr") {
      ceisaFilter = null; // PNR not in CEISA
    } else {
      ceisaFilter = {
        $or: [
          { paspor: { $regex: query, $options: "i" } },
          { nama_lengkap: { $regex: query, $options: "i" } },
        ],
      };
    }

    let ceisaResults = [];
    if (ceisaFilter) {
      const ceisaRaw = await Passenger.aggregate([
        { $match: ceisaFilter },
        {
          $group: {
            _id: { $toLower: "$paspor" },
            paspor: { $first: "$paspor" },
            nama_lengkap: { $first: "$nama_lengkap" },
            total_records: { $sum: 1 },
            first_seen: { $min: "$tanggal_dokumen" },
            last_seen: { $max: "$tanggal_dokumen" },
            billing_count: {
              $sum: {
                $cond: [{ $eq: ["$status_penelitian", "BILLING"] }, 1, 0],
              },
            },
            pembebasan_count: {
              $sum: {
                $cond: [{ $eq: ["$status_penelitian", "PEMBEBASAN"] }, 1, 0],
              },
            },
            devices: { $addToSet: "$hkt1" },
            devices2: { $addToSet: "$hkt2" },
          },
        },
        { $sort: { total_records: -1 } },
        { $limit: 50 },
      ]);

      // Only include CEISA-only passengers (not already found in manifests)
      for (const c of ceisaRaw) {
        if (c.paspor && foundPassports.has(c.paspor.toUpperCase())) continue;
        const allDevices = [...(c.devices || []), ...(c.devices2 || [])].filter(
          Boolean,
        );
        const uniqueDevices = [...new Set(allDevices)].length;
        let riskLevel = "NORMAL";
        if (c.total_records >= 5 || c.billing_count >= 2) riskLevel = "HIGH";
        else if (c.total_records >= 2) riskLevel = "MEDIUM";

        ceisaResults.push({
          _id: {
            name: (c.nama_lengkap || "").toLowerCase(),
            passport: (c.paspor || "").toLowerCase(),
          },
          name: c.nama_lengkap || "-",
          passport_number: c.paspor,
          nationality: null,
          gender: null,
          total_flights: 0,
          first_seen: c.first_seen,
          last_seen: c.last_seen,
          flight_numbers: [],
          pnrs: [],
          seats: [],
          source: "ceisa",
          ceisa_records: c.total_records,
          risk_level: riskLevel,
          airlines: [],
          billing_count: c.billing_count,
          pembebasan_count: c.pembebasan_count,
          unique_devices: uniqueDevices,
        });
      }
    }

    const results = [...manifestResults, ...ceisaResults];
    // Sort: HIGH risk first, then by total activity
    results.sort((a, b) => {
      const riskOrder = { HIGH: 0, MEDIUM: 1, NORMAL: 2, LOW: 3 };
      const rDiff =
        (riskOrder[a.risk_level] || 3) - (riskOrder[b.risk_level] || 3);
      if (rDiff !== 0) return rDiff;
      return (
        b.total_flights +
        (b.ceisa_records || 0) -
        (a.total_flights + (a.ceisa_records || 0))
      );
    });

    res.json({
      status: "ok",
      data: results.slice(0, 50),
      total: results.length,
    });
  } catch (err) {
    console.error("[TRAVEL SEARCH]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// GET /api/passengers/pnr/:pnr — PNR affiliation intelligence
// Returns ALL passengers sharing the same booking code + cross-flight history
router.get("/pnr/:pnr", async (req, res) => {
  try {
    const pnr = req.params.pnr.trim().toUpperCase();
    if (pnr.length < 4) {
      return res.status(400).json({ status: "error", message: "PNR minimal 4 karakter" });
    }

    // All passengers with this PNR across all flights
    const members = await ManifestPassenger.find({ pnr })
      .sort({ flight_date: -1 })
      .lean();

    if (!members.length) {
      return res.json({ status: "ok", pnr, total: 0, passengers: [], flights: [] });
    }

    // Unique passengers by name (travel companions / family)
    const byName = {};
    members.forEach((m) => {
      const key = (m.name || "").toUpperCase();
      if (!byName[key]) {
        byName[key] = { name: m.name, passport_number: m.passport_number, nationality: m.nationality, gender: m.gender, pnr_flights: [] };
      }
      byName[key].pnr_flights.push({
        flight_number: m.flight_number,
        flight_date: m.flight_date,
        seat_no: m.seat_no,
        status: m.status,
        destination_code: m.destination_code,
      });
    });

    // For each unique passenger, also look up their other PNRs (full travel history)
    const passengers = await Promise.all(
      Object.values(byName).map(async (p) => {
        const allFlights = await ManifestPassenger.find({
          name: { $regex: "^" + (p.name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", $options: "i" },
        })
          .sort({ flight_date: -1 })
          .limit(30)
          .lean();

        const ceisaCount = p.passport_number
          ? await Passenger.countDocuments({ paspor: p.passport_number.toUpperCase() })
          : 0;

        const otherPnrs = [...new Set(allFlights.map((f) => f.pnr).filter((x) => x && x !== pnr))];
        const allFlightNos = [...new Set(allFlights.map((f) => f.flight_number).filter(Boolean))];

        let riskLevel = "NORMAL";
        if (ceisaCount >= 5) riskLevel = "HIGH";
        else if (ceisaCount >= 2) riskLevel = "MEDIUM";

        return {
          ...p,
          total_flights: allFlights.length,
          other_pnrs: otherPnrs.slice(0, 10),
          all_flight_numbers: allFlightNos,
          ceisa_records: ceisaCount,
          risk_level: riskLevel,
          first_seen: allFlights.length ? allFlights[allFlights.length - 1].flight_date : null,
          last_seen: allFlights.length ? allFlights[0].flight_date : null,
        };
      }),
    );

    // Flights this PNR appears on
    const flights = [
      ...new Map(
        members.map((m) => [
          m.flight_number + (m.flight_date || ""),
          { flight_number: m.flight_number, flight_date: m.flight_date, destination_code: m.destination_code },
        ]),
      ).values(),
    ].sort((a, b) => new Date(b.flight_date) - new Date(a.flight_date));

    res.json({
      status: "ok",
      pnr,
      total: passengers.length,
      flights,
      passengers,
    });
  } catch (err) {
    console.error("[PNR AFFILIATION]", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// GET /api/passengers/travel-history/:identifier — Full travel dossier
router.get("/travel-history/:identifier", async (req, res) => {
  try {
    const id = req.params.identifier.trim();
    const searchBy = req.query.by || "auto"; // auto, passport, name

    // ---- Determine search filter for ManifestPassenger ----
    let paxFilter;
    if (searchBy === "passport") {
      paxFilter = {
        passport_number: { $regex: new RegExp("^" + id + "$", "i") },
      };
    } else if (searchBy === "name") {
      paxFilter = { name: { $regex: id, $options: "i" } };
    } else {
      // Auto-detect: if looks like a passport/ID (alphanumeric, no spaces), search by passport only.
      // Fallback to name only if the query clearly contains spaces (likely a full name).
      if (/^[A-Z0-9]{3,20}$/i.test(id.trim())) {
        paxFilter = {
          passport_number: { $regex: new RegExp("^" + id + "$", "i") },
        };
      } else {
        paxFilter = { name: { $regex: id, $options: "i" } };
      }
    }

    // 1. All manifest passenger records
    const paxRecords = await ManifestPassenger.find(paxFilter)
      .sort({ flight_date: -1 })
      .limit(200)
      .lean();

    // 2. Also check CEISA even if no manifest records
    const ceisaPassport =
      searchBy === "passport" || searchBy === "auto" ? id.toUpperCase() : null;
    let ceisaByName = searchBy === "name" ? id : null;

    // If manifest records exist, use passport from there for CEISA lookup
    let primaryName,
      primaryPassport,
      primaryNationality,
      primaryGender,
      primaryDOB;

    if (paxRecords.length > 0) {
      primaryName = paxRecords[0].name;
      primaryPassport =
        paxRecords.find((p) => p.passport_number)?.passport_number || null;
      primaryNationality =
        paxRecords.find((p) => p.nationality)?.nationality || null;
      primaryGender = paxRecords.find((p) => p.gender)?.gender || null;
      primaryDOB =
        paxRecords.find((p) => p.date_of_birth)?.date_of_birth || null;
    }

    // CEISA lookup - try passport first, then name
    const ceisaSearchPassport = primaryPassport?.toUpperCase() || ceisaPassport;
    let ceisaRecords = [];
    if (ceisaSearchPassport) {
      ceisaRecords = await Passenger.find({
        paspor: { $regex: new RegExp("^" + ceisaSearchPassport + "$", "i") },
      })
        .sort({ tanggal_dokumen: -1 })
        .limit(50)
        .lean();
    }
    // Fallback: search CEISA by name ONLY when explicitly searching by name (not by passport)
    if (!ceisaRecords.length && ceisaByName) {
      ceisaRecords = await Passenger.find({
        nama_lengkap: { $regex: ceisaByName, $options: "i" },
      })
        .sort({ tanggal_dokumen: -1 })
        .limit(50)
        .lean();
    }

    // If still nothing from both sources
    if (!paxRecords.length && !ceisaRecords.length) {
      return res.json({
        status: "ok",
        data: null,
        message: "Tidak ditemukan riwayat perjalanan maupun data kepabeanan",
      });
    }

    // If no manifest records but CEISA exists, build identity from CEISA
    if (!paxRecords.length && ceisaRecords.length > 0) {
      primaryName = ceisaRecords[0].nama_lengkap || "-";
      primaryPassport = ceisaRecords[0].paspor || null;
      primaryNationality = null;
      primaryGender = null;
      primaryDOB = null;
    }

    // 3. Enrich with manifest details (origin/destination)
    const manifestIds = [
      ...new Set(
        paxRecords.map((p) => p.manifest_id?.toString()).filter(Boolean),
      ),
    ];
    const manifests = await Manifest.find({ _id: { $in: manifestIds } })
      .select("flight_number flight_date origin destination carrier filename")
      .lean();
    const manifestMap = {};
    manifests.forEach((m) => {
      manifestMap[m._id.toString()] = m;
    });

    // 4. Build flight timeline from manifest data
    const flights = paxRecords.map((p) => {
      const m = manifestMap[p.manifest_id?.toString()] || {};
      return {
        flight_number: p.flight_number || m.flight_number || "-",
        flight_date: p.flight_date || m.flight_date,
        origin: m.origin || "-",
        destination: m.destination || "-",
        carrier: m.carrier || "-",
        seat_no: p.seat_no || "-",
        pnr: p.pnr || "-",
        status: p.status || "-",
        nationality: p.nationality || primaryNationality || "-",
        bag_weight: p.bag_weight || null,
        ticket_number: p.ticket_number || null,
        pax_type: p.pax_type || null,
      };
    });

    // 5. Route analysis
    const routeMap = {};
    const airlineMap = {};
    const destinationMap = {};
    const originMap = {};
    const monthlyTravel = {};
    const dayOfWeekMap = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const yearMap = {};

    flights.forEach((f) => {
      const route = f.origin + " \u2192 " + f.destination;
      if (route !== "- \u2192 -") routeMap[route] = (routeMap[route] || 0) + 1;
      if (f.destination !== "-")
        destinationMap[f.destination] =
          (destinationMap[f.destination] || 0) + 1;
      if (f.origin !== "-")
        originMap[f.origin] = (originMap[f.origin] || 0) + 1;
      const airline =
        f.carrier !== "-"
          ? f.carrier
          : (f.flight_number || "").replace(/\s?\d+/g, "").trim();
      if (airline) airlineMap[airline] = (airlineMap[airline] || 0) + 1;
      if (f.flight_date) {
        const d = new Date(f.flight_date);
        const monthKey =
          d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        monthlyTravel[monthKey] = (monthlyTravel[monthKey] || 0) + 1;
        dayOfWeekMap[d.getDay()]++;
        const yr = String(d.getFullYear());
        yearMap[yr] = (yearMap[yr] || 0) + 1;
      }
    });

    // 6. Travel companions — people on the same flights
    const flightKeys = paxRecords
      .filter((p) => p.flight_number && p.flight_date)
      .map((p) => ({
        flight_number: p.flight_number,
        flight_date: p.flight_date,
      }));

    let companions = [];
    if (flightKeys.length > 0) {
      const companionPipeline = [];
      for (const fk of flightKeys.slice(0, 20)) {
        companionPipeline.push({
          flight_number: fk.flight_number,
          flight_date: fk.flight_date,
        });
      }
      const coPassengers = await ManifestPassenger.find({
        $or: companionPipeline,
        name: { $ne: primaryName },
      })
        .select(
          "name passport_number flight_number flight_date pnr nationality",
        )
        .lean();

      const companionMap = {};
      coPassengers.forEach((cp) => {
        const key = (cp.name || "").toLowerCase();
        if (!companionMap[key]) {
          companionMap[key] = {
            name: cp.name,
            passport_number: cp.passport_number,
            nationality: cp.nationality,
            shared_flights: 0,
            flights: [],
          };
        }
        companionMap[key].shared_flights++;
        companionMap[key].flights.push(cp.flight_number);
      });

      companions = Object.values(companionMap)
        .filter((c) => c.shared_flights >= 2)
        .sort((a, b) => b.shared_flights - a.shared_flights)
        .slice(0, 20);
    }

    // 7. Build CEISA data object
    const allDevices = [];
    ceisaRecords.forEach((r) => {
      if (r.hkt1) allDevices.push(r.hkt1);
      if (r.hkt2) allDevices.push(r.hkt2);
    });

    const deviceMap = {};
    ceisaRecords.forEach((r) => {
      [r.hkt1, r.hkt2].filter(Boolean).forEach((dev) => {
        if (!deviceMap[dev])
          deviceMap[dev] = { name: dev, count: 0, statuses: [] };
        deviceMap[dev].count++;
        if (r.status_penelitian)
          deviceMap[dev].statuses.push(r.status_penelitian);
      });
    });

    const ceisaData = {
      total: ceisaRecords.length,
      records: ceisaRecords.slice(0, 20).map((r) => ({
        nomor_dokumen: r.nomor_dokumen,
        tanggal_dokumen: r.tanggal_dokumen,
        status: r.status,
        status_penelitian: r.status_penelitian,
        nama_lengkap: r.nama_lengkap,
        hkt1: r.hkt1,
        hkt2: r.hkt2,
        nama_petugas: r.nama_petugas,
      })),
      devices: Object.values(deviceMap).sort((a, b) => b.count - a.count),
      unique_devices: [...new Set(allDevices)].length,
      billing_count: ceisaRecords.filter(
        (r) => r.status_penelitian === "BILLING",
      ).length,
      pembebasan_count: ceisaRecords.filter(
        (r) => r.status_penelitian === "PEMBEBASAN",
      ).length,
      first_record: ceisaRecords.length
        ? ceisaRecords[ceisaRecords.length - 1].tanggal_dokumen
        : null,
      last_record: ceisaRecords.length ? ceisaRecords[0].tanggal_dokumen : null,
    };

    // 8. Watchlist check
    let watchlistStatus = { is_suspect: false };
    if (primaryPassport) {
      try {
        const suspect = await require("mongoose")
          .model("Suspect")
          .findOne({
            passport_number: {
              $regex: new RegExp("^" + primaryPassport + "$", "i"),
            },
            status: { $in: ["ACTIVE", "MONITORING", "ARRESTED"] },
          })
          .lean();
        if (suspect) {
          watchlistStatus = {
            is_suspect: true,
            suspect_id: suspect._id,
            status: suspect.status,
            risk_level: suspect.risk_level,
            categories: suspect.categories,
            full_name: suspect.full_name,
          };
        }
      } catch (e) {
        /* Suspect model may not exist */
      }
    }

    // 9. IMEI Registration lookup
    let imeiData = {
      total: 0,
      records: [],
      unique_offices: [],
      total_pungutan: 0,
    };
    const imeiSearchPassport = primaryPassport?.toUpperCase() || ceisaPassport;
    if (imeiSearchPassport) {
      const imeiRecords = await ImeiRegistration.find({
        no_identitas: {
          $regex: new RegExp("^" + imeiSearchPassport + "$", "i"),
        },
      })
        .sort({ tgl_kedatangan: -1 })
        .limit(100)
        .lean();

      if (imeiRecords.length) {
        const officeSet = new Set();
        const vesselSet = new Set();
        let totalPungutan = 0;
        let billingCount = 0;
        let pembebasanCount = 0;

        imeiRecords.forEach((r) => {
          if (r.kode_kantor) officeSet.add(r.kode_kantor);
          if (r.vessel) vesselSet.add(r.vessel);
          totalPungutan += r.total_pungutan || 0;
          if (r.status_pembayaran === "BILLING") billingCount++;
          if (r.status_pembayaran === "PEMBEBASAN") pembebasanCount++;
        });

        imeiData = {
          total: imeiRecords.length,
          records: imeiRecords.slice(0, 30).map((r) => ({
            nama: r.nama,
            vessel: r.vessel,
            tgl_kedatangan: r.tgl_kedatangan,
            no_dok: r.no_dok,
            tgl_dok: r.tgl_dok,
            total_pungutan: r.total_pungutan,
            status_pembayaran: r.status_pembayaran,
            kode_kantor: r.kode_kantor,
            kantor_nama: getKantorName(r.kode_kantor),
            nip_petugas: r.nip_petugas,
            id_registrasi: r.id_registrasi,
          })),
          unique_offices: [...officeSet].map((k) => ({
            code: k,
            name: getKantorName(k),
          })),
          unique_vessels: [...vesselSet],
          total_pungutan: totalPungutan,
          billing_count: billingCount,
          pembebasan_count: pembebasanCount,
          first_record: imeiRecords[imeiRecords.length - 1].tgl_kedatangan,
          last_record: imeiRecords[0].tgl_kedatangan,
        };
      }
    }
    // Name-based IMEI fallback dihapus — IMEI harus dicari by no_identitas (paspor/NIK) saja
    // untuk mencegah false attribution data IMEI ke penumpang yang salah

    // 9b. IMEI Device Details lookup
    let deviceData = { total: 0, devices: [], brands: {}, totalFobUsd: 0 };
    const deviceSearchPassport =
      imeiSearchPassport || primaryPassport?.toUpperCase();
    if (deviceSearchPassport) {
      const deviceRecords = await ImeiDetail.find({
        no_identitas: {
          $regex: new RegExp("^" + deviceSearchPassport + "$", "i"),
        },
      })
        .sort({ waktu_kedatangan: -1 })
        .limit(100)
        .lean();
      if (deviceRecords.length) {
        const brandMap = {};
        let totalFob = 0;
        let totalPungutan = 0;
        const imeiList = [];
        deviceRecords.forEach((d) => {
          brandMap[d.merk] = (brandMap[d.merk] || 0) + 1;
          totalFob += d.harga_fob_usd || 0;
          totalPungutan += d.total_pungutan || 0;
          if (d.imei1) imeiList.push(d.imei1);
        });
        deviceData = {
          total: deviceRecords.length,
          devices: deviceRecords.slice(0, 50).map((d) => ({
            merk: d.merk,
            tipe: d.tipe,
            storage: d.storage,
            warna: d.warna,
            imei1: d.imei1,
            imei2: d.imei2,
            harga_fob_usd: d.harga_fob_usd,
            cif_usd: d.cif_usd,
            total_pungutan: d.total_pungutan,
            cara_pembayaran: d.cara_pembayaran,
            bekas: d.bekas,
            flight_voyage: d.flight_voyage,
            waktu_kedatangan: d.waktu_kedatangan,
            kode_kantor: d.kode_kantor,
            kantor_nama: getKantorName(d.kode_kantor),
            ndpbm: d.ndpbm,
          })),
          brands: Object.entries(brandMap)
            .sort((a, b) => b[1] - a[1])
            .map(([brand, count]) => ({ brand, count })),
          totalFobUsd: totalFob,
          totalPungutan: totalPungutan,
          uniqueImei: imeiList.length,
        };
      }
    }

    // 10. Intelligence scoring
    const flightCount = flights.length;
    const routeCount = Object.keys(routeMap).length;
    const companionCount = companions.length;

    let intelScore = 0;
    intelScore += flightCount * 2;
    intelScore += routeCount * 3;
    intelScore += ceisaData.total * 5;
    intelScore += ceisaData.billing_count * 10;
    intelScore += ceisaData.unique_devices * 4;
    intelScore += companionCount * 2;
    intelScore += watchlistStatus.is_suspect ? 30 : 0;
    // IMEI scoring
    intelScore += imeiData.total * 3;
    intelScore += imeiData.unique_offices?.length >= 3 ? 15 : 0;
    intelScore += imeiData.billing_count * 5;
    // Device detail scoring
    intelScore += deviceData.total >= 5 ? 20 : deviceData.total * 3;
    intelScore += deviceData.totalFobUsd > 5000 ? 15 : 0;
    const appleDevices =
      deviceData.devices?.filter((d) => d.merk === "APPLE").length || 0;
    intelScore += appleDevices >= 3 ? 10 : 0;

    let threatLevel = "LOW";
    let threatColor = "#22c55e";
    if (
      intelScore >= 60 ||
      watchlistStatus.is_suspect ||
      ceisaData.billing_count >= 3
    ) {
      threatLevel = "HIGH";
      threatColor = "#ef4444";
    } else if (
      intelScore >= 25 ||
      ceisaData.total >= 3 ||
      flightCount >= 10 ||
      imeiData.total >= 5
    ) {
      threatLevel = "MEDIUM";
      threatColor = "#eab308";
    }

    // 10. Anomaly detection
    const anomalies = [];
    if (ceisaData.billing_count >= 2)
      anomalies.push({
        type: "BILLING_HISTORY",
        severity: "HIGH",
        msg: ceisaData.billing_count + "x billing di CEISA",
      });
    if (ceisaData.unique_devices >= 5)
      anomalies.push({
        type: "MANY_DEVICES",
        severity: "HIGH",
        msg: ceisaData.unique_devices + " perangkat unik terdaftar",
      });
    if (flightCount >= 10)
      anomalies.push({
        type: "FREQUENT_TRAVELER",
        severity: "MEDIUM",
        msg: flightCount + " perjalanan tercatat",
      });
    if (companionCount >= 5)
      anomalies.push({
        type: "MANY_COMPANIONS",
        severity: "MEDIUM",
        msg: companionCount + " travel companion terdeteksi",
      });
    if (watchlistStatus.is_suspect)
      anomalies.push({
        type: "WATCHLIST_HIT",
        severity: "CRITICAL",
        msg: "Terdaftar di Daftar Atensi",
      });
    if (ceisaData.total >= 5)
      anomalies.push({
        type: "FREQUENT_CEISA",
        severity: "MEDIUM",
        msg: ceisaData.total + "x tercatat di CEISA — sering membawa HP",
      });
    // IMEI anomalies
    if (imeiData.total >= 5)
      anomalies.push({
        type: "FREQUENT_IMEI",
        severity: "HIGH",
        msg: imeiData.total + "x registrasi IMEI — possible carrier",
      });
    if (imeiData.unique_offices?.length >= 3)
      anomalies.push({
        type: "MULTI_KANTOR_IMEI",
        severity: "HIGH",
        msg:
          "Registrasi di " +
          imeiData.unique_offices.length +
          " kantor berbeda: " +
          imeiData.unique_offices.map((o) => o.name).join(", "),
      });
    if (imeiData.total_pungutan >= 50000000)
      anomalies.push({
        type: "HIGH_PUNGUTAN",
        severity: "MEDIUM",
        msg:
          "Total pungutan IMEI: Rp " +
          (imeiData.total_pungutan / 1000000).toFixed(1) +
          " juta",
      });
    // Device detail anomalies
    if (deviceData.total >= 5)
      anomalies.push({
        type: "BULK_DEVICES",
        severity: "HIGH",
        msg:
          deviceData.total +
          " perangkat terdaftar — " +
          deviceData.brands
            .map((b) => b.brand + "(" + b.count + ")")
            .join(", "),
      });
    if (deviceData.totalFobUsd > 5000)
      anomalies.push({
        type: "HIGH_VALUE_PORTFOLIO",
        severity: "MEDIUM",
        msg:
          "Total nilai perangkat: $" +
          deviceData.totalFobUsd.toFixed(0) +
          " USD",
      });
    if (appleDevices >= 3)
      anomalies.push({
        type: "BULK_APPLE",
        severity: "HIGH",
        msg: appleDevices + " perangkat Apple — kemungkinan jual-beli/kurir",
      });

    // Rapid re-entry detection
    const sortedDates = flights
      .filter((f) => f.flight_date)
      .map((f) => new Date(f.flight_date).getTime())
      .sort((a, b) => a - b);
    for (let i = 1; i < sortedDates.length; i++) {
      const gap = (sortedDates[i] - sortedDates[i - 1]) / (1000 * 60 * 60 * 24);
      if (gap <= 3 && gap >= 0) {
        anomalies.push({
          type: "RAPID_REENTRY",
          severity: "MEDIUM",
          msg: "Re-entry dalam " + Math.round(gap) + " hari",
        });
        break;
      }
    }

    // CEISA timeline analysis for CEISA-only passengers
    if (!flights.length && ceisaRecords.length > 0) {
      const ceisaDates = ceisaRecords
        .filter((r) => r.tanggal_dokumen)
        .map((r) => new Date(r.tanggal_dokumen));
      ceisaDates.forEach((d) => {
        const monthKey =
          d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        monthlyTravel[monthKey] = (monthlyTravel[monthKey] || 0) + 1;
        dayOfWeekMap[d.getDay()]++;
        const yr = String(d.getFullYear());
        yearMap[yr] = (yearMap[yr] || 0) + 1;
      });
    }

    const dossier = {
      identity: {
        name: primaryName,
        passport_number: primaryPassport,
        nationality: primaryNationality,
        gender: primaryGender,
        date_of_birth: primaryDOB,
        aliases: [
          ...new Set(
            paxRecords.map((p) => p.name).filter((n) => n && n !== primaryName),
          ),
        ],
      },
      threat_assessment: {
        score: intelScore,
        level: threatLevel,
        color: threatColor,
        anomalies,
      },
      travel_summary: {
        total_flights: flightCount,
        total_routes: routeCount,
        first_flight: flights.length
          ? flights[flights.length - 1].flight_date
          : null,
        last_flight: flights.length ? flights[0].flight_date : null,
        top_routes: Object.entries(routeMap)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([route, count]) => ({ route, count })),
        top_destinations: Object.entries(destinationMap)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([dest, count]) => ({ dest, count })),
        top_origins: Object.entries(originMap)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([origin, count]) => ({ origin, count })),
        airlines: Object.entries(airlineMap)
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => ({ name, count })),
        monthly_pattern: Object.entries(monthlyTravel)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([month, count]) => ({ month, count })),
        day_of_week: dayOfWeekMap,
        yearly: Object.entries(yearMap)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([year, count]) => ({ year, count })),
      },
      flights,
      companions,
      ceisa: ceisaData,
      imei: imeiData,
      deviceDetails: deviceData,
      watchlist: watchlistStatus,
    };

    res.json({ status: "ok", data: dossier });
  } catch (err) {
    console.error("[TRAVEL HISTORY]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

module.exports = router;
