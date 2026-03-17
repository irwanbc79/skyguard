/**
 * IMEI Detail Routes — Device-Level Intelligence
 *
 * This provides device-level intelligence from IMEI registration detail data.
 * Each registration can have multiple devices, each with actual IMEI numbers,
 * brand, model, storage, pricing, and individual tax calculations.
 *
 * Endpoints:
 *   GET  /api/imei-details                    - List with filters & pagination
 *   GET  /api/imei-details/analytics          - Brand/device/pricing analytics
 *   GET  /api/imei-details/search-imei/:imei  - Track a specific IMEI number
 *   GET  /api/imei-details/passport/:no       - All devices for a passport holder
 *   GET  /api/imei-details/brand-intelligence - Brand market analysis
 *   GET  /api/imei-details/anomalies          - Device-level anomaly detection
 *   GET  /api/imei-details/top-devices        - Most popular device models
 *   GET  /api/imei-details/price-analysis     - Pricing & valuation intelligence
 */
const express = require("express");
const router = express.Router();
const { escapeRegex, parsePagination } = require("../utils/helpers");
const ImeiDetail = require("../models/ImeiDetail");
const ImeiRegistration = require("../models/ImeiRegistration");

// ============================================================
// 1. GET / — List with filters & pagination
// ============================================================
router.get("/", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      merk,
      tipe,
      imei,
      passport,
      flight,
      payment,
      kantor,
      bekas,
      minPrice,
      maxPrice,
      sort = "-waktu_kedatangan",
    } = req.query;

    const filter = {};
    if (merk) filter.merk = new RegExp(escapeRegex(merk), "i");
    if (tipe) filter.tipe = new RegExp(escapeRegex(tipe), "i");
    if (imei) {
      const safe = escapeRegex(imei);
      filter.$or = [{ imei1: new RegExp(safe, "i") }, { imei2: new RegExp(safe, "i") }];
    }
    if (passport) filter.no_identitas = new RegExp(escapeRegex(passport), "i");
    if (flight)
      filter.flight_normalized = new RegExp(escapeRegex(flight.replace(/[\s\-]/g, "")), "i");
    if (payment) filter.cara_pembayaran = payment.toUpperCase();
    if (kantor) filter.kode_kantor = kantor;
    if (bekas !== undefined) filter.bekas = bekas === "true";
    if (minPrice || maxPrice) {
      filter.harga_fob_usd = {};
      const min = parseFloat(minPrice);
      const max = parseFloat(maxPrice);
      if (Number.isFinite(min)) filter.harga_fob_usd.$gte = min;
      if (Number.isFinite(max)) filter.harga_fob_usd.$lte = max;
    }

    const { page: p, limit: l, skip } = parsePagination(req.query, { page: 1, limit: 50 });
    const sortObj = {};
    const sortField = sort.startsWith("-") ? sort.slice(1) : sort;
    sortObj[sortField] = sort.startsWith("-") ? -1 : 1;

    const [data, total] = await Promise.all([
      ImeiDetail.find(filter)
        .sort(sortObj)
        .skip(skip)
        .limit(l)
        .lean(),
      ImeiDetail.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data,
      pagination: {
        page: p,
        limit: l,
        total,
        pages: Math.ceil(total / l) || 1,
      },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// 2. GET /analytics — Comprehensive device analytics
// ============================================================
router.get("/analytics", async (req, res) => {
  try {
    const [
      totalDevices,
      totalRegistrations,
      brandDistribution,
      paymentBreakdown,
      topModels,
      storageDistribution,
      priceStats,
      dailyTrend,
      officeBreakdown,
      conditionStats,
      avgPriceByBrand,
      multiDeviceRegistrations,
    ] = await Promise.all([
      // 1. Total devices
      ImeiDetail.countDocuments(),
      // 2. Unique registrations
      ImeiDetail.distinct("registration_id").then((a) => a.length),
      // 3. Brand distribution
      ImeiDetail.aggregate([
        {
          $group: {
            _id: "$merk",
            count: { $sum: 1 },
            totalValue: { $sum: "$harga_fob_usd" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
      // 4. Payment breakdown
      ImeiDetail.aggregate([
        {
          $group: {
            _id: "$cara_pembayaran",
            count: { $sum: 1 },
            totalPungutan: { $sum: "$total_pungutan" },
          },
        },
        { $sort: { count: -1 } },
      ]),
      // 5. Top models
      ImeiDetail.aggregate([
        {
          $group: {
            _id: { merk: "$merk", tipe: "$tipe" },
            count: { $sum: 1 },
            avgPrice: { $avg: "$harga_fob_usd" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
      // 6. Storage distribution
      ImeiDetail.aggregate([
        { $match: { storage_normalized: { $gt: 0 } } },
        { $group: { _id: "$storage_normalized", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      // 7. Price statistics
      ImeiDetail.aggregate([
        {
          $group: {
            _id: null,
            avgFob: { $avg: "$harga_fob_usd" },
            maxFob: { $max: "$harga_fob_usd" },
            totalFob: { $sum: "$harga_fob_usd" },
            avgCif: { $avg: "$cif_usd" },
            totalPungutan: { $sum: "$total_pungutan" },
            totalBM: { $sum: "$pungutan_bm" },
            totalPPN: { $sum: "$pungutan_ppn" },
            totalPPh: { $sum: "$pungutan_pph" },
          },
        },
      ]),
      // 8. Daily trend
      ImeiDetail.aggregate([
        { $match: { waktu_kedatangan: { $ne: null } } },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$waktu_kedatangan" },
            },
            devices: { $sum: 1 },
            totalValue: { $sum: "$harga_fob_usd" },
          },
        },
        { $sort: { _id: -1 } },
        { $limit: 30 },
      ]),
      // 9. Office breakdown
      ImeiDetail.aggregate([
        { $match: { kode_kantor: { $ne: "" } } },
        {
          $group: {
            _id: "$kode_kantor",
            devices: { $sum: 1 },
            totalValue: { $sum: "$harga_fob_usd" },
            totalPungutan: { $sum: "$total_pungutan" },
          },
        },
        { $sort: { devices: -1 } },
        { $limit: 15 },
      ]),
      // 10. New vs Used
      ImeiDetail.aggregate([
        {
          $group: {
            _id: "$bekas",
            count: { $sum: 1 },
            avgPrice: { $avg: "$harga_fob_usd" },
          },
        },
      ]),
      // 11. Avg price by brand
      ImeiDetail.aggregate([
        { $match: { harga_fob_usd: { $gt: 0 } } },
        {
          $group: {
            _id: "$merk",
            avgPrice: { $avg: "$harga_fob_usd" },
            maxPrice: { $max: "$harga_fob_usd" },
            count: { $sum: 1 },
          },
        },
        { $sort: { avgPrice: -1 } },
        { $limit: 15 },
      ]),
      // 12. Multi-device registrations
      ImeiDetail.aggregate([
        { $group: { _id: "$registration_id", deviceCount: { $sum: 1 } } },
        { $match: { deviceCount: { $gt: 1 } } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            maxDevices: { $max: "$deviceCount" },
          },
        },
      ]),
    ]);

    res.json({
      success: true,
      analytics: {
        totalDevices,
        totalRegistrations,
        brandDistribution,
        paymentBreakdown,
        topModels,
        storageDistribution,
        priceStats: priceStats[0] || {},
        dailyTrend,
        officeBreakdown,
        conditionStats,
        avgPriceByBrand,
        multiDeviceRegistrations: multiDeviceRegistrations[0] || {
          count: 0,
          maxDevices: 0,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// 3. GET /search-imei/:imei — IMEI Tracker
// ============================================================
router.get("/search-imei/:imei", async (req, res) => {
  try {
    const imei = req.params.imei.trim();
    if (imei.length < 10)
      return res
        .status(400)
        .json({ success: false, error: "IMEI min 10 digits" });

    const records = await ImeiDetail.find({
      $or: [{ imei1: new RegExp(imei) }, { imei2: new RegExp(imei) }],
    })
      .sort({ waktu_kedatangan: -1 })
      .lean();

    // Check if same IMEI appears on multiple passports (fraud indicator)
    const passports = [
      ...new Set(records.map((r) => r.no_identitas).filter(Boolean)),
    ];
    const names = [...new Set(records.map((r) => r.nama).filter(Boolean))];
    const flights = [
      ...new Set(records.map((r) => r.flight_voyage).filter(Boolean)),
    ];

    const alert =
      passports.length > 1
        ? {
            type: "MULTI_OWNER_IMEI",
            severity: "HIGH",
            message: `IMEI ${imei} terdaftar atas ${passports.length} paspor berbeda — kemungkinan transfer/jual HP ke orang lain`,
            passports,
            names,
          }
        : null;

    res.json({
      success: true,
      imei,
      total: records.length,
      passports,
      names,
      flights,
      alert,
      records,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// 4. GET /passport/:no — All devices for a passport holder
// ============================================================
router.get("/passport/:no", async (req, res) => {
  try {
    const passport = req.params.no.toUpperCase().trim();
    const records = await ImeiDetail.find({ no_identitas: passport })
      .sort({ waktu_kedatangan: -1 })
      .lean();

    if (records.length === 0) {
      return res.json({
        success: true,
        passport,
        total: 0,
        devices: [],
        summary: null,
      });
    }

    // Build device portfolio
    const brands = {};
    let totalValue = 0;
    let totalPungutan = 0;
    const imeis = [];
    const flights = new Set();

    records.forEach((r) => {
      brands[r.merk] = (brands[r.merk] || 0) + 1;
      totalValue += r.harga_fob_usd || 0;
      totalPungutan += r.total_pungutan || 0;
      if (r.imei1) imeis.push(r.imei1);
      if (r.imei2) imeis.push(r.imei2);
      if (r.flight_voyage) flights.add(r.flight_voyage);
    });

    const brandRanking = Object.entries(brands)
      .sort((a, b) => b[1] - a[1])
      .map(([brand, count]) => ({ brand, count }));

    // Calculate risk indicators
    const riskFactors = [];
    if (records.length >= 5)
      riskFactors.push({
        type: "HEAVY_IMPORTER",
        detail: `${records.length} devices registered`,
      });
    if (totalValue > 5000)
      riskFactors.push({
        type: "HIGH_VALUE",
        detail: `Total FOB $${totalValue.toFixed(0)}`,
      });
    const appleCount = records.filter((r) => r.merk === "APPLE").length;
    if (appleCount >= 3)
      riskFactors.push({
        type: "BULK_APPLE",
        detail: `${appleCount} Apple devices`,
      });
    const uniqueFlights = flights.size;
    if (uniqueFlights >= 3 && records.length >= 5)
      riskFactors.push({
        type: "REPEAT_PATTERN",
        detail: `${uniqueFlights} flights, ${records.length} devices`,
      });

    res.json({
      success: true,
      passport,
      nama: records[0].nama,
      kebangsaan: records[0].kebangsaan,
      total: records.length,
      summary: {
        totalValue,
        totalPungutan,
        uniqueImei: imeis.length,
        uniqueFlights: flights.size,
        brands: brandRanking,
        dateRange: {
          first: records[records.length - 1].waktu_kedatangan,
          last: records[0].waktu_kedatangan,
        },
      },
      riskFactors,
      devices: records,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// 5. GET /brand-intelligence — Brand market analysis
// ============================================================
router.get("/brand-intelligence", async (req, res) => {
  try {
    const [
      brandAnalysis,
      modelRanking,
      brandPricing,
      brandByNationality,
      brandByOffice,
    ] = await Promise.all([
      // Brand overview
      ImeiDetail.aggregate([
        {
          $group: {
            _id: "$merk",
            totalDevices: { $sum: 1 },
            totalFob: { $sum: "$harga_fob_usd" },
            avgFob: { $avg: "$harga_fob_usd" },
            maxFob: { $max: "$harga_fob_usd" },
            totalPungutan: { $sum: "$total_pungutan" },
            billing: {
              $sum: { $cond: [{ $eq: ["$cara_pembayaran", "BILLING"] }, 1, 0] },
            },
            pembebasan: {
              $sum: {
                $cond: [{ $eq: ["$cara_pembayaran", "PEMBEBASAN"] }, 1, 0],
              },
            },
            uniquePassports: { $addToSet: "$no_identitas" },
          },
        },
        {
          $project: {
            totalDevices: 1,
            totalFob: 1,
            avgFob: 1,
            maxFob: 1,
            totalPungutan: 1,
            billing: 1,
            pembebasan: 1,
            uniqueOwners: { $size: "$uniquePassports" },
          },
        },
        { $sort: { totalDevices: -1 } },
      ]),
      // Model ranking
      ImeiDetail.aggregate([
        {
          $group: {
            _id: { merk: "$merk", tipe: "$tipe" },
            count: { $sum: 1 },
            avgFob: { $avg: "$harga_fob_usd" },
            maxFob: { $max: "$harga_fob_usd" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 30 },
      ]),
      // Brand avg pricing tier
      ImeiDetail.aggregate([
        { $match: { harga_fob_usd: { $gt: 0 } } },
        {
          $group: {
            _id: "$merk",
            avgPrice: { $avg: "$harga_fob_usd" },
            medianPrices: { $push: "$harga_fob_usd" },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gte: 3 } } },
        { $sort: { avgPrice: -1 } },
      ]),
      // Brand preference by nationality
      ImeiDetail.aggregate([
        {
          $group: {
            _id: { kebangsaan: "$kebangsaan", merk: "$merk" },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        {
          $group: {
            _id: "$_id.kebangsaan",
            topBrand: { $first: "$_id.merk" },
            topCount: { $first: "$count" },
            brands: { $push: { merk: "$_id.merk", count: "$count" } },
          },
        },
        { $sort: { topCount: -1 } },
        { $limit: 10 },
      ]),
      // Brand by office
      ImeiDetail.aggregate([
        { $match: { kode_kantor: { $ne: "" } } },
        {
          $group: {
            _id: { kantor: "$kode_kantor", merk: "$merk" },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        {
          $group: {
            _id: "$_id.kantor",
            topBrand: { $first: "$_id.merk" },
            total: { $sum: "$count" },
            brands: { $push: { merk: "$_id.merk", count: "$count" } },
          },
        },
        { $sort: { total: -1 } },
        { $limit: 10 },
      ]),
    ]);

    res.json({
      success: true,
      brandAnalysis,
      modelRanking,
      brandPricing,
      brandByNationality,
      brandByOffice,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// 6. GET /anomalies — Device-level anomaly detection
// ============================================================
router.get("/anomalies", async (req, res) => {
  try {
    const [
      duplicateImei,
      highValueDevices,
      bulkImporters,
      undervalued,
      suspiciousMultiDevice,
    ] = await Promise.all([
      // 1. Same IMEI on different passports (potential resale/fraud)
      ImeiDetail.aggregate([
        { $match: { imei1: { $ne: "", $exists: true } } },
        {
          $group: {
            _id: "$imei1",
            passports: { $addToSet: "$no_identitas" },
            count: { $sum: 1 },
            names: { $addToSet: "$nama" },
          },
        },
        { $match: { $expr: { $gt: [{ $size: "$passports" }, 1] } } },
        { $sort: { count: -1 } },
        { $limit: 50 },
        {
          $project: {
            imei: "$_id",
            passports: 1,
            names: 1,
            count: 1,
            _id: 0,
            type: { $literal: "DUPLICATE_IMEI" },
            severity: { $literal: "CRITICAL" },
          },
        },
      ]),
      // 2. Unusually high-value devices (>$1000 FOB)
      ImeiDetail.find({ harga_fob_usd: { $gt: 1000 } })
        .sort({ harga_fob_usd: -1 })
        .limit(50)
        .select(
          "nama no_identitas merk tipe harga_fob_usd imei1 flight_voyage waktu_kedatangan cara_pembayaran kode_kantor",
        )
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            ...d,
            type: "HIGH_VALUE_DEVICE",
            severity: d.harga_fob_usd > 2000 ? "HIGH" : "MEDIUM",
          })),
        ),
      // 3. Bulk importers (5+ devices on single passport)
      ImeiDetail.aggregate([
        {
          $group: {
            _id: "$no_identitas",
            nama: { $first: "$nama" },
            kebangsaan: { $first: "$kebangsaan" },
            devices: { $sum: 1 },
            totalValue: { $sum: "$harga_fob_usd" },
            brands: { $addToSet: "$merk" },
          },
        },
        { $match: { devices: { $gte: 5 } } },
        { $sort: { devices: -1 } },
        { $limit: 50 },
        {
          $project: {
            passport: "$_id",
            nama: 1,
            kebangsaan: 1,
            devices: 1,
            totalValue: 1,
            brands: 1,
            _id: 0,
            type: { $literal: "BULK_IMPORTER" },
            severity: { $literal: "HIGH" },
          },
        },
      ]),
      // 4. Potentially undervalued devices (Apple/Samsung with FOB < $50)
      ImeiDetail.find({
        merk: { $in: ["APPLE", "SAMSUNG"] },
        harga_fob_usd: { $gt: 0, $lt: 50 },
      })
        .sort({ harga_fob_usd: 1 })
        .limit(50)
        .select(
          "nama no_identitas merk tipe storage harga_fob_usd imei1 flight_voyage waktu_kedatangan kode_kantor",
        )
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            ...d,
            type: "UNDERVALUED_DEVICE",
            severity: "HIGH",
            note: `${d.merk} ${d.tipe} declared at $${d.harga_fob_usd} — potential under-declaration`,
          })),
        ),
      // 5. Suspicious multi-device registrations (3+ devices, same registration)
      ImeiDetail.aggregate([
        {
          $group: {
            _id: "$registration_id",
            nama: { $first: "$nama" },
            passport: { $first: "$no_identitas" },
            deviceCount: { $sum: 1 },
            devices: {
              $push: { merk: "$merk", tipe: "$tipe", fob: "$harga_fob_usd" },
            },
            totalValue: { $sum: "$harga_fob_usd" },
          },
        },
        { $match: { deviceCount: { $gte: 3 } } },
        { $sort: { deviceCount: -1 } },
        { $limit: 30 },
        {
          $project: {
            registration_id: "$_id",
            nama: 1,
            passport: 1,
            deviceCount: 1,
            devices: 1,
            totalValue: 1,
            _id: 0,
            type: { $literal: "MULTI_DEVICE_SINGLE_REG" },
            severity: { $literal: "MEDIUM" },
          },
        },
      ]),
    ]);

    const allAnomalies = [
      ...duplicateImei,
      ...highValueDevices.slice(0, 20),
      ...bulkImporters,
      ...undervalued.slice(0, 20),
      ...suspiciousMultiDevice,
    ];

    res.json({
      success: true,
      summary: {
        totalAnomalies: allAnomalies.length,
        duplicateImei: duplicateImei.length,
        highValueDevices: highValueDevices.length,
        bulkImporters: bulkImporters.length,
        undervalued: undervalued.length,
        suspiciousMultiDevice: suspiciousMultiDevice.length,
      },
      anomalies: {
        duplicateImei,
        highValueDevices: highValueDevices.slice(0, 20),
        bulkImporters,
        undervalued: undervalued.slice(0, 20),
        suspiciousMultiDevice,
      },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// 7. GET /top-devices — Most popular device models
// ============================================================
router.get("/top-devices", async (req, res) => {
  try {
    const { limit = 30 } = req.query;
    const topDevices = await ImeiDetail.aggregate([
      {
        $group: {
          _id: { merk: "$merk", tipe: "$tipe", storage: "$storage_normalized" },
          count: { $sum: 1 },
          avgFob: { $avg: "$harga_fob_usd" },
          maxFob: { $max: "$harga_fob_usd" },
          totalPungutan: { $sum: "$total_pungutan" },
          nationalities: { $addToSet: "$kebangsaan" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: parseInt(limit) },
    ]);

    res.json({ success: true, total: topDevices.length, devices: topDevices });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// 8. GET /price-analysis — Pricing & valuation intelligence
// ============================================================
router.get("/price-analysis", async (req, res) => {
  try {
    const [priceRanges, priceTrend, taxEfficiency, topTaxPayers] =
      await Promise.all([
        // Price range distribution
        ImeiDetail.aggregate([
          {
            $bucket: {
              groupBy: "$harga_fob_usd",
              boundaries: [
                0, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 99999,
              ],
              default: "Other",
              output: {
                count: { $sum: 1 },
                avgPungutan: { $avg: "$total_pungutan" },
                brands: { $addToSet: "$merk" },
              },
            },
          },
        ]),
        // Price trend over time (avg FOB per day)
        ImeiDetail.aggregate([
          {
            $match: {
              waktu_kedatangan: { $ne: null },
              harga_fob_usd: { $gt: 0 },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$waktu_kedatangan",
                },
              },
              avgFob: { $avg: "$harga_fob_usd" },
              devices: { $sum: 1 },
              totalValue: { $sum: "$harga_fob_usd" },
            },
          },
          { $sort: { _id: -1 } },
          { $limit: 30 },
        ]),
        // Tax efficiency (ratio of pungutan to CIF)
        ImeiDetail.aggregate([
          { $match: { total_cif_usd: { $gt: 0 } } },
          {
            $group: {
              _id: "$cara_pembayaran",
              avgCif: { $avg: "$total_cif_usd" },
              avgPungutan: { $avg: "$total_pungutan" },
              count: { $sum: 1 },
              totalCif: { $sum: "$total_cif_usd" },
              totalPungutan: { $sum: "$total_pungutan" },
            },
          },
        ]),
        // Top tax payers
        ImeiDetail.aggregate([
          { $match: { total_pungutan: { $gt: 0 } } },
          {
            $group: {
              _id: "$no_identitas",
              nama: { $first: "$nama" },
              kebangsaan: { $first: "$kebangsaan" },
              devices: { $sum: 1 },
              totalPungutan: { $sum: "$total_pungutan" },
              brands: { $addToSet: "$merk" },
            },
          },
          { $sort: { totalPungutan: -1 } },
          { $limit: 20 },
        ]),
      ]);

    res.json({
      success: true,
      priceRanges,
      priceTrend,
      taxEfficiency,
      topTaxPayers,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// 9. GET /penetapan-sejenis — Referensi FOB dari penetapan petugas BC lain
//    Membantu petugas menentukan harga FOB yang wajar berdasarkan
//    penetapan nyata petugas lain untuk tipe HP yang sama.
//
//    Query: merk, tipe, storage (opsional), limit, date_from, date_to, kantor
// ============================================================
router.get("/penetapan-sejenis", async (req, res) => {
  const { getKantorName } = require("../utils/constants");
  try {
    const { merk, tipe, storage, limit = 100, date_from, date_to, kantor } = req.query;

    if (!merk || !tipe) {
      return res.status(400).json({
        status: "error",
        message: "Parameter merk dan tipe wajib diisi",
      });
    }

    const filter = {
      merk: new RegExp(escapeRegex(merk.trim()), "i"),
      tipe: new RegExp(escapeRegex(tipe.trim()), "i"),
      harga_fob_usd: { $gt: 0 },
    };
    if (storage) filter.storage = new RegExp(escapeRegex(storage.trim()), "i");
    if (kantor) filter.kode_kantor = kantor;
    if (date_from || date_to) {
      filter.tgl_dokumen = {};
      if (date_from) filter.tgl_dokumen.$gte = new Date(date_from);
      if (date_to) filter.tgl_dokumen.$lte = new Date(date_to + "T23:59:59Z");
    }

    const cap = Math.min(200, Math.max(1, parseInt(limit) || 100));

    // Parallel: daftar penetapan terbaru + statistik agregat
    const [recent, aggStats, byKantor, byStorage] = await Promise.all([
      // 50 penetapan terbaru
      ImeiDetail.find(filter)
        .select("tgl_dokumen harga_fob_usd storage cara_pembayaran kode_kantor no_dokumen merk tipe nama bekas waktu_kedatangan")
        .sort({ tgl_dokumen: -1 })
        .limit(cap)
        .lean(),

      // Statistik global (count, avg, min, max, sum)
      ImeiDetail.aggregate([
        { $match: { ...filter } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            avg_fob: { $avg: "$harga_fob_usd" },
            min_fob: { $min: "$harga_fob_usd" },
            max_fob: { $max: "$harga_fob_usd" },
            billing_count: {
              $sum: { $cond: [{ $eq: ["$cara_pembayaran", "BILLING"] }, 1, 0] },
            },
            pembebasan_count: {
              $sum: { $cond: [{ $eq: ["$cara_pembayaran", "PEMBEBASAN"] }, 1, 0] },
            },
          },
        },
      ]),

      // Breakdown per kantor
      ImeiDetail.aggregate([
        { $match: { ...filter } },
        {
          $group: {
            _id: "$kode_kantor",
            count: { $sum: 1 },
            avg_fob: { $avg: "$harga_fob_usd" },
            billing: {
              $sum: { $cond: [{ $eq: ["$cara_pembayaran", "BILLING"] }, 1, 0] },
            },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),

      // Breakdown per storage (jika tidak difilter)
      !storage
        ? ImeiDetail.aggregate([
            { $match: { ...filter } },
            {
              $group: {
                _id: "$storage",
                count: { $sum: 1 },
                avg_fob: { $avg: "$harga_fob_usd" },
                min_fob: { $min: "$harga_fob_usd" },
                max_fob: { $max: "$harga_fob_usd" },
              },
            },
            { $sort: { avg_fob: 1 } },
          ])
        : Promise.resolve([]),
    ]);

    // Hitung persentil median (approx: median dari recent 100 data)
    const fobValues = recent.map((r) => r.harga_fob_usd).filter(Boolean).sort((a, b) => a - b);
    const mid = Math.floor(fobValues.length / 2);
    const median_fob = fobValues.length > 0
      ? fobValues.length % 2 === 0
        ? (fobValues[mid - 1] + fobValues[mid]) / 2
        : fobValues[mid]
      : 0;

    const stat = aggStats[0] || {};

    // Distribusi FOB (bucket per $50)
    const distribution = {};
    fobValues.forEach((v) => {
      const bucket = Math.floor(v / 50) * 50;
      const key = `$${bucket}-$${bucket + 50}`;
      distribution[key] = (distribution[key] || 0) + 1;
    });

    res.json({
      status: "ok",
      query: { merk: merk.toUpperCase(), tipe: tipe.toUpperCase(), storage: storage || null },
      stats: {
        count: stat.count || 0,
        avg_fob_usd: stat.avg_fob ? Math.round(stat.avg_fob * 100) / 100 : 0,
        median_fob_usd: Math.round(median_fob * 100) / 100,
        min_fob_usd: stat.min_fob || 0,
        max_fob_usd: stat.max_fob || 0,
        billing_count: stat.billing_count || 0,
        pembebasan_count: stat.pembebasan_count || 0,
      },
      by_kantor: byKantor.map((k) => ({
        kode: k._id,
        nama: getKantorName(k._id),
        count: k.count,
        avg_fob: Math.round(k.avg_fob * 100) / 100,
        billing: k.billing,
      })),
      by_storage: byStorage.map((s) => ({
        storage: s._id || "-",
        count: s.count,
        avg_fob: Math.round(s.avg_fob * 100) / 100,
        min_fob: s.min_fob,
        max_fob: s.max_fob,
      })),
      distribution: Object.entries(distribution)
        .sort((a, b) => {
          const aVal = parseInt(a[0].replace("$", ""));
          const bVal = parseInt(b[0].replace("$", ""));
          return aVal - bVal;
        })
        .map(([range, count]) => ({ range, count })),
      recent: recent.map((r) => ({
        tgl_dokumen: r.tgl_dokumen,
        harga_fob_usd: r.harga_fob_usd,
        storage: r.storage,
        cara_pembayaran: r.cara_pembayaran,
        kode_kantor: r.kode_kantor,
        kantor_nama: getKantorName(r.kode_kantor),
        no_dokumen: r.no_dokumen,
        bekas: r.bekas,
      })),
    });
  } catch (err) {
    console.error("[PENETAPAN SEJENIS]", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

module.exports = router;
