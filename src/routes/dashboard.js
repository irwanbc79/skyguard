const express = require("express");
const router = express.Router();
const Cnpibk = require("../models/cnpibk");
const Passenger = require("../models/Passenger");
const Device = require("../models/Device");
const Manifest = require("../models/Manifest");
const UploadLog = require("../models/UploadLog");
const ManifestPassenger = require("../models/ManifestPassenger");
const { PMI_HUBS } = require("../utils/constants");

// New models for enhanced dashboard (graceful fallback)
let ImeiDetail, ImeiRegistration, ScraperSession, Suspect, Notification;
try {
  ImeiDetail = require("../models/ImeiDetail");
} catch (e) {
  /* optional */
}
try {
  ImeiRegistration = require("../models/ImeiRegistration");
} catch (e) {
  /* optional */
}
try {
  ScraperSession = require("../models/ScraperSession");
} catch (e) {
  /* optional */
}
try {
  Suspect = require("../models/Suspect");
} catch (e) {
  /* optional */
}
try {
  Notification = require("../models/Notification");
} catch (e) {
  /* optional */
}
let PmiRecord;
try {
  PmiRecord = require("../models/PmiRecord");
} catch (e) {
  /* optional */
}

// Safe query helpers — returns defaults if model not loaded
const safeAggregate = (Model, pipeline) =>
  Model ? Model.aggregate(pipeline) : Promise.resolve([]);
const safeCount = (Model, filter) =>
  Model ? Model.countDocuments(filter || {}) : Promise.resolve(0);
const safeDistinct = (Model, field) =>
  Model ? Model.distinct(field).then((a) => a.length) : Promise.resolve(0);

// GET /api/dashboard/summary - Executive Dashboard (Consolidated)
router.get("/summary", async (req, res) => {
  try {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const startOfMonth = new Date(currentYear, currentMonth, 1);
    const startOfPrevMonth = new Date(currentYear, currentMonth - 1, 1);
    const endOfPrevMonth = new Date(currentYear, currentMonth, 0, 23, 59, 59);

    // Pre-fetch hub PMI flights untuk query PMI di bawah
    const pmiHubFlights = await Manifest.distinct("flight_number", {
      origin: { $in: PMI_HUBS },
    });

    const [
      // ===== EXISTING QUERIES =====
      totalDevices,
      totalPassengerRecords,
      totalCargo,
      totalManifests,
      cargoThisMonth,
      cargoPrevMonth,
      paxThisMonth,
      paxPrevMonth,
      cargoCIF,
      cargoHighValue,
      cargoMonthlyTrend,
      paxMonthlyTrend,
      topPJT,
      topPenerima,
      paxRiskAnalysis,
      frequentTravelers,
      manifestStatusBreakdown,
      recentManifests,
      cargoStatusBreakdown,
      recentUploads,
      paxStatusBreakdown,
      deviceBrandDist,
      uniquePassengers,
      cargoDateRange,
      paxDateRange,
      cifThisMonth,
      cifPrevMonth,
      highRiskPassengers,

      // ===== NEW: IMEI Detail Intelligence =====
      totalImeiDetails,
      uniqueImei,
      imeiFobPungutan,
      imeiBrandDist,
      imeiTopNationality,
      imeiPaymentBreakdown,
      imeiMonthlyTrend,
      imeiPungutanBreakdown,
      imeiDateRange,

      // ===== NEW: IMEI Registration =====
      totalImeiRegistrations,
      regPaymentBreakdown,

      // ===== NEW: Scraper Sessions =====
      totalScraperSessions,
      scraperStats,
      recentScraperSessions,
      scraperCoverage,
      imeiDetailBillingStats,

      // ===== NEW: Suspect Intelligence =====
      totalSuspects,
      suspectByRisk,
      suspectByStatus,
      activeSuspects,

      // ===== NEW: Notifications =====
      unreadNotifications,
      criticalNotifications,
      // ===== NEW: PMI (indikasi) =====
      pmiCandidates,
      pmiTopHub,
    ] = await Promise.all([
      // Counts
      Device.countDocuments(),
      Passenger.countDocuments(),
      Cnpibk.countDocuments(),
      Manifest.countDocuments(),

      // Cargo this/prev month
      Cnpibk.countDocuments({ tanggal_hawb: { $gte: startOfMonth } }),
      Cnpibk.countDocuments({
        tanggal_hawb: { $gte: startOfPrevMonth, $lte: endOfPrevMonth },
      }),

      // Pax this/prev month
      Passenger.countDocuments({ tanggal_dokumen: { $gte: startOfMonth } }),
      Passenger.countDocuments({
        tanggal_dokumen: { $gte: startOfPrevMonth, $lte: endOfPrevMonth },
      }),

      // Cargo CIF
      Cnpibk.aggregate([
        {
          $group: {
            _id: null,
            totalCIF: { $sum: "$cif_akhir" },
            avgCIF: { $avg: "$cif_akhir" },
          },
        },
      ]),
      Cnpibk.countDocuments({ cif_akhir: { $gte: 500 } }),

      // Cargo monthly trend
      Cnpibk.aggregate([
        { $match: { tanggal_hawb: { $ne: null } } },
        {
          $group: {
            _id: {
              y: { $year: "$tanggal_hawb" },
              m: { $month: "$tanggal_hawb" },
            },
            count: { $sum: 1 },
            cif: { $sum: "$cif_akhir" },
          },
        },
        { $sort: { "_id.y": 1, "_id.m": 1 } },
        { $limit: 24 },
      ]),

      // Passenger monthly trend
      Passenger.aggregate([
        { $match: { tanggal_dokumen: { $ne: null } } },
        {
          $group: {
            _id: {
              y: { $year: "$tanggal_dokumen" },
              m: { $month: "$tanggal_dokumen" },
            },
            count: { $sum: 1 },
            billing: {
              $sum: {
                $cond: [{ $eq: ["$status_penelitian", "BILLING"] }, 1, 0],
              },
            },
          },
        },
        { $sort: { "_id.y": 1, "_id.m": 1 } },
        { $limit: 24 },
      ]),

      // Top PJT
      Cnpibk.aggregate([
        { $match: { nama_pemberitahu: { $nin: ["", null] } } },
        {
          $group: {
            _id: "$nama_pemberitahu",
            count: { $sum: 1 },
            cif: { $sum: "$cif_akhir" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),

      // Top Penerima
      Cnpibk.aggregate([
        { $match: { nama_penerima: { $nin: ["", null] } } },
        {
          $group: {
            _id: "$nama_penerima",
            count: { $sum: 1 },
            cif: { $sum: "$cif_akhir" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),

      // Risk analysis
      Passenger.aggregate([
        {
          $group: {
            _id: "$paspor",
            visits: { $sum: 1 },
            devices: { $addToSet: "$hkt1" },
            billingCount: {
              $sum: {
                $cond: [{ $eq: ["$status_penelitian", "BILLING"] }, 1, 0],
              },
            },
          },
        },
        {
          $project: {
            visits: 1,
            billingCount: 1,
            deviceCount: {
              $size: {
                $filter: {
                  input: "$devices",
                  as: "d",
                  cond: {
                    $and: [{ $ne: ["$$d", ""] }, { $ne: ["$$d", null] }],
                  },
                },
              },
            },
            riskScore: {
              $add: [
                { $multiply: ["$visits", 2] },
                {
                  $multiply: [
                    {
                      $size: {
                        $filter: {
                          input: "$devices",
                          as: "d",
                          cond: {
                            $and: [
                              { $ne: ["$$d", ""] },
                              { $ne: ["$$d", null] },
                            ],
                          },
                        },
                      },
                    },
                    3,
                  ],
                },
                { $multiply: ["$billingCount", 5] },
              ],
            },
          },
        },
        {
          $group: {
            _id: null,
            high: { $sum: { $cond: [{ $gte: ["$riskScore", 30] }, 1, 0] } },
            medium: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ["$riskScore", 15] },
                      { $lt: ["$riskScore", 30] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            low: { $sum: { $cond: [{ $lt: ["$riskScore", 15] }, 1, 0] } },
            totalBilling: { $sum: "$billingCount" },
          },
        },
      ]),

      // Frequent travelers (>=3 visits)
      Passenger.aggregate([
        { $group: { _id: "$paspor", visits: { $sum: 1 } } },
        { $match: { visits: { $gte: 3 } } },
        { $count: "total" },
      ]),

      // Manifest status
      Manifest.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Recent manifests
      Manifest.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select(
          "flight_number origin destination flight_date status createdAt carrier",
        )
        .lean(),

      // Cargo status
      Cnpibk.aggregate([
        { $group: { _id: "$current_status", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 6 },
      ]),

      // Recent uploads
      UploadLog.find().sort({ createdAt: -1 }).limit(8).lean(),

      // Passenger status
      Passenger.aggregate([
        { $group: { _id: "$status_penelitian", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Device brand distribution
      Device.aggregate([
        { $group: { _id: "$brand", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),

      // Unique passengers
      Passenger.distinct("paspor").then((arr) => arr.length),

      // Date ranges
      Cnpibk.aggregate([
        {
          $group: {
            _id: null,
            min: { $min: "$tanggal_hawb" },
            max: { $max: "$tanggal_hawb" },
          },
        },
      ]),
      Passenger.aggregate([
        {
          $group: {
            _id: null,
            min: { $min: "$tanggal_dokumen" },
            max: { $max: "$tanggal_dokumen" },
          },
        },
      ]),

      // CIF comparison
      Cnpibk.aggregate([
        { $match: { tanggal_hawb: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: "$cif_akhir" } } },
      ]),
      Cnpibk.aggregate([
        {
          $match: {
            tanggal_hawb: { $gte: startOfPrevMonth, $lte: endOfPrevMonth },
          },
        },
        { $group: { _id: null, total: { $sum: "$cif_akhir" } } },
      ]),

      // High risk passengers (top 8)
      Passenger.aggregate([
        {
          $group: {
            _id: "$paspor",
            visits: { $sum: 1 },
            devices: { $addToSet: "$hkt1" },
            billingCount: {
              $sum: {
                $cond: [{ $eq: ["$status_penelitian", "BILLING"] }, 1, 0],
              },
            },
            nama: { $first: "$nama_lengkap" },
            lastVisit: { $max: "$tanggal_dokumen" },
          },
        },
        {
          $project: {
            visits: 1,
            billingCount: 1,
            nama: 1,
            lastVisit: 1,
            deviceCount: {
              $size: {
                $filter: {
                  input: "$devices",
                  as: "d",
                  cond: {
                    $and: [{ $ne: ["$$d", ""] }, { $ne: ["$$d", null] }],
                  },
                },
              },
            },
            riskScore: {
              $add: [
                { $multiply: ["$visits", 2] },
                {
                  $multiply: [
                    {
                      $size: {
                        $filter: {
                          input: "$devices",
                          as: "d",
                          cond: {
                            $and: [
                              { $ne: ["$$d", ""] },
                              { $ne: ["$$d", null] },
                            ],
                          },
                        },
                      },
                    },
                    3,
                  ],
                },
                { $multiply: ["$billingCount", 5] },
              ],
            },
          },
        },
        { $match: { riskScore: { $gte: 15 } } },
        { $sort: { riskScore: -1 } },
        { $limit: 8 },
      ]),

      // ===== NEW: IMEI Detail Aggregations =====
      safeCount(ImeiDetail),
      safeDistinct(ImeiDetail, "imei1"),
      safeAggregate(ImeiDetail, [
        {
          $group: {
            _id: null,
            totalFobUsd: { $sum: "$harga_fob_usd" },
            totalPungutan: { $sum: "$total_pungutan" },
            totalNilaiPabean: { $sum: "$nilai_pabean_rp" },
            totalCifUsd: { $sum: "$total_cif_usd" },
            avgFobUsd: { $avg: "$harga_fob_usd" },
          },
        },
      ]),
      safeAggregate(ImeiDetail, [
        { $match: { merk: { $nin: ["", null] } } },
        {
          $group: {
            _id: "$merk",
            count: { $sum: 1 },
            totalFob: { $sum: "$harga_fob_usd" },
            totalPungutan: { $sum: "$total_pungutan" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      safeAggregate(ImeiDetail, [
        { $match: { kebangsaan: { $nin: ["", null] } } },
        {
          $group: {
            _id: "$kebangsaan",
            count: { $sum: 1 },
            totalFob: { $sum: "$harga_fob_usd" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
      safeAggregate(ImeiDetail, [
        {
          $group: {
            _id: "$cara_pembayaran",
            count: { $sum: 1 },
            totalPungutan: { $sum: "$total_pungutan" },
          },
        },
        { $sort: { count: -1 } },
      ]),
      safeAggregate(ImeiDetail, [
        { $match: { waktu_kedatangan: { $ne: null } } },
        {
          $group: {
            _id: {
              y: { $year: "$waktu_kedatangan" },
              m: { $month: "$waktu_kedatangan" },
            },
            count: { $sum: 1 },
            fob: { $sum: "$harga_fob_usd" },
            pungutan: { $sum: "$total_pungutan" },
          },
        },
        { $sort: { "_id.y": 1, "_id.m": 1 } },
        { $limit: 24 },
      ]),
      safeAggregate(ImeiDetail, [
        {
          $group: {
            _id: null,
            totalBM: { $sum: "$pungutan_bm" },
            totalPPN: { $sum: "$pungutan_ppn" },
            totalPPH: { $sum: "$pungutan_pph" },
            totalPungutan: { $sum: "$total_pungutan" },
          },
        },
      ]),
      safeAggregate(ImeiDetail, [
        {
          $group: {
            _id: null,
            min: { $min: "$waktu_kedatangan" },
            max: { $max: "$waktu_kedatangan" },
          },
        },
      ]),

      // ===== NEW: IMEI Registration =====
      safeCount(ImeiRegistration),
      safeAggregate(ImeiRegistration, [
        {
          $group: {
            _id: "$status_pembayaran",
            count: { $sum: 1 },
            totalPungutan: { $sum: "$total_pungutan" },
          },
        },
        { $sort: { count: -1 } },
      ]),

      // ===== NEW: Scraper Sessions =====
      safeCount(ScraperSession),
      safeAggregate(ScraperSession, [
        {
          $group: {
            _id: null,
            totalRecordsScraped: { $sum: "$total_records" },
            totalNewRecords: { $sum: "$new_records" },
            completedSessions: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
            },
            avgElapsed: { $avg: "$elapsed_seconds" },
          },
        },
      ]),
      ScraperSession
        ? ScraperSession.find()
            .sort({ started_at: -1 })
            .limit(3)
            .select(
              "session_id status type total_records new_records started_at elapsed_seconds date_range",
            )
            .lean()
        : Promise.resolve([]),
      // Coverage: earliest date_start & latest date_end from completed sessions
      safeAggregate(ScraperSession, [
        { $match: { status: "completed" } },
        {
          $group: {
            _id: null,
            earliestStart: { $min: "$date_range.start" },
            latestEnd: { $max: "$date_range.end" },
            totalPungutan: { $sum: "$total_pungutan" },
            totalFobUsd: { $sum: "$total_fob_usd" },
          },
        },
      ]),
      // ImeiDetail BILLING stats
      safeAggregate(ImeiDetail, [
        {
          $group: {
            _id: "$cara_pembayaran",
            count: { $sum: 1 },
            total_pungutan: { $sum: "$total_pungutan" },
          },
        },
      ]),

      // ===== NEW: Suspect Intelligence =====
      safeCount(Suspect),
      safeAggregate(Suspect, [
        { $group: { _id: "$risk_level", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      safeAggregate(Suspect, [
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      safeCount(Suspect, { status: "ACTIVE" }),

      // ===== NEW: Notifications =====
      safeCount(Notification, { is_read: false }),
      safeCount(Notification, {
        priority: { $in: ["CRITICAL", "HIGH"] },
        is_read: false,
      }),

      // ===== PMI — dari PmiRecord (data terverifikasi petugas) =====
      safeAggregate(PmiRecord, [
        { $match: { status: "CONFIRMED" } },
        { $group: { _id: "$passport_number" } },
        { $count: "total" },
      ]),
      safeAggregate(PmiRecord, [
        { $match: { status: "CONFIRMED" } },
        { $group: { _id: "$lembaga", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 1 },
      ]),
    ]);

    // Calculate trends
    const calcTrend = (current, previous) => {
      if (!previous || previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    const cargoTrend = calcTrend(cargoThisMonth, cargoPrevMonth);
    const paxTrend = calcTrend(paxThisMonth, paxPrevMonth);
    const cifThisVal = cifThisMonth[0]?.total || 0;
    const cifPrevVal = cifPrevMonth[0]?.total || 0;
    const cifTrend = calcTrend(cifThisVal, cifPrevVal);

    const risk = paxRiskAnalysis[0] || {
      high: 0,
      medium: 0,
      low: 0,
      totalBilling: 0,
    };
    const imeiTotals = imeiFobPungutan[0] || {
      totalFobUsd: 0,
      totalPungutan: 0,
      totalNilaiPabean: 0,
      totalCifUsd: 0,
      avgFobUsd: 0,
    };
    const pungutanDetail = imeiPungutanBreakdown[0] || {
      totalBM: 0,
      totalPPN: 0,
      totalPPH: 0,
      totalPungutan: 0,
    };
    const scraperTotals = scraperStats[0] || {
      totalRecordsScraped: 0,
      totalNewRecords: 0,
      completedSessions: 0,
      avgElapsed: 0,
    };
    const scraperCoverageData = scraperCoverage[0] || { earliestStart: null, latestEnd: null, totalPungutan: 0, totalFobUsd: 0 };
    const billingRow = (imeiDetailBillingStats || []).find(r => r._id === "BILLING") || { count: 0, total_pungutan: 0 };
    const pembebasanRow = (imeiDetailBillingStats || []).find(r => r._id === "PEMBEBASAN") || { count: 0, total_pungutan: 0 };
    const pmiTotal = pmiCandidates?.[0]?.total || 0;
    const pmiHub = pmiTopHub?.[0] || null;  // { _id: "BP2MI", count: N }

    res.json({
      status: "ok",
      data: {
        kpi: {
          totalDevices,
          totalPassengerRecords,
          uniquePassengers,
          totalCargo,
          totalManifests,
          cargoHighValue,
          totalCIF: cargoCIF[0]?.totalCIF || 0,
          avgCIF: cargoCIF[0]?.avgCIF || 0,
          frequentTravelers: frequentTravelers[0]?.total || 0,
          // NEW IMEI KPIs
          totalImeiDetails,
          uniqueImei,
          totalFobUsd: imeiTotals.totalFobUsd,
          totalPungutan: imeiTotals.totalPungutan,
          totalNilaiPabean: imeiTotals.totalNilaiPabean,
          avgFobUsd: imeiTotals.avgFobUsd,
          totalImeiRegistrations,
          totalSuspects,
          activeSuspects,
          unreadNotifications,
          criticalNotifications,
          totalScraperSessions,
          scraperRecordsTotal: scraperTotals.totalRecordsScraped,
          scraperNewRecords: scraperTotals.totalNewRecords,
          scraperCompleted: scraperTotals.completedSessions,
          scraperDataCoverage: {
            earliestStart: scraperCoverageData.earliestStart,
            latestEnd: scraperCoverageData.latestEnd,
            totalPungutan: scraperCoverageData.totalPungutan,
            totalFobUsd: scraperCoverageData.totalFobUsd,
          },
          imeiDetailBilling: billingRow.count,
          imeiDetailPembebasan: pembebasanRow.count,
          imeiDetailBillingPungutan: billingRow.total_pungutan,
          // PMI terverifikasi (dari PmiRecord)
          pmiCandidates: pmiTotal,
          pmiTopHub: pmiHub ? { code: pmiHub._id, count: pmiHub.count } : null,
        },
        trends: {
          cargoThisMonth,
          cargoPrevMonth,
          cargoTrend,
          paxThisMonth,
          paxPrevMonth,
          paxTrend,
          cifThisMonth: cifThisVal,
          cifPrevMonth: cifPrevVal,
          cifTrend,
        },
        risk,
        charts: {
          cargoMonthlyTrend,
          paxMonthlyTrend,
          topPJT,
          topPenerima,
          cargoStatusBreakdown,
          paxStatusBreakdown,
          manifestStatusBreakdown,
          deviceBrandDist,
          // NEW
          imeiBrandDist,
          imeiTopNationality,
          imeiPaymentBreakdown,
          imeiMonthlyTrend,
          regPaymentBreakdown,
          suspectByRisk,
          suspectByStatus,
        },
        tables: {
          highRiskPassengers,
          recentManifests,
          recentUploads,
          recentScraperSessions,
        },
        pungutan: pungutanDetail,
        dateRanges: {
          cargo: cargoDateRange[0] || {},
          passengers: paxDateRange[0] || {},
          imei: imeiDateRange[0] || {},
        },
      },
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("[DASHBOARD]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

module.exports = router;
