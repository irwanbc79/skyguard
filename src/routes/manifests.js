const express = require("express");
const multer = require("multer");
const manifestController = require("../controllers/manifestController");
const Manifest = require("../models/Manifest");
const ManifestPassenger = require("../models/ManifestPassenger");

const ALLOWED_EXTENSIONS = [
  ".txt",
  ".csv",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const extension = (file.originalname || "").toLowerCase();
    const isAllowed = ALLOWED_EXTENSIONS.some((ext) => extension.endsWith(ext));
    if (!isAllowed) {
      return cb(new Error("Format file manifest tidak didukung."));
    }
    return cb(null, true);
  },
});

const router = express.Router();

router.get("/", manifestController.listManifests);

// MUST be before /:id to avoid param capture
router.get("/analytics/command-center", async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalManifests,
      todayManifests,
      last7dManifests,
      statusBreakdown,
      todayManifestsList,
      totalPassengers,
      todayPassengers,
      routeFrequency,
      airlineFrequency,
      sourceBreakdown,
      recentActivity,
      weeklyTrend,
      paxByStatus,
    ] = await Promise.all([
      Manifest.countDocuments(),
      Manifest.countDocuments({
        createdAt: { $gte: todayStart, $lt: todayEnd },
      }),
      Manifest.countDocuments({ createdAt: { $gte: last7d } }),
      Manifest.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Manifest.find({ createdAt: { $gte: todayStart, $lt: todayEnd } })
        .sort({ createdAt: -1 })
        .select(
          "flight_number origin destination flight_date carrier status source createdAt filename",
        )
        .lean(),
      ManifestPassenger.countDocuments(),
      ManifestPassenger.countDocuments({
        createdAt: { $gte: todayStart, $lt: todayEnd },
      }),
      Manifest.aggregate([
        { $match: { origin: { $ne: null }, destination: { $ne: null } } },
        {
          $group: {
            _id: { origin: "$origin", destination: "$destination" },
            count: { $sum: 1 },
            flights: { $addToSet: "$flight_number" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      Manifest.aggregate([
        { $match: { carrier: { $nin: [null, "", undefined] } } },
        { $group: { _id: "$carrier", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      Manifest.aggregate([{ $group: { _id: "$source", count: { $sum: 1 } } }]),
      Manifest.find()
        .sort({ createdAt: -1 })
        .limit(15)
        .select(
          "flight_number origin destination status createdAt carrier source flight_date filename",
        )
        .lean(),
      Manifest.aggregate([
        { $match: { createdAt: { $gte: last30d } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      ManifestPassenger.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const pipeline = {};
    statusBreakdown.forEach((s) => {
      pipeline[s._id] = s.count;
    });
    const sources = {};
    sourceBreakdown.forEach((s) => {
      sources[s._id] = s.count;
    });
    const paxStats = {};
    paxByStatus.forEach((s) => {
      paxStats[s._id] = s.count;
    });

    res.json({
      status: "ok",
      data: {
        kpi: {
          totalManifests,
          todayManifests,
          last7dManifests,
          totalPassengers,
          todayPassengers,
        },
        pipeline,
        sources,
        paxStats,
        todayManifestsList,
        routeFrequency,
        airlineFrequency,
        recentActivity,
        weeklyTrend,
      },
    });
  } catch (err) {
    console.error("[MANIFEST ANALYTICS]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// POST /api/manifests/bulk-reparse — re-parse ALL needs_review manifests
router.post("/bulk-reparse", async (req, res) => {
  try {
    const fs = require("fs");
    const {
      detectAndParseText,
      classifyByFilename,
    } = require("../services/manifestService");

    const manifests = await Manifest.find({ status: "needs_review" }).lean();
    const stats = {
      total: manifests.length,
      parsed: 0,
      classified: 0,
      failed: 0,
      noFile: 0,
    };
    const results = [];

    for (const m of manifests) {
      try {
        if (!m.file_path || !fs.existsSync(m.file_path)) {
          // Try filename classification even without file
          const docClass = classifyByFilename(m.filename);
          if (docClass) {
            await Manifest.updateOne(
              { _id: m._id },
              {
                status: "classified",
                parsing_notes: `Dokumen operasional: ${docClass}. Bukan manifest penumpang.`,
                parsed_fields: { format: docClass, doc_type: docClass },
              },
            );
            stats.classified++;
          } else {
            stats.noFile++;
          }
          continue;
        }

        let rawText = "";
        const ext = (m.file_type || "").toLowerCase();
        if (ext === "pdf") {
          try {
            const pdfParse = require("pdf-parse");
            const buffer = fs.readFileSync(m.file_path);
            const data = await pdfParse(buffer);
            rawText = data.text || "";
          } catch (e) {
            rawText = "";
          }
        } else if (ext === "docx") {
          try {
            const mammoth = require("mammoth");
            const buffer = fs.readFileSync(m.file_path);
            const result = await mammoth.extractRawText({ buffer });
            rawText = result.value || "";
          } catch (e) {
            rawText = "";
          }
        } else {
          rawText = fs.readFileSync(m.file_path, "utf-8");
        }

        const parsed = detectAndParseText(rawText, m.filename);
        if (parsed) {
          const paxCount =
            (parsed.passengers || []).length +
            (parsed.segments || []).reduce(
              (sum, seg) =>
                sum +
                (seg.passengers || []).length +
                (seg.no_shows || []).length,
              0,
            );
          await Manifest.updateOne(
            { _id: m._id },
            {
              status: "parsed",
              flight_number: parsed.flight_number || m.flight_number,
              flight_date: parsed.flight_date || m.flight_date,
              origin: parsed.origin || m.origin,
              destination: parsed.destination || m.destination,
              carrier: parsed.carrier || m.carrier,
              parsing_notes: `Bulk re-parse: format ${parsed.format}, ${paxCount} pax`,
              parsed_fields: {
                format: parsed.format,
                segments: parsed.segments || [],
                passengers: parsed.passengers || [],
                no_shows: parsed.no_shows || [],
              },
            },
          );
          stats.parsed++;
          results.push({
            id: m._id,
            filename: m.filename,
            format: parsed.format,
            pax: paxCount,
          });
        } else {
          // Try filename classification
          const docClass = classifyByFilename(m.filename);
          if (docClass) {
            await Manifest.updateOne(
              { _id: m._id },
              {
                status: "classified",
                parsing_notes: `Dokumen operasional: ${docClass}. Bukan manifest penumpang.`,
                parsed_fields: { format: docClass, doc_type: docClass },
              },
            );
            stats.classified++;
          } else {
            stats.failed++;
          }
        }
      } catch (err) {
        console.error(`[BULK REPARSE] Error on ${m.filename}:`, err.message);
        stats.failed++;
      }
    }

    res.json({
      status: "ok",
      message: `Bulk re-parse selesai: ${stats.parsed} parsed, ${stats.classified} classified, ${stats.failed} tetap needs_review`,
      stats,
      parsedSamples: results.slice(0, 20),
    });
  } catch (err) {
    console.error("[BULK REPARSE]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// POST /api/manifests/bulk-sync — sync ALL parsed manifests to ManifestPassenger collection
router.post("/bulk-sync", async (req, res) => {
  try {
    const manifests = await Manifest.find({
      status: "parsed",
      "parsed_fields.passengers.0": { $exists: true },
    }).lean();

    let totalSynced = 0;
    let totalPax = 0;
    let errors = 0;

    for (const m of manifests) {
      try {
        const parsed = m.parsed_fields || {};
        const format = parsed.format || "airasia_pax";
        const docs = [];

        const buildDoc = (p, defaultStatus, segIdx) => ({
          manifest_id: m._id,
          flight_number: m.flight_number,
          flight_date: m.flight_date,
          segment_index: segIdx,
          status: p.status || defaultStatus,
          name: p.name,
          level: p.level || null,
          pnr: p.pnr || null,
          fare_class: p.fare_class || null,
          seq_no: p.seq_no || null,
          travel_date: p.travel_date || null,
          seat_no: p.seat_no || null,
          destination_code: p.destination_code || null,
          flight_no: p.flight_no || null,
          raw_line: p.raw_line || null,
          passport_number: p.passport_number || null,
          nationality: p.nationality || null,
          gender: p.gender || null,
          date_of_birth: p.date_of_birth || null,
          passport_expiry: p.passport_expiry || null,
          doc_type: p.doc_type || null,
          bag_weight: p.bag_weight || null,
          ticket_number: p.ticket_number || null,
          pax_type: p.pax_type || null,
        });

        if (
          format === "apis" ||
          format === "lion_manifest" ||
          format === "enh_manifest" ||
          format === "baggage_list"
        ) {
          (parsed.passengers || []).forEach((p) =>
            docs.push(buildDoc(p, "checked_in", 0)),
          );
          (parsed.no_shows || []).forEach((p) =>
            docs.push(buildDoc(p, "no_show", 0)),
          );
        } else {
          (parsed.segments || []).forEach((seg, idx) => {
            (seg.passengers || []).forEach((p) =>
              docs.push(buildDoc(p, "checked_in", idx)),
            );
            (seg.no_shows || []).forEach((p) =>
              docs.push(buildDoc(p, "no_show", idx)),
            );
          });
        }

        if (docs.length) {
          await ManifestPassenger.deleteMany({ manifest_id: m._id });
          await ManifestPassenger.insertMany(docs);
          await Manifest.updateOne({ _id: m._id }, { status: "synced" });
          totalSynced++;
          totalPax += docs.length;
        }
      } catch (err) {
        console.error(`[BULK SYNC] Error on ${m.filename}:`, err.message);
        errors++;
      }
    }

    res.json({
      status: "ok",
      message: `Bulk sync selesai: ${totalSynced} manifests, ${totalPax} penumpang tersinkronkan`,
      stats: {
        manifests_synced: totalSynced,
        total_passengers: totalPax,
        errors,
      },
    });
  } catch (err) {
    console.error("[BULK SYNC]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==================== PASSPORT SEARCH (Booking/PNR Lookup) ====================
// MUST be before /:id to avoid param capture
// Cross-references: ManifestPassenger, ImeiDetail, ImeiRegistration, Passenger
router.get("/search/passport/:no", async (req, res) => {
  try {
    const passport = req.params.no.toUpperCase().trim();
    if (!passport || passport.length < 3) {
      return res
        .status(400)
        .json({ status: "error", message: "Nomor paspor minimal 3 karakter" });
    }

    const ImeiDetail = require("../models/ImeiDetail");
    const ImeiRegistration = require("../models/ImeiRegistration");
    const Passenger = require("../models/Passenger");

    const escapedPassport = passport.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const passportRegex = new RegExp("^" + escapedPassport + "$", "i");

    // Search ALL collections in parallel
    const [manifestPax, imeiDetails, imeiRegs, ceisaPax] = await Promise.all([
      ManifestPassenger.find({ passport_number: passportRegex })
        .sort({ flight_date: -1 })
        .lean(),
      ImeiDetail.find({ no_identitas: passportRegex })
        .sort({ waktu_kedatangan: -1 })
        .lean(),
      ImeiRegistration.find({ no_identitas: passportRegex })
        .sort({ tgl_kedatangan: -1 })
        .lean(),
      Passenger.find({ paspor: passportRegex }).sort({ createdAt: -1 }).lean(),
    ]);

    const totalFound =
      manifestPax.length +
      imeiDetails.length +
      imeiRegs.length +
      ceisaPax.length;

    if (!totalFound) {
      return res.json({
        status: "ok",
        data: { passport, records: [], total: 0 },
      });
    }

    // Get manifest flight info for manifest passengers
    const manifestIds = [
      ...new Set(
        manifestPax.map((p) => p.manifest_id?.toString()).filter(Boolean),
      ),
    ];
    const manifests =
      manifestIds.length > 0
        ? await Manifest.find({ _id: { $in: manifestIds } })
            .select(
              "flight_number flight_date direction origin destination carrier",
            )
            .lean()
        : [];
    const manifestMap = {};
    manifests.forEach((m) => (manifestMap[m._id.toString()] = m));

    const records = [];

    // 1. Records from ManifestPassenger (has PNR/booking)
    manifestPax.forEach((p) => {
      const mf = manifestMap[p.manifest_id?.toString()] || {};
      records.push({
        _source: "manifest",
        name: p.name,
        passport_number: p.passport_number,
        pnr: p.pnr || null,
        seat_no: p.seat_no || null,
        fare_class: p.fare_class || null,
        status: p.status,
        flight_number: p.flight_number || mf.flight_number || null,
        flight_date: p.flight_date || mf.flight_date || null,
        direction: mf.direction || null,
        origin: mf.origin || null,
        destination: mf.destination || null,
        carrier: mf.carrier || null,
        nationality: p.nationality || null,
        gender: p.gender || null,
        date_of_birth: p.date_of_birth || null,
        ticket_number: p.ticket_number || null,
        bag_weight: p.bag_weight || null,
        manifest_id: p.manifest_id,
        // IMEI-specific (not applicable)
        device_info: null,
        payment_info: null,
      });
    });

    // 2. Records from ImeiDetail (has device + payment + flight)
    imeiDetails.forEach((d) => {
      records.push({
        _source: "imei_detail",
        name: d.nama,
        passport_number: d.no_identitas,
        pnr: null,
        seat_no: null,
        fare_class: null,
        status: d.cara_pembayaran || null,
        flight_number: d.flight_voyage || d.flight_normalized || null,
        flight_date: d.waktu_kedatangan || null,
        direction: null,
        origin: null,
        destination: null,
        carrier: null,
        nationality: d.kebangsaan || null,
        gender: null,
        date_of_birth: null,
        ticket_number: null,
        bag_weight: null,
        manifest_id: null,
        device_info: {
          merk: d.merk,
          tipe: d.tipe,
          storage: d.storage,
          imei1: d.imei1,
          imei2: d.imei2,
          warna: d.warna,
          harga_fob_usd: d.harga_fob_usd,
          bekas: d.bekas,
        },
        payment_info: {
          no_dokumen: d.no_dokumen,
          tgl_dokumen: d.tgl_dokumen,
          cara_pembayaran: d.cara_pembayaran,
          kode_billing: d.kode_billing,
          total_pungutan: d.total_pungutan,
          pungutan_bm: d.pungutan_bm,
          pungutan_ppn: d.pungutan_ppn,
          pungutan_pph: d.pungutan_pph,
          nilai_pabean_rp: d.nilai_pabean_rp,
          kode_kantor: d.kode_kantor,
        },
      });
    });

    // 3. Records from ImeiRegistration (summary level, no device detail)
    // Only add if not already covered by ImeiDetail (deduplicate by no_dok)
    const detailDokSet = new Set(
      imeiDetails.map((d) => d.no_dokumen).filter(Boolean),
    );
    imeiRegs.forEach((r) => {
      if (r.no_dok && detailDokSet.has(r.no_dok)) return; // skip duplicate
      records.push({
        _source: "imei_registration",
        name: r.nama,
        passport_number: r.no_identitas,
        pnr: null,
        seat_no: null,
        fare_class: null,
        status: r.status_pembayaran || null,
        flight_number: r.vessel || r.vessel_normalized || null,
        flight_date: r.tgl_kedatangan || null,
        direction: null,
        origin: null,
        destination: null,
        carrier: null,
        nationality: r.kebangsaan || null,
        gender: null,
        date_of_birth: null,
        ticket_number: null,
        bag_weight: null,
        manifest_id: null,
        device_info: null,
        payment_info: {
          no_dokumen: r.no_dok,
          tgl_dokumen: r.tgl_dok,
          cara_pembayaran: r.status_pembayaran,
          total_pungutan: r.total_pungutan,
          kode_kantor: r.kode_kantor,
        },
      });
    });

    // Sort all records by date descending
    records.sort((a, b) => {
      const da = a.flight_date ? new Date(a.flight_date).getTime() : 0;
      const db = b.flight_date ? new Date(b.flight_date).getTime() : 0;
      return db - da;
    });

    // Extract unique PNRs and flights
    const uniquePnrs = [...new Set(records.map((r) => r.pnr).filter(Boolean))];
    const uniqueFlights = [
      ...new Set(records.map((r) => r.flight_number).filter(Boolean)),
    ];

    // Build profile from best available data
    const firstManifest = manifestPax[0];
    const firstDetail = imeiDetails[0];
    const firstReg = imeiRegs[0];
    const firstCeisa = ceisaPax[0];

    const profile = {
      name:
        firstManifest?.name ||
        firstDetail?.nama ||
        firstReg?.nama ||
        firstCeisa?.nama ||
        null,
      passport: passport,
      nationality:
        firstManifest?.nationality ||
        firstDetail?.kebangsaan ||
        firstReg?.kebangsaan ||
        firstCeisa?.kebangsaan ||
        null,
      gender: firstManifest?.gender || null,
      date_of_birth: firstManifest?.date_of_birth || null,
      total_flights: uniqueFlights.length,
      total_bookings: uniquePnrs.length,
      booking_codes: uniquePnrs,
      flights: uniqueFlights,
    };

    // Source summary
    const sources = {
      manifest: manifestPax.length,
      imei_detail: imeiDetails.length,
      imei_registration: imeiRegs.length - [...detailDokSet].length,
      ceisa: ceisaPax.length,
    };

    res.json({
      status: "ok",
      data: {
        passport,
        profile,
        records,
        total: records.length,
        sources,
      },
    });
  } catch (err) {
    console.error("[Manifest Passport Search]", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

router.get("/:id", manifestController.getManifestDetail);
router.post(
  "/upload",
  upload.single("file"),
  manifestController.uploadManifest,
);
router.put("/:id/review", manifestController.updateManifestStatus);
router.post("/:id/sync", manifestController.syncManifestPassengers);
router.get("/:id/passengers", manifestController.listManifestPassengers);
router.get(
  "/:id/passengers/export",
  manifestController.exportManifestPassengers,
);
router.get("/:id/crosscheck", manifestController.crosscheckManifestHandler);

// POST /api/manifests/:id/reparse - Re-parse manifest file with updated parser
router.post("/:id/reparse", async (req, res) => {
  try {
    const fs = require("fs");
    const {
      detectAndParseText,
      classifyByFilename,
    } = require("../services/manifestService");
    const manifest = await Manifest.findById(req.params.id);
    if (!manifest)
      return res
        .status(404)
        .json({ status: "error", message: "Manifest tidak ditemukan" });
    if (!manifest.file_path || !fs.existsSync(manifest.file_path)) {
      return res.status(400).json({
        status: "error",
        message: "File manifest tidak ditemukan di server",
      });
    }
    let rawText = "";
    const ext = (manifest.file_type || "").toLowerCase();
    if (ext === "pdf") {
      const pdfParse = require("pdf-parse");
      const buffer = fs.readFileSync(manifest.file_path);
      const data = await pdfParse(buffer);
      rawText = data.text || "";
    } else if (ext === "docx") {
      const mammoth = require("mammoth");
      const buffer = fs.readFileSync(manifest.file_path);
      const result = await mammoth.extractRawText({ buffer });
      rawText = result.value || "";
    } else {
      rawText = fs.readFileSync(manifest.file_path, "utf-8");
    }
    const parsed = detectAndParseText(rawText, manifest.filename);
    if (!parsed) {
      // Try filename classification
      const docClass = classifyByFilename(manifest.filename);
      if (docClass) {
        manifest.status = "classified";
        manifest.parsing_notes = `Dokumen operasional: ${docClass}. Bukan manifest penumpang.`;
        manifest.parsed_fields = { format: docClass, doc_type: docClass };
        await manifest.save();
        return res.json({
          status: "ok",
          message: `Diklasifikasi sebagai ${docClass}`,
          reparsed: true,
          classified: true,
          data: manifest,
        });
      }
      return res.json({
        status: "ok",
        message: "Format masih tidak dikenali",
        reparsed: false,
      });
    }
    manifest.parsed_fields = {
      format: parsed.format,
      segments: parsed.segments || [],
      passengers: parsed.passengers || [],
      no_shows: parsed.no_shows || [],
    };
    manifest.flight_number = parsed.flight_number || manifest.flight_number;
    manifest.flight_date = parsed.flight_date || manifest.flight_date;
    manifest.origin = parsed.origin || manifest.origin;
    manifest.destination = parsed.destination || manifest.destination;
    manifest.carrier = parsed.carrier || manifest.carrier;
    if (manifest.status === "needs_review" || manifest.status === "classified")
      manifest.status = "parsed";
    manifest.parsing_notes = `Berhasil di-parse: format ${parsed.format}`;
    await manifest.save();
    // Count parsed passengers
    let paxCount = (parsed.passengers || []).length;
    (parsed.segments || []).forEach((seg) => {
      paxCount += (seg.passengers || []).length + (seg.no_shows || []).length;
    });
    res.json({
      status: "ok",
      message: `Re-parse berhasil: ${paxCount} penumpang ditemukan (format: ${parsed.format})`,
      reparsed: true,
      data: manifest,
    });
  } catch (err) {
    console.error("[MANIFEST REPARSE]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

module.exports = router;
