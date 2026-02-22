const express = require("express");
const router = express.Router();
const Cnpibk = require("../models/cnpibk");
const Passenger = require("../models/Passenger");
const Device = require("../models/Device");
const Manifest = require("../models/Manifest");
const UploadLog = require("../models/UploadLog");

// GET /api/dashboard/summary - Executive Dashboard (Consolidated)
router.get("/summary", async (req, res) => {
  try {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const startOfMonth = new Date(currentYear, currentMonth, 1);
    const startOfPrevMonth = new Date(currentYear, currentMonth - 1, 1);
    const endOfPrevMonth = new Date(currentYear, currentMonth, 0, 23, 59, 59);

    const [
      // Counts
      totalDevices,
      totalPassengerRecords,
      totalCargo,
      totalManifests,

      // Monthly comparison - Cargo
      cargoThisMonth,
      cargoPrevMonth,

      // Monthly comparison - Passengers
      paxThisMonth,
      paxPrevMonth,

      // Cargo CIF totals
      cargoCIF,
      cargoHighValue,

      // Cargo monthly trend (last 12 months)
      cargoMonthlyTrend,

      // Passenger monthly trend (last 12 months)
      paxMonthlyTrend,

      // Top PJT (Cargo)
      topPJT,

      // Top Penerima (Cargo)
      topPenerima,

      // Passenger risk analysis
      paxRiskAnalysis,

      // Frequent travelers
      frequentTravelers,

      // Manifest status breakdown
      manifestStatusBreakdown,

      // Recent manifests
      recentManifests,

      // Cargo status breakdown (top 6)
      cargoStatusBreakdown,

      // Recent uploads across modules
      recentUploads,

      // Passenger status breakdown
      paxStatusBreakdown,

      // Device brand distribution
      deviceBrandDist,

      // Unique passengers count
      uniquePassengers,

      // Data date ranges
      cargoDateRange,
      paxDateRange,

      // CIF this month vs prev month
      cifThisMonth,
      cifPrevMonth,

      // High-risk passengers
      highRiskPassengers,
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
        },
        tables: {
          highRiskPassengers,
          recentManifests,
          recentUploads,
        },
        dateRanges: {
          cargo: cargoDateRange[0] || {},
          passengers: paxDateRange[0] || {},
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
