/**
 * IMEI Data Integrity & Consistency Routes
 *
 * Cross-validates data between ImeiRegistration (CSV) and ImeiDetail (Scraper)
 * Ensures accuracy, validity, and consistency across both data sources.
 *
 * Endpoints:
 *   GET  /api/imei-integrity/quality        - Data quality dashboard
 *   GET  /api/imei-integrity/overlap         - Overlap analysis between collections
 *   GET  /api/imei-integrity/unified-stats   - Combined statistics from both sources
 *   GET  /api/imei-integrity/validate/:noDok - Validate a specific registration
 *   GET  /api/imei-integrity/discrepancies   - Find data mismatches in overlap zone
 */
const express = require("express");
const router = express.Router();
const ImeiRegistration = require("../models/ImeiRegistration");
const ImeiDetail = require("../models/ImeiDetail");
const ScraperSession = require("../models/ScraperSession");

// ============================================================
// 1. GET /quality — Data Quality Dashboard
// ============================================================
router.get("/quality", async (req, res) => {
  try {
    const [
      regCount,
      detCount,
      regDateRange,
      detDateRange,
      regUniquePassports,
      detUniquePassports,
      regBySource,
      detBySource,
      latestSession,
      detUniqueRegistrations,
    ] = await Promise.all([
      ImeiRegistration.countDocuments(),
      ImeiDetail.countDocuments(),
      ImeiRegistration.aggregate([
        {
          $group: {
            _id: null,
            earliest: { $min: "$tgl_kedatangan" },
            latest: { $max: "$tgl_kedatangan" },
          },
        },
      ]),
      ImeiDetail.aggregate([
        {
          $group: {
            _id: null,
            earliest: { $min: "$waktu_kedatangan" },
            latest: { $max: "$waktu_kedatangan" },
          },
        },
      ]),
      ImeiRegistration.distinct("no_identitas").then((a) => a.length),
      ImeiDetail.distinct("no_identitas").then((a) => a.length),
      ImeiRegistration.aggregate([
        { $group: { _id: "$source_file", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      ImeiDetail.aggregate([
        { $group: { _id: "$source_file", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      ScraperSession.findOne().sort({ createdAt: -1 }).lean(),
      ImeiDetail.distinct("registration_id").then((a) => a.length),
    ]);

    // Calculate overlap (no_dok ↔ no_dokumen)
    const regDoks = await ImeiRegistration.distinct("no_dok");
    const detDoks = await ImeiDetail.distinct("no_dokumen");
    const regSet = new Set(regDoks);
    const detSet = new Set(detDoks);
    let overlapCount = 0;
    for (const d of detDoks) {
      if (regSet.has(d)) overlapCount++;
    }
    const onlyInReg = regDoks.length - overlapCount;
    const onlyInDet = detDoks.length - overlapCount;
    const combinedUnique = regDoks.length + onlyInDet;

    // Data completeness scoring
    const completeness = {
      imeiRegistration: {
        hasPassport: await ImeiRegistration.countDocuments({
          no_identitas: { $ne: "" },
        }),
        hasVessel: await ImeiRegistration.countDocuments({
          vessel: { $ne: "" },
        }),
        hasPungutan: await ImeiRegistration.countDocuments({
          total_pungutan: { $gt: 0 },
        }),
      },
      imeiDetail: {
        hasImei: await ImeiDetail.countDocuments({ imei1: { $ne: "" } }),
        hasBrand: await ImeiDetail.countDocuments({ merk: { $ne: "" } }),
        hasPrice: await ImeiDetail.countDocuments({
          harga_fob_usd: { $gt: 0 },
        }),
        hasHsCode: await ImeiDetail.countDocuments({ hs_code: { $ne: "" } }),
      },
    };

    // Scraper progress
    const scraperProgress = latestSession
      ? {
          sessionId: latestSession.sessionId,
          status: latestSession.status,
          lastPage: latestSession.lastPage,
          totalPages: latestSession.totalPages,
          progress: latestSession.totalPages
            ? (
                ((latestSession.lastPage || 0) / latestSession.totalPages) *
                100
              ).toFixed(1) + "%"
            : "N/A",
          totalRecords: latestSession.totalRecords,
          errors: latestSession.errors,
          startedAt: latestSession.createdAt,
          updatedAt: latestSession.updatedAt,
        }
      : null;

    res.json({
      status: "ok",
      quality: {
        collections: {
          imeiRegistration: {
            documents: regCount,
            uniqueNoDok: regDoks.length,
            uniquePassports: regUniquePassports,
            dateRange: regDateRange[0] || {},
            sources: regBySource,
            description:
              "Data CSV — registrasi per orang (1 baris = 1 registrasi)",
          },
          imeiDetail: {
            documents: detCount,
            uniqueNoDok: detDoks.length,
            uniqueRegistrations: detUniqueRegistrations,
            uniquePassports: detUniquePassports,
            dateRange: detDateRange[0] || {},
            sources: detBySource,
            description:
              "Data Scraper — detail per perangkat (1 registrasi bisa punya banyak devices)",
          },
        },
        overlap: {
          sharedNoDok: overlapCount,
          onlyInRegistration: onlyInReg,
          onlyInDetail: onlyInDet,
          combinedUniqueRegistrations: combinedUnique,
          coveragePercent:
            ((overlapCount / regDoks.length) * 100).toFixed(1) + "%",
          description: `Dari ${regDoks.length} registrasi CSV, ${overlapCount} (${((overlapCount / regDoks.length) * 100).toFixed(1)}%) sudah ada detail device-nya. ${onlyInDet} registrasi baru ditemukan dari scraper.`,
        },
        completeness,
        scraperProgress,
        recommendations: generateRecommendations(
          regCount,
          detCount,
          overlapCount,
          regDoks.length,
          detDoks.length,
          scraperProgress,
        ),
      },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// 2. GET /overlap — Detailed overlap analysis
// ============================================================
router.get("/overlap", async (req, res) => {
  try {
    const { page = 1, limit = 50, status = "all" } = req.query;

    // Get all no_dokumen from ImeiDetail (grouped by registration)
    const detRegistrations = await ImeiDetail.aggregate([
      {
        $group: {
          _id: "$no_dokumen",
          registration_id: { $first: "$registration_id" },
          deviceCount: { $sum: 1 },
          totalFobUsd: { $sum: "$harga_fob_usd" },
          totalPungutan: { $sum: "$total_pungutan" },
          brands: { $addToSet: "$merk" },
          nama: { $first: "$nama" },
          no_identitas: { $first: "$no_identitas" },
          waktu_kedatangan: { $first: "$waktu_kedatangan" },
        },
      },
      { $sort: { waktu_kedatangan: -1 } },
    ]);

    const detMap = new Map();
    for (const d of detRegistrations) {
      detMap.set(d._id, d);
    }

    // Get corresponding ImeiRegistration records
    const regDoks = await ImeiRegistration.distinct("no_dok");
    const regSet = new Set(regDoks);

    // Build overlap detail
    const results = [];
    for (const [noDok, detail] of detMap) {
      const hasReg = regSet.has(noDok);
      if (status === "overlap" && !hasReg) continue;
      if (status === "detail-only" && hasReg) continue;

      results.push({
        no_dokumen: noDok,
        existsInRegistration: hasReg,
        existsInDetail: true,
        detail: {
          registration_id: detail.registration_id,
          deviceCount: detail.deviceCount,
          totalFobUsd: detail.totalFobUsd,
          totalPungutan: detail.totalPungutan,
          brands: detail.brands,
          nama: detail.nama,
          no_identitas: detail.no_identitas,
        },
      });
    }

    // Add registration-only records
    if (status === "all" || status === "reg-only") {
      for (const noDok of regDoks) {
        if (!detMap.has(noDok)) {
          results.push({
            no_dokumen: noDok,
            existsInRegistration: true,
            existsInDetail: false,
            detail: null,
          });
        }
      }
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const paged = results.slice(offset, offset + parseInt(limit));

    res.json({
      status: "ok",
      total: results.length,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(results.length / parseInt(limit)),
      },
      data: paged,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// 3. GET /unified-stats — Combined analytics from both sources
// ============================================================
router.get("/unified-stats", async (req, res) => {
  try {
    // Use $unionWith to merge both collections, deduplicate by no_dokumen
    const unified = await ImeiDetail.aggregate([
      // Start with ImeiDetail (richer data)
      {
        $group: {
          _id: "$no_dokumen",
          source: { $first: { $literal: "detail" } },
          nama: { $first: "$nama" },
          no_identitas: { $first: "$no_identitas" },
          kebangsaan: { $first: "$kebangsaan" },
          kode_kantor: { $first: "$kode_kantor" },
          flight: { $first: "$flight_voyage" },
          waktu_kedatangan: { $first: "$waktu_kedatangan" },
          deviceCount: { $sum: 1 },
          totalFobUsd: { $sum: "$harga_fob_usd" },
          totalPungutan: { $sum: "$total_pungutan" },
          cara_pembayaran: { $first: "$cara_pembayaran" },
          tgl_dokumen: { $first: "$tgl_dokumen" },
        },
      },
      // Union with ImeiRegistration
      {
        $unionWith: {
          coll: "imeiregistrations",
          pipeline: [
            {
              $group: {
                _id: "$no_dok",
                source: { $first: { $literal: "registration" } },
                nama: { $first: "$nama" },
                no_identitas: { $first: "$no_identitas" },
                kebangsaan: { $first: "$kebangsaan" },
                kode_kantor: { $first: "$kode_kantor" },
                flight: { $first: "$vessel" },
                waktu_kedatangan: { $first: "$tgl_kedatangan" },
                deviceCount: { $first: { $literal: 0 } },
                totalFobUsd: { $first: { $literal: 0 } },
                totalPungutan: { $sum: "$total_pungutan" },
                cara_pembayaran: { $first: "$status_pembayaran" },
                tgl_dokumen: { $first: "$tgl_dok" },
              },
            },
          ],
        },
      },
      // Deduplicate: prefer "detail" source over "registration"
      { $sort: { source: 1 } }, // "detail" before "registration"
      {
        $group: {
          _id: "$_id",
          source: { $first: "$source" },
          nama: { $first: "$nama" },
          no_identitas: { $first: "$no_identitas" },
          kebangsaan: { $first: "$kebangsaan" },
          kode_kantor: { $first: "$kode_kantor" },
          flight: { $first: "$flight" },
          waktu_kedatangan: { $first: "$waktu_kedatangan" },
          deviceCount: { $first: "$deviceCount" },
          totalFobUsd: { $first: "$totalFobUsd" },
          totalPungutan: { $first: "$totalPungutan" },
          cara_pembayaran: { $first: "$cara_pembayaran" },
          tgl_dokumen: { $first: "$tgl_dokumen" },
        },
      },
      // Final aggregations
      {
        $facet: {
          overview: [
            {
              $group: {
                _id: null,
                totalRegistrations: { $sum: 1 },
                totalPungutan: { $sum: "$totalPungutan" },
                totalFobUsd: { $sum: "$totalFobUsd" },
                uniquePassports: { $addToSet: "$no_identitas" },
                uniqueFlights: { $addToSet: "$flight" },
                uniqueOffices: { $addToSet: "$kode_kantor" },
                earliest: { $min: "$waktu_kedatangan" },
                latest: { $max: "$waktu_kedatangan" },
                fromDetail: {
                  $sum: { $cond: [{ $eq: ["$source", "detail"] }, 1, 0] },
                },
                fromRegistration: {
                  $sum: {
                    $cond: [{ $eq: ["$source", "registration"] }, 1, 0],
                  },
                },
                withDevices: {
                  $sum: { $cond: [{ $gt: ["$deviceCount", 0] }, 1, 0] },
                },
              },
            },
            {
              $project: {
                totalRegistrations: 1,
                totalPungutan: 1,
                totalFobUsd: 1,
                uniquePassports: { $size: "$uniquePassports" },
                uniqueFlights: { $size: "$uniqueFlights" },
                uniqueOffices: { $size: "$uniqueOffices" },
                earliest: 1,
                latest: 1,
                fromDetail: 1,
                fromRegistration: 1,
                withDevices: 1,
              },
            },
          ],
          byNationality: [
            { $group: { _id: "$kebangsaan", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 15 },
          ],
          byPayment: [
            {
              $group: {
                _id: "$cara_pembayaran",
                count: { $sum: 1 },
                totalPungutan: { $sum: "$totalPungutan" },
              },
            },
            { $sort: { count: -1 } },
          ],
          byOffice: [
            {
              $group: {
                _id: "$kode_kantor",
                count: { $sum: 1 },
                totalPungutan: { $sum: "$totalPungutan" },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 20 },
          ],
          dailyTrend: [
            { $match: { waktu_kedatangan: { $ne: null } } },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$waktu_kedatangan",
                  },
                },
                count: { $sum: 1 },
                totalPungutan: { $sum: "$totalPungutan" },
              },
            },
            { $sort: { _id: -1 } },
            { $limit: 30 },
          ],
        },
      },
    ]);

    const result = unified[0];

    res.json({
      status: "ok",
      description:
        "Statistik gabungan dari kedua koleksi (ImeiRegistration + ImeiDetail), dideduplikasi berdasarkan no_dokumen. Data ImeiDetail diprioritaskan karena lebih lengkap.",
      unified: {
        overview: result.overview[0] || {},
        byNationality: result.byNationality,
        byPayment: result.byPayment,
        byOffice: result.byOffice,
        dailyTrend: result.dailyTrend,
      },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// 4. GET /validate/:noDok — Validate a specific registration
// ============================================================
router.get("/validate/:noDok", async (req, res) => {
  try {
    const noDok = decodeURIComponent(req.params.noDok);

    const [regRecord, detRecords] = await Promise.all([
      ImeiRegistration.findOne({ no_dok: noDok }).lean(),
      ImeiDetail.find({ no_dokumen: noDok }).sort({ device_no: 1 }).lean(),
    ]);

    if (!regRecord && detRecords.length === 0) {
      return res.json({
        status: "ok",
        found: false,
        message: `No dokumen ${noDok} tidak ditemukan di kedua koleksi`,
      });
    }

    // Check consistency between sources
    const issues = [];
    if (regRecord && detRecords.length > 0) {
      const det = detRecords[0];
      // Compare common fields
      if (regRecord.nama !== det.nama) {
        issues.push({
          field: "nama",
          registration: regRecord.nama,
          detail: det.nama,
          severity: "warning",
        });
      }
      if (regRecord.no_identitas !== det.no_identitas) {
        issues.push({
          field: "no_identitas",
          registration: regRecord.no_identitas,
          detail: det.no_identitas,
          severity: "high",
        });
      }
      if (regRecord.kebangsaan !== det.kebangsaan) {
        issues.push({
          field: "kebangsaan",
          registration: regRecord.kebangsaan,
          detail: det.kebangsaan,
          severity: "medium",
        });
      }
      // Compare payment status
      const regStatus = regRecord.status_pembayaran;
      const detStatus = det.cara_pembayaran;
      if (regStatus !== detStatus) {
        issues.push({
          field: "status_pembayaran",
          registration: regStatus,
          detail: detStatus,
          severity: "warning",
        });
      }
    }

    res.json({
      status: "ok",
      found: true,
      noDokumen: noDok,
      sources: {
        inRegistration: !!regRecord,
        inDetail: detRecords.length > 0,
      },
      registration: regRecord || null,
      devices: detRecords,
      deviceCount: detRecords.length,
      dataConsistency: {
        issueCount: issues.length,
        issues,
        verdict:
          issues.length === 0
            ? "CONSISTENT"
            : issues.some((i) => i.severity === "high")
              ? "MISMATCH"
              : "MINOR_DIFFERENCES",
      },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// 5. GET /discrepancies — Find data mismatches in overlap zone
// ============================================================
router.get("/discrepancies", async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;

    // Get overlap records — registrations that exist in BOTH collections
    const detGrouped = await ImeiDetail.aggregate([
      {
        $group: {
          _id: "$no_dokumen",
          det_nama: { $first: "$nama" },
          det_passport: { $first: "$no_identitas" },
          det_kebangsaan: { $first: "$kebangsaan" },
          det_payment: { $first: "$cara_pembayaran" },
          det_total_pungutan: { $sum: "$total_pungutan" },
          det_devices: { $sum: 1 },
        },
      },
    ]);

    const detMap = new Map();
    for (const d of detGrouped) {
      detMap.set(d._id, d);
    }

    // Find all ImeiRegistration records that exist in ImeiDetail
    const noDoks = [...detMap.keys()];
    const regRecords = await ImeiRegistration.find({
      no_dok: { $in: noDoks },
    }).lean();

    const discrepancies = [];
    for (const reg of regRecords) {
      const det = detMap.get(reg.no_dok);
      if (!det) continue;

      const issues = [];
      if (reg.nama && det.det_nama && reg.nama !== det.det_nama) {
        issues.push({
          field: "nama",
          reg: reg.nama,
          det: det.det_nama,
        });
      }
      if (
        reg.no_identitas &&
        det.det_passport &&
        reg.no_identitas !== det.det_passport
      ) {
        issues.push({
          field: "no_identitas",
          reg: reg.no_identitas,
          det: det.det_passport,
        });
      }
      if (
        reg.kebangsaan &&
        det.det_kebangsaan &&
        reg.kebangsaan !== det.det_kebangsaan
      ) {
        issues.push({
          field: "kebangsaan",
          reg: reg.kebangsaan,
          det: det.det_kebangsaan,
        });
      }
      if (
        reg.status_pembayaran &&
        det.det_payment &&
        reg.status_pembayaran !== det.det_payment
      ) {
        issues.push({
          field: "status_pembayaran",
          reg: reg.status_pembayaran,
          det: det.det_payment,
        });
      }

      if (issues.length > 0) {
        discrepancies.push({
          no_dokumen: reg.no_dok,
          nama: reg.nama,
          issues,
        });
      }
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const paged = discrepancies.slice(offset, offset + parseInt(limit));

    res.json({
      status: "ok",
      summary: {
        totalOverlap: regRecords.length,
        withDiscrepancies: discrepancies.length,
        consistent: regRecords.length - discrepancies.length,
        consistencyRate:
          regRecords.length > 0
            ? (
                ((regRecords.length - discrepancies.length) /
                  regRecords.length) *
                100
              ).toFixed(1) + "%"
            : "N/A",
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: discrepancies.length,
        pages: Math.ceil(discrepancies.length / parseInt(limit)),
      },
      discrepancies: paged,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// Helper: Generate recommendations
// ============================================================
function generateRecommendations(
  regCount,
  detCount,
  overlapCount,
  regUnique,
  detUnique,
  scraperProgress,
) {
  const recs = [];

  const coveragePercent = (overlapCount / regUnique) * 100;
  if (coveragePercent < 50) {
    recs.push({
      priority: "HIGH",
      category: "coverage",
      message: `Baru ${coveragePercent.toFixed(1)}% registrasi CSV yang punya data device detail. Lanjutkan scraping CEISA untuk melengkapi.`,
    });
  }

  if (scraperProgress && scraperProgress.status === "running") {
    recs.push({
      priority: "INFO",
      category: "scraper",
      message: `Scraper aktif: ${scraperProgress.progress} selesai. Data detail akan terus bertambah.`,
    });
  }

  if (detUnique > regUnique) {
    const extra = detUnique - regUnique + overlapCount;
    recs.push({
      priority: "MEDIUM",
      category: "new_data",
      message: `${detUnique - overlapCount} registrasi ditemukan di scraper yang TIDAK ada di CSV. Ini data baru di luar periode CSV.`,
    });
  }

  if (detCount > 0 && regCount > 0) {
    const devicesPerReg = (detCount / detUnique).toFixed(1);
    recs.push({
      priority: "INFO",
      category: "enrichment",
      message: `Rata-rata ${devicesPerReg} device per registrasi. Data detail jauh lebih kaya (IMEI, merk, harga, pajak per device).`,
    });
  }

  recs.push({
    priority: "INFO",
    category: "strategy",
    message:
      "Strategi: ImeiDetail akan menjadi sumber utama setelah scraping selesai. ImeiRegistration tetap digunakan sebagai fallback untuk periode yang belum ter-scrape.",
  });

  return recs;
}

module.exports = router;
