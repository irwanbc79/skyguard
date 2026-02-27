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

// Kantor mapping — Sumber: pakgiman.com/kantor-bea-dan-cukai/
const KANTOR_MAP = {
  // === KPU BC ===
  "040300": "KPU Tanjung Priok",
  "020400": "KPU Batam",
  "050100": "KPU Soekarno-Hatta",
  // === Kanwil ===
  "010000": "Kanwil Sumatera Utara",
  "020000": "Kanwil Kepulauan Riau",
  "030000": "Kanwil Sumatera Bag. Timur",
  "040000": "Kanwil Jakarta",
  "050000": "Kanwil Jawa Barat",
  "060000": "Kanwil Jateng & DIY",
  "070000": "Kanwil Jawa Timur I",
  "080000": "Kanwil Bali, NTB & NTT",
  "090000": "Kanwil Kalimantan Bag. Barat",
  100000: "Kanwil Kalimantan Bag. Timur",
  110000: "Kanwil Sulawesi Bag. Selatan",
  120000: "Kanwil Maluku",
  130000: "Kanwil Aceh",
  140000: "Kanwil Riau",
  150000: "Kanwil Banten",
  160000: "Kanwil Jawa Timur II",
  170000: "Kanwil Sumatera Bag. Barat",
  180000: "Kanwil Kalimantan Bag. Selatan",
  190000: "Kanwil Sulawesi Bag. Utara",
  200000: "Kanwil Papua",
  // === KPPBC Sumatera Utara ===
  "010100": "Kuala Namu",
  "010700": "Belawan",
  "010800": "Medan",
  "011000": "Pematangsiantar",
  "011100": "Teluk Nibung",
  "011200": "Kuala Tanjung",
  "011300": "Sibolga",
  "011500": "Teluk Bayur",
  // === KPPBC Kepulauan Riau & Riau ===
  "020100": "Tanjung Balai Karimun",
  "020500": "Tanjung Pinang",
  "020900": "Dumai",
  "021100": "Bengkalis",
  "021200": "Pekanbaru",
  "021500": "Tembilahan",
  // === KPPBC Sumatera Bag. Timur ===
  "030100": "Palembang",
  "030200": "Bengkulu",
  "030300": "Pangkal Pinang",
  "030500": "Tanjung Pandan",
  "030600": "Jambi",
  "030700": "Bandar Lampung",
  // === KPPBC Jakarta ===
  "040400": "Jakarta",
  "040600": "Kantor Pos Pasar Baru",
  // === KPPBC Jawa Barat ===
  "050300": "Bogor",
  "050400": "Merak",
  "050500": "Bandung",
  "050600": "Tasikmalaya",
  "050700": "Cirebon",
  "050800": "Purwakarta",
  "050900": "Bekasi",
  "051000": "Cikarang",
  // === KPPBC Jateng & DIY ===
  "060100": "Tanjung Emas",
  "060300": "Kudus",
  "060400": "Cilacap",
  "060600": "Surakarta",
  "060700": "Yogyakarta",
  "060800": "Semarang",
  "061000": "Tegal",
  "061100": "Magelang",
  "062000": "Purwokerto",
  // === KPPBC Jawa Timur I ===
  "070100": "Tanjung Perak",
  "070200": "Madura",
  "070300": "Gresik",
  "070400": "Bojonegoro",
  "070500": "Juanda",
  "070600": "Malang",
  "070700": "Blitar",
  "070800": "Kediri",
  "071000": "Madiun",
  "071100": "Jember",
  "071200": "Probolinggo",
  "071300": "Pasuruan",
  "071500": "Sidoarjo",
  // === KPPBC Bali, NTB & NTT ===
  "080100": "Ngurah Rai",
  "080200": "Denpasar",
  "080300": "Mataram",
  "080400": "Sumbawa",
  "080500": "Kupang",
  "080700": "Maumere",
  "081400": "Atambua",
  // === KPPBC Kalimantan Bag. Barat ===
  "090100": "Pontianak",
  "090200": "Entikong",
  "090400": "Ketapang",
  "090500": "Sintete",
  "090700": "Sampit",
  "090800": "Pangkalan Bun",
  "090900": "Pulang Pisau",
  "091000": "Nanga Badau",
  "092000": "Jagoi Babang",
  // === KPPBC Kalimantan Bag. Timur & Selatan ===
  100100: "Banjarmasin",
  100200: "Kotabaru",
  100300: "Balikpapan",
  100500: "Samarinda",
  100600: "Bontang",
  100800: "Tarakan",
  100900: "Nunukan",
  101000: "Sangata",
  // === KPPBC Sulawesi ===
  110100: "Makassar",
  110300: "Parepare",
  110400: "Malili",
  110600: "Kendari",
  110800: "Pantoloan",
  110900: "Morowali",
  111000: "Luwuk",
  111100: "Bitung",
  111200: "Manado",
  111300: "Gorontalo",
  // === KPPBC Maluku & Papua ===
  120100: "Ambon",
  120200: "Ternate",
  120300: "Sorong",
  120400: "Manokwari",
  120600: "Jayapura",
  120700: "Merauke",
  120800: "Amamapare",
  120900: "Biak",
  121000: "Tual",
  122300: "Babo",
  // === KPPBC Aceh ===
  130100: "Banda Aceh",
  130300: "Sabang",
  130400: "Meulaboh",
  130500: "Lhokseumawe",
  130600: "Kuala Langsa",
  // === KPPBC Banten & Jatim II ===
  150300: "Tangerang",
  160200: "Marunda",
  160700: "Banyuwangi",
  // === PSO BC ===
  "021900": "PSO Tanjung Balai Karimun",
  "021800": "PSO Batam",
  "040700": "PSO Tanjung Priok",
  111400: "PSO Pantoloan",
  121100: "PSO Sorong",
  // === BLBC ===
  "040500": "Lab BC Jakarta",
  "011600": "Lab BC Medan",
  "071400": "Lab BC Surabaya",
};

function getKantorName(code) {
  return KANTOR_MAP[code] || `Kantor ${code}`;
}

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

    // Search both collections in parallel
    const [regData, detData] = await Promise.all([
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
    ]);

    // Merge results, preferring detail data for overlapping no_dok
    const detNoDoks = new Set(detData.map((d) => d.no_dokumen));
    const regFiltered = regData.filter((r) => !detNoDoks.has(r.no_dok));

    const merged = [
      ...detData.map((d) => ({
        ...d,
        _source: "detail",
        kantor_nama: getKantorName(d.kode_kantor),
      })),
      ...regFiltered.map((d) => ({
        ...d,
        _source: "registration",
        kantor_nama: getKantorName(d.kode_kantor),
      })),
    ].slice(0, parseInt(limit));

    res.json({
      status: "ok",
      data: merged,
      total: merged.length,
      sources: {
        fromRegistration: regFiltered.length,
        fromDetail: detData.length,
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
