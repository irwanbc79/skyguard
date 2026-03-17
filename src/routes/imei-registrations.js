/**
 * IMEI Registration Routes
 * Data from CEISA scraping - registrasi IMEI se-Indonesia
 *
 * Endpoints:
 *   GET  /api/imei-registrations              - List with filters & pagination
 *   GET  /api/imei-registrations/analytics     - Dashboard analytics (13 aggregations)
 *   GET  /api/imei-registrations/search        - Search by name/passport/vessel
 *   GET  /api/imei-registrations/passport/:no  - Lookup by passport (cross-check with CEISA passengers)
 *   GET  /api/imei-registrations/vessel/:code  - All registrations for a flight/vessel
 *   GET  /api/imei-registrations/anomalies     - Detect suspicious patterns
 *   GET  /api/imei-registrations/offices       - Per-office breakdown
 *   GET  /api/imei-registrations/top-flights   - Top flights by registration volume
 */
const express = require("express");
const router = express.Router();
const ImeiRegistration = require("../models/ImeiRegistration");
const Passenger = require("../models/Passenger");
const ManifestPassenger = require("../models/ManifestPassenger");
const { getKantorName } = require("../utils/constants");

// ==================== LIST WITH FILTERS ====================
router.get("/", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      kebangsaan,
      kode_kantor,
      status_pembayaran,
      vessel,
      date_from,
      date_to,
      sort_by = "tgl_kedatangan",
      sort_order = "desc",
    } = req.query;

    const filter = {};
    if (kebangsaan) filter.kebangsaan = kebangsaan.toUpperCase();
    if (kode_kantor) filter.kode_kantor = kode_kantor;
    if (status_pembayaran)
      filter.status_pembayaran = status_pembayaran.toUpperCase();
    if (vessel)
      filter.vessel_normalized = new RegExp(vessel.replace(/[\s\-]/g, ""), "i");
    if (date_from || date_to) {
      filter.tgl_kedatangan = {};
      if (date_from) filter.tgl_kedatangan.$gte = new Date(date_from);
      if (date_to) filter.tgl_kedatangan.$lte = new Date(date_to + "T23:59:59");
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortObj = { [sort_by]: sort_order === "asc" ? 1 : -1 };

    const [data, total] = await Promise.all([
      ImeiRegistration.find(filter)
        .sort(sortObj)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ImeiRegistration.countDocuments(filter),
    ]);

    // Enrich with kantor names
    const enriched = data.map((d) => ({
      ...d,
      kantor_nama: getKantorName(d.kode_kantor),
    }));

    res.json({
      status: "ok",
      data: enriched,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==================== ANALYTICS DASHBOARD ====================
router.get("/analytics", async (req, res) => {
  try {
    const { kode_kantor, date_from, date_to } = req.query;

    const matchStage = {};
    if (kode_kantor) matchStage.kode_kantor = kode_kantor;
    if (date_from || date_to) {
      matchStage.tgl_kedatangan = {};
      if (date_from) matchStage.tgl_kedatangan.$gte = new Date(date_from);
      if (date_to)
        matchStage.tgl_kedatangan.$lte = new Date(date_to + "T23:59:59");
    }

    const pipeline =
      Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : [];

    const [
      overview,
      byNationality,
      byStatus,
      byOffice,
      byVessel,
      dailyTrend,
      topPassengers,
      pungutanDistribution,
      repeatRegistrants,
      officerStats,
      hourlyPattern,
      nationalityPayment,
      vesselPayment,
    ] = await Promise.all([
      // 1. Overview
      ImeiRegistration.aggregate([
        ...pipeline,
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            total_pungutan: { $sum: "$total_pungutan" },
            avg_pungutan: { $avg: "$total_pungutan" },
            max_pungutan: { $max: "$total_pungutan" },
            unique_passports: { $addToSet: "$no_identitas" },
            unique_vessels: { $addToSet: "$vessel_normalized" },
            unique_offices: { $addToSet: "$kode_kantor" },
            earliest: { $min: "$tgl_kedatangan" },
            latest: { $max: "$tgl_kedatangan" },
          },
        },
        {
          $project: {
            total: 1,
            total_pungutan: 1,
            avg_pungutan: { $round: ["$avg_pungutan", 0] },
            max_pungutan: 1,
            unique_passports: { $size: "$unique_passports" },
            unique_vessels: { $size: "$unique_vessels" },
            unique_offices: { $size: "$unique_offices" },
            earliest: 1,
            latest: 1,
          },
        },
      ]),

      // 2. By Nationality (top 15)
      ImeiRegistration.aggregate([
        ...pipeline,
        {
          $group: {
            _id: "$kebangsaan",
            count: { $sum: 1 },
            total_pungutan: { $sum: "$total_pungutan" },
            pembebasan: {
              $sum: {
                $cond: [{ $eq: ["$status_pembayaran", "PEMBEBASAN"] }, 1, 0],
              },
            },
            billing: {
              $sum: {
                $cond: [{ $eq: ["$status_pembayaran", "BILLING"] }, 1, 0],
              },
            },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 15 },
      ]),

      // 3. By Payment Status
      ImeiRegistration.aggregate([
        ...pipeline,
        {
          $group: {
            _id: "$status_pembayaran",
            count: { $sum: 1 },
            total_pungutan: { $sum: "$total_pungutan" },
            avg_pungutan: { $avg: "$total_pungutan" },
          },
        },
        { $sort: { count: -1 } },
      ]),

      // 4. By Office (top 20)
      ImeiRegistration.aggregate([
        ...pipeline,
        {
          $group: {
            _id: "$kode_kantor",
            count: { $sum: 1 },
            total_pungutan: { $sum: "$total_pungutan" },
            pembebasan: {
              $sum: {
                $cond: [{ $eq: ["$status_pembayaran", "PEMBEBASAN"] }, 1, 0],
              },
            },
            billing: {
              $sum: {
                $cond: [{ $eq: ["$status_pembayaran", "BILLING"] }, 1, 0],
              },
            },
            nationalities: { $addToSet: "$kebangsaan" },
          },
        },
        {
          $project: {
            count: 1,
            total_pungutan: 1,
            pembebasan: 1,
            billing: 1,
            nationality_count: { $size: "$nationalities" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),

      // 5. Top Vessels/Flights (top 20)
      ImeiRegistration.aggregate([
        ...pipeline,
        { $match: { vessel: { $ne: "" } } },
        {
          $group: {
            _id: "$vessel",
            normalized: { $first: "$vessel_normalized" },
            count: { $sum: 1 },
            total_pungutan: { $sum: "$total_pungutan" },
            pembebasan: {
              $sum: {
                $cond: [{ $eq: ["$status_pembayaran", "PEMBEBASAN"] }, 1, 0],
              },
            },
            billing: {
              $sum: {
                $cond: [{ $eq: ["$status_pembayaran", "BILLING"] }, 1, 0],
              },
            },
            nationalities: { $addToSet: "$kebangsaan" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),

      // 6. Daily Trend (last 60 days)
      ImeiRegistration.aggregate([
        ...pipeline,
        { $match: { tgl_kedatangan: { $ne: null } } },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$tgl_kedatangan" },
            },
            count: { $sum: 1 },
            pungutan: { $sum: "$total_pungutan" },
            pembebasan: {
              $sum: {
                $cond: [{ $eq: ["$status_pembayaran", "PEMBEBASAN"] }, 1, 0],
              },
            },
            billing: {
              $sum: {
                $cond: [{ $eq: ["$status_pembayaran", "BILLING"] }, 1, 0],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // 7. Top Passengers (repeat registrants, top 20)
      ImeiRegistration.aggregate([
        ...pipeline,
        { $match: { no_identitas: { $ne: "" } } },
        {
          $group: {
            _id: "$no_identitas",
            nama: { $first: "$nama" },
            kebangsaan: { $first: "$kebangsaan" },
            count: { $sum: 1 },
            total_pungutan: { $sum: "$total_pungutan" },
            vessels: { $addToSet: "$vessel" },
            offices: { $addToSet: "$kode_kantor" },
            dates: { $push: "$tgl_kedatangan" },
            statuses: { $push: "$status_pembayaran" },
          },
        },
        { $match: { count: { $gte: 2 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),

      // 8. Pungutan Distribution (histogram)
      ImeiRegistration.aggregate([
        ...pipeline,
        { $match: { total_pungutan: { $gt: 0 } } },
        {
          $bucket: {
            groupBy: "$total_pungutan",
            boundaries: [
              0, 100000, 500000, 1000000, 2000000, 5000000, 10000000, 50000000,
            ],
            default: "50000000+",
            output: { count: { $sum: 1 }, total: { $sum: "$total_pungutan" } },
          },
        },
      ]),

      // 9. Repeat Registrants (multi-office)
      ImeiRegistration.aggregate([
        ...pipeline,
        { $match: { no_identitas: { $ne: "" } } },
        {
          $group: {
            _id: "$no_identitas",
            nama: { $first: "$nama" },
            kebangsaan: { $first: "$kebangsaan" },
            offices: { $addToSet: "$kode_kantor" },
            count: { $sum: 1 },
            total_pungutan: { $sum: "$total_pungutan" },
          },
        },
        { $match: { $expr: { $gte: [{ $size: "$offices" }, 2] } } },
        { $sort: { count: -1 } },
        { $limit: 15 },
      ]),

      // 10. Officer Stats (top 15 by volume)
      ImeiRegistration.aggregate([
        ...pipeline,
        { $match: { nip_petugas: { $ne: "" } } },
        {
          $group: {
            _id: "$nip_petugas",
            count: { $sum: 1 },
            total_pungutan: { $sum: "$total_pungutan" },
            offices: { $addToSet: "$kode_kantor" },
            pembebasan: {
              $sum: {
                $cond: [{ $eq: ["$status_pembayaran", "PEMBEBASAN"] }, 1, 0],
              },
            },
            billing: {
              $sum: {
                $cond: [{ $eq: ["$status_pembayaran", "BILLING"] }, 1, 0],
              },
            },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 15 },
      ]),

      // 11. Hourly Pattern
      ImeiRegistration.aggregate([
        ...pipeline,
        { $match: { tgl_kedatangan: { $ne: null } } },
        {
          $group: {
            _id: { $hour: "$tgl_kedatangan" },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // 12. Nationality x Payment cross-tab (top 10 nations)
      ImeiRegistration.aggregate([
        ...pipeline,
        {
          $group: {
            _id: { nat: "$kebangsaan", status: "$status_pembayaran" },
            count: { $sum: 1 },
            pungutan: { $sum: "$total_pungutan" },
          },
        },
        { $sort: { count: -1 } },
      ]),

      // 13. Vessel x Payment (top 10)
      ImeiRegistration.aggregate([
        ...pipeline,
        { $match: { vessel: { $ne: "" } } },
        {
          $group: {
            _id: { vessel: "$vessel", status: "$status_pembayaran" },
            count: { $sum: 1 },
            pungutan: { $sum: "$total_pungutan" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 50 },
      ]),
    ]);

    // Enrich offices with names
    const enrichedOffices = byOffice.map((o) => ({
      ...o,
      kantor_nama: getKantorName(o._id),
    }));

    // Data enrichment stats from ImeiDetail
    const ImeiDetail = require("../models/ImeiDetail");
    const [detCount, detUniqueRegs, detBrandSummary] = await Promise.all([
      ImeiDetail.countDocuments(),
      ImeiDetail.distinct("no_dokumen").then((a) => a.length),
      ImeiDetail.aggregate([
        { $group: { _id: "$merk", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
    ]);

    const ov = overview[0] || {};
    const enrichment = {
      totalDevicesScraped: detCount,
      uniqueRegistrationsScraped: detUniqueRegs,
      csvRegistrations: ov.total || 0,
      coverageEstimate:
        ov.total > 0
          ? Math.min(100, (detUniqueRegs / (ov.total || 1)) * 100).toFixed(1) +
            "%"
          : "0%",
      topBrandsFromDetail: detBrandSummary,
      dataStatus:
        detUniqueRegs === 0
          ? "NO_DETAIL_DATA"
          : detUniqueRegs < (ov.total || 0) * 0.5
            ? "PARTIAL_COVERAGE"
            : "GOOD_COVERAGE",
    };

    res.json({
      status: "ok",
      data: {
        overview: ov,
        byNationality,
        byStatus,
        byOffice: enrichedOffices,
        byVessel,
        dailyTrend,
        topPassengers,
        pungutanDistribution,
        repeatRegistrants: repeatRegistrants.map((r) => ({
          ...r,
          offices_names: r.offices.map(getKantorName),
        })),
        officerStats,
        hourlyPattern,
        nationalityPayment,
        vesselPayment,
        kantorMap: KANTOR_MAP,
        enrichment,
      },
    });
  } catch (err) {
    console.error("[IMEI Analytics]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==================== SEARCH (CROSS-COLLECTION) ====================
router.get("/search", async (req, res) => {
  try {
    const { q, limit = 50 } = req.query;
    if (!q || q.length < 2) {
      return res.json({ status: "ok", data: [], total: 0 });
    }

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");
    const ImeiDetail = require("../models/ImeiDetail");

    // Search all three collections in parallel
    const [regData, detData, ceisaRaw] = await Promise.all([
      ImeiRegistration.find({
        $or: [
          { nama: regex },
          { no_identitas: regex },
          { vessel: regex },
          { vessel_normalized: regex },
          { no_dok: regex },
          { id_registrasi: regex },
        ],
      })
        .sort({ tgl_kedatangan: -1 })
        .limit(parseInt(limit))
        .lean(),
      ImeiDetail.find({
        $or: [
          { nama: regex },
          { no_identitas: regex },
          { flight_voyage: regex },
          { flight_normalized: regex },
          { no_dokumen: regex },
          { imei1: regex },
          { imei2: regex },
          { merk: regex },
          { tipe: regex },
        ],
      })
        .sort({ waktu_kedatangan: -1 })
        .limit(parseInt(limit))
        .lean(),
      // Search CEISA local (Passenger) collection
      Passenger.find({
        $or: [
          { nama_lengkap: regex },
          { paspor: regex },
        ],
      })
        .sort({ tanggal_dokumen: -1 })
        .limit(parseInt(limit) * 2)
        .lean(),
    ]);

    // Merge results, preferring detail data for overlapping no_dok
    const detNoDoks = new Set(detData.map((d) => d.no_dokumen));
    const regFiltered = regData.filter((r) => !detNoDoks.has(r.no_dok));

    // Group CEISA records by passport → one entry per person
    const ceisaByPaspor = {};
    ceisaRaw.forEach((r) => {
      const key = r.paspor;
      if (!ceisaByPaspor[key]) {
        ceisaByPaspor[key] = {
          no_identitas: r.paspor,
          nama: r.nama_lengkap || "",
          kebangsaan: "",
          vessel: null,
          tgl_kedatangan: r.tanggal_dokumen,
          status_pembayaran: r.status_penelitian || "",
          total_pungutan: 0,
          kode_kantor: r.kode_kantor,
          kantor_nama: getKantorName(r.kode_kantor),
          _source: "ceisa_local",
          _ceisa_count: 0,
          _billing: 0,
          _pembebasan: 0,
          devices: [],
        };
      }
      const entry = ceisaByPaspor[key];
      entry._ceisa_count++;
      if (r.status_penelitian === "BILLING") entry._billing++;
      if (r.status_penelitian === "PEMBEBASAN") entry._pembebasan++;
      if (r.hkt1 && !entry.devices.includes(r.hkt1)) entry.devices.push(r.hkt1);
      if (r.hkt2 && !entry.devices.includes(r.hkt2)) entry.devices.push(r.hkt2);
      // Keep the nama from latest record if not set
      if (!entry.nama && r.nama_lengkap) entry.nama = r.nama_lengkap;
      // Composite status: if any billing exists, show BILLING
      if (r.status_penelitian === "BILLING") entry.status_pembayaran = "BILLING";
    });

    // Exclude CEISA results whose passport already appears in IMEI/Detail results
    const imeiPassports = new Set([
      ...regFiltered.map((r) => r.no_identitas),
      ...detData.map((r) => r.no_identitas),
    ].filter(Boolean));
    const ceisaResults = Object.values(ceisaByPaspor)
      .filter((r) => !imeiPassports.has(r.no_identitas))
      .slice(0, parseInt(limit));

    const merged = [
      ...detData.map((d) => ({
        ...d,
        _source: "detail",
        vessel: d.flight_voyage || d.vessel || null,
        tgl_kedatangan: d.waktu_kedatangan || d.tgl_kedatangan || null,
        status_pembayaran: d.cara_pembayaran || d.status_pembayaran || null,
        no_dok: d.no_dokumen || d.no_dok || null,
        kantor_nama: getKantorName(d.kode_kantor),
      })),
      ...regFiltered.map((d) => ({
        ...d,
        _source: "registration",
        kantor_nama: getKantorName(d.kode_kantor),
      })),
      ...ceisaResults,
    ].slice(0, parseInt(limit));

    res.json({
      status: "ok",
      data: merged,
      total: merged.length,
      sources: {
        fromRegistration: regFiltered.length,
        fromDetail: detData.length,
        fromCeisaLocal: ceisaResults.length,
        deduplicatedOverlap: regData.length - regFiltered.length,
      },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==================== PASSPORT LOOKUP (CROSS-CHECK) ====================
router.get("/passport/:no", async (req, res) => {
  try {
    const passport = req.params.no.toUpperCase().trim();

    // Parallel: IMEI registrations + CEISA passenger data + manifest data + device details
    const ImeiDetail = require("../models/ImeiDetail");
    const [imeiRecords, ceisaRecords, manifestRecords, deviceRecords] =
      await Promise.all([
        ImeiRegistration.find({ no_identitas: passport })
          .sort({ tgl_kedatangan: -1 })
          .lean(),
        Passenger.find({ paspor: passport })
          .sort({ tanggal_dokumen: -1 })
          .lean(),
        ManifestPassenger.find({ passport_number: passport })
          .sort({ createdAt: -1 })
          .limit(20)
          .lean(),
        ImeiDetail.find({ no_identitas: passport })
          .sort({ waktu_kedatangan: -1 })
          .lean(),
      ]);

    if (
      !imeiRecords.length &&
      !ceisaRecords.length &&
      !manifestRecords.length &&
      !deviceRecords.length
    ) {
      return res.json({ status: "ok", data: null, message: "Tidak ditemukan" });
    }

    // IMEI summary
    const imeiSummary = {
      total_registrations: imeiRecords.length,
      total_pungutan: imeiRecords.reduce(
        (s, r) => s + (r.total_pungutan || 0),
        0,
      ),
      pembebasan_count: imeiRecords.filter(
        (r) => r.status_pembayaran === "PEMBEBASAN",
      ).length,
      billing_count: imeiRecords.filter(
        (r) => r.status_pembayaran === "BILLING",
      ).length,
      unique_offices: [...new Set(imeiRecords.map((r) => r.kode_kantor))],
      unique_vessels: [
        ...new Set(imeiRecords.map((r) => r.vessel).filter(Boolean)),
      ],
      first_registration: imeiRecords.length
        ? imeiRecords[imeiRecords.length - 1].tgl_kedatangan
        : null,
      last_registration: imeiRecords.length
        ? imeiRecords[0].tgl_kedatangan
        : null,
      offices_detail: [...new Set(imeiRecords.map((r) => r.kode_kantor))].map(
        (k) => ({
          kode: k,
          nama: getKantorName(k),
          count: imeiRecords.filter((r) => r.kode_kantor === k).length,
        }),
      ),
    };

    // CEISA summary
    const ceisaTotalPungutan = ceisaRecords.reduce((s, r) => s + (r.jumlah_pungutan || 0), 0);
    const ceisaSummary = {
      total_records: ceisaRecords.length,
      devices: [
        ...new Set(
          [
            ...ceisaRecords.map((r) => r.hkt1),
            ...ceisaRecords.map((r) => r.hkt2),
          ].filter(Boolean),
        ),
      ],
      billing_count: ceisaRecords.filter(
        (r) => r.status_penelitian === "BILLING",
      ).length,
      pembebasan_count: ceisaRecords.filter(
        (r) => r.status_penelitian === "PEMBEBASAN",
      ).length,
      total_pungutan: ceisaTotalPungutan,
      pungutan_available: ceisaTotalPungutan > 0,
    };

    // Anomaly detection
    const anomalies = [];
    if (imeiRecords.length >= 3) {
      anomalies.push({
        type: "FREQUENT_REGISTRANT",
        severity: imeiRecords.length >= 5 ? "HIGH" : "MEDIUM",
        message: `${imeiRecords.length} registrasi IMEI tercatat — kemungkinan pola jastip/kurir`,
      });
    }
    if (imeiSummary.unique_offices.length >= 2) {
      anomalies.push({
        type: "MULTI_OFFICE",
        severity: "MEDIUM",
        message: `Registrasi di ${imeiSummary.unique_offices.length} kantor berbeda: ${imeiSummary.unique_offices.map(getKantorName).join(", ")}`,
      });
    }
    const billingRatio =
      imeiRecords.length > 0
        ? imeiSummary.billing_count / imeiRecords.length
        : 0;
    if (billingRatio >= 0.8 && imeiRecords.length >= 3) {
      anomalies.push({
        type: "HIGH_BILLING_RATIO",
        severity: "HIGH",
        message: `${(billingRatio * 100).toFixed(0)}% registrasi berstatus BILLING — kemungkinan pembawa barang komersial`,
      });
    }
    if (imeiSummary.total_pungutan >= 5000000) {
      anomalies.push({
        type: "HIGH_VALUE",
        severity: imeiSummary.total_pungutan >= 20000000 ? "HIGH" : "MEDIUM",
        message: `Total pungutan Rp ${(imeiSummary.total_pungutan / 1e6).toFixed(1)} juta`,
      });
    }

    // Risk score
    let riskScore = 0;
    riskScore += Math.min(imeiRecords.length * 5, 30);
    riskScore += Math.min(imeiSummary.unique_offices.length * 10, 20);
    riskScore += Math.min(imeiSummary.billing_count * 8, 24);
    riskScore += ceisaRecords.length >= 3 ? 10 : 0;
    riskScore += anomalies.filter((a) => a.severity === "HIGH").length * 8;

    let riskLevel = "GREEN";
    let riskColor = "#22c55e";
    if (riskScore >= 50) {
      riskLevel = "RED";
      riskColor = "#ef4444";
    } else if (riskScore >= 25) {
      riskLevel = "YELLOW";
      riskColor = "#eab308";
    }

    res.json({
      status: "ok",
      data: {
        passport: passport,
        nama:
          imeiRecords[0]?.nama ||
          ceisaRecords[0]?.nama_lengkap ||
          manifestRecords[0]?.name ||
          "",
        kebangsaan:
          imeiRecords[0]?.kebangsaan ||
          ceisaRecords[0]?.kebangsaan ||
          manifestRecords[0]?.nationality ||
          "",
        risk: { score: riskScore, level: riskLevel, color: riskColor },
        anomalies,
        imei: imeiSummary,
        imei_records: imeiRecords.map((r) => ({
          ...r,
          kantor_nama: getKantorName(r.kode_kantor),
        })),
        ceisa: ceisaSummary,
        ceisa_records: ceisaRecords.slice(0, 10),
        manifest_records: manifestRecords.slice(0, 10),
        device_details: {
          total: deviceRecords.length,
          brands: [
            ...new Set(deviceRecords.map((r) => r.merk).filter(Boolean)),
          ],
          imeis: deviceRecords
            .flatMap((r) => [r.imei1, r.imei2].filter(Boolean))
            .slice(0, 20),
          totalFobUsd: deviceRecords.reduce(
            (s, r) => s + (r.harga_fob_usd || 0),
            0,
          ),
          totalPungutan: deviceRecords.reduce(
            (s, r) => s + (r.total_pungutan || 0),
            0,
          ),
          records: deviceRecords.slice(0, 20),
        },
      },
    });
  } catch (err) {
    console.error("[IMEI Passport]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==================== VESSEL LOOKUP ====================
router.get("/vessel/:code", async (req, res) => {
  try {
    const code = req.params.code.replace(/[\s\-]/g, "").toUpperCase();

    const data = await ImeiRegistration.find({ vessel_normalized: code })
      .sort({ tgl_kedatangan: -1 })
      .lean();

    const summary = {
      total: data.length,
      total_pungutan: data.reduce((s, r) => s + (r.total_pungutan || 0), 0),
      pembebasan: data.filter((r) => r.status_pembayaran === "PEMBEBASAN")
        .length,
      billing: data.filter((r) => r.status_pembayaran === "BILLING").length,
      nationalities: [...new Set(data.map((r) => r.kebangsaan))],
      offices: [...new Set(data.map((r) => r.kode_kantor))].map((k) => ({
        kode: k,
        nama: getKantorName(k),
        count: data.filter((r) => r.kode_kantor === k).length,
      })),
      dates: [
        ...new Set(
          data
            .map((r) => r.tgl_kedatangan?.toISOString?.()?.slice(0, 10))
            .filter(Boolean),
        ),
      ],
    };

    res.json({ status: "ok", data: { vessel: code, summary, records: data } });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==================== ANOMALY DETECTION ====================
router.get("/anomalies", async (req, res) => {
  try {
    const { min_count = 3 } = req.query;

    const [repeatPassports, multiOffice, highBilling, highValue] =
      await Promise.all([
        // Repeat registrants
        ImeiRegistration.aggregate([
          { $match: { no_identitas: { $ne: "" } } },
          {
            $group: {
              _id: "$no_identitas",
              nama: { $first: "$nama" },
              kebangsaan: { $first: "$kebangsaan" },
              count: { $sum: 1 },
              total_pungutan: { $sum: "$total_pungutan" },
              vessels: { $addToSet: "$vessel" },
              offices: { $addToSet: "$kode_kantor" },
              dates: { $push: "$tgl_kedatangan" },
            },
          },
          { $match: { count: { $gte: parseInt(min_count) } } },
          { $sort: { count: -1 } },
          { $limit: 30 },
        ]),

        // Multi-office registrants
        ImeiRegistration.aggregate([
          { $match: { no_identitas: { $ne: "" } } },
          {
            $group: {
              _id: "$no_identitas",
              nama: { $first: "$nama" },
              kebangsaan: { $first: "$kebangsaan" },
              offices: { $addToSet: "$kode_kantor" },
              count: { $sum: 1 },
              total_pungutan: { $sum: "$total_pungutan" },
              vessels: { $addToSet: "$vessel" },
            },
          },
          { $match: { $expr: { $gte: [{ $size: "$offices" }, 2] } } },
          { $sort: { count: -1 } },
          { $limit: 20 },
        ]),

        // High billing individuals
        ImeiRegistration.aggregate([
          {
            $match: { no_identitas: { $ne: "" }, status_pembayaran: "BILLING" },
          },
          {
            $group: {
              _id: "$no_identitas",
              nama: { $first: "$nama" },
              kebangsaan: { $first: "$kebangsaan" },
              billing_count: { $sum: 1 },
              total_pungutan: { $sum: "$total_pungutan" },
              vessels: { $addToSet: "$vessel" },
            },
          },
          { $match: { billing_count: { $gte: 2 } } },
          { $sort: { total_pungutan: -1 } },
          { $limit: 20 },
        ]),

        // High-value single transactions
        ImeiRegistration.aggregate([
          { $match: { total_pungutan: { $gte: 5000000 } } },
          { $sort: { total_pungutan: -1 } },
          { $limit: 20 },
          {
            $project: {
              nama: 1,
              no_identitas: 1,
              kebangsaan: 1,
              vessel: 1,
              tgl_kedatangan: 1,
              total_pungutan: 1,
              status_pembayaran: 1,
              kode_kantor: 1,
            },
          },
        ]),
      ]);

    res.json({
      status: "ok",
      data: {
        repeat_passports: repeatPassports.map((r) => ({
          ...r,
          offices_names: r.offices.map(getKantorName),
          type: "REPEAT_REGISTRANT",
          severity: r.count >= 5 ? "HIGH" : "MEDIUM",
        })),
        multi_office: multiOffice.map((r) => ({
          ...r,
          offices_names: r.offices.map(getKantorName),
          type: "MULTI_OFFICE",
          severity: r.offices.length >= 3 ? "HIGH" : "MEDIUM",
        })),
        high_billing: highBilling.map((r) => ({
          ...r,
          type: "HIGH_BILLING",
          severity: r.total_pungutan >= 10000000 ? "HIGH" : "MEDIUM",
        })),
        high_value: highValue.map((r) => ({
          ...r,
          kantor_nama: getKantorName(r.kode_kantor),
          type: "HIGH_VALUE",
          severity: r.total_pungutan >= 20000000 ? "HIGH" : "MEDIUM",
        })),
        summary: {
          repeat_count: repeatPassports.length,
          multi_office_count: multiOffice.length,
          high_billing_count: highBilling.length,
          high_value_count: highValue.length,
        },
      },
    });
  } catch (err) {
    console.error("[IMEI Anomalies]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==================== OFFICE BREAKDOWN ====================
router.get("/offices", async (req, res) => {
  try {
    const data = await ImeiRegistration.aggregate([
      {
        $group: {
          _id: "$kode_kantor",
          total: { $sum: 1 },
          total_pungutan: { $sum: "$total_pungutan" },
          pembebasan: {
            $sum: {
              $cond: [{ $eq: ["$status_pembayaran", "PEMBEBASAN"] }, 1, 0],
            },
          },
          billing: {
            $sum: { $cond: [{ $eq: ["$status_pembayaran", "BILLING"] }, 1, 0] },
          },
          bppm: {
            $sum: { $cond: [{ $eq: ["$status_pembayaran", "BPPM"] }, 1, 0] },
          },
          unique_passports: { $addToSet: "$no_identitas" },
          nationalities: { $addToSet: "$kebangsaan" },
          top_vessels: { $push: "$vessel" },
        },
      },
      {
        $project: {
          total: 1,
          total_pungutan: 1,
          pembebasan: 1,
          billing: 1,
          bppm: 1,
          unique_passports: { $size: "$unique_passports" },
          nationality_count: { $size: "$nationalities" },
          nationalities: 1,
        },
      },
      { $sort: { total: -1 } },
    ]);

    res.json({
      status: "ok",
      data: data.map((o) => ({
        ...o,
        kantor_nama: getKantorName(o._id),
        billing_rate:
          o.total > 0 ? ((o.billing / o.total) * 100).toFixed(1) + "%" : "0%",
      })),
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==================== TOP FLIGHTS ====================
router.get("/top-flights", async (req, res) => {
  try {
    const { limit = 20, kode_kantor } = req.query;
    const match = { vessel: { $ne: "" } };
    if (kode_kantor) match.kode_kantor = kode_kantor;

    const data = await ImeiRegistration.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$vessel",
          normalized: { $first: "$vessel_normalized" },
          count: { $sum: 1 },
          total_pungutan: { $sum: "$total_pungutan" },
          pembebasan: {
            $sum: {
              $cond: [{ $eq: ["$status_pembayaran", "PEMBEBASAN"] }, 1, 0],
            },
          },
          billing: {
            $sum: { $cond: [{ $eq: ["$status_pembayaran", "BILLING"] }, 1, 0] },
          },
          nationalities: { $addToSet: "$kebangsaan" },
          offices: { $addToSet: "$kode_kantor" },
          dates: { $push: "$tgl_kedatangan" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: parseInt(limit) },
    ]);

    res.json({
      status: "ok",
      data: data.map((f) => ({
        ...f,
        offices_names: f.offices.map(getKantorName),
        billing_rate:
          f.count > 0 ? ((f.billing / f.count) * 100).toFixed(1) + "%" : "0%",
      })),
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==================== NATIONALITIES LIST ====================
router.get("/nationalities", async (req, res) => {
  try {
    const data = await ImeiRegistration.aggregate([
      { $group: { _id: "$kebangsaan", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    res.json({ status: "ok", data });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==================== OFFICE CODES LIST ====================
router.get("/office-codes", async (req, res) => {
  try {
    const data = await ImeiRegistration.aggregate([
      { $group: { _id: "$kode_kantor", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    res.json({
      status: "ok",
      data: data.map((o) => ({ ...o, kantor_nama: getKantorName(o._id) })),
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

module.exports = router;
