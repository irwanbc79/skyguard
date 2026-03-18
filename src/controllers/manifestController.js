const Manifest = require("../models/Manifest");
const ManifestPassenger = require("../models/ManifestPassenger");
const { ingestManifest } = require("../services/manifestIngestService");
const { crosscheckManifest } = require("../services/crosscheckService");
const { sanitizeCsv } = require("../utils/helpers");

async function listManifests(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.carrier) filter.carrier = req.query.carrier;
    if (req.query.search) {
      // Normalize: "QZ 107" → "QZ\\s*107" so it matches "QZ107", "QZ 107", etc.
      const raw = req.query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const flexRegex = raw.replace(/\s+/g, "\\s*");
      filter.$or = [
        { flight_number: { $regex: flexRegex, $options: "i" } },
        { origin: { $regex: flexRegex, $options: "i" } },
        { destination: { $regex: flexRegex, $options: "i" } },
        { filename: { $regex: flexRegex, $options: "i" } },
        { email_subject: { $regex: flexRegex, $options: "i" } },
        { carrier: { $regex: flexRegex, $options: "i" } },
      ];
    }
    const manifests = await Manifest.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit);
    res.json({ status: "ok", data: manifests });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
}

async function getManifestDetail(req, res) {
  try {
    const manifest = await Manifest.findById(req.params.id);
    if (!manifest)
      return res
        .status(404)
        .json({ status: "error", message: "Manifest tidak ditemukan" });
    res.json({ status: "ok", data: manifest });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
}

async function uploadManifest(req, res) {
  try {
    if (!req.file)
      return res
        .status(400)
        .json({ status: "error", message: "File tidak ditemukan" });
    const uploadedBy = req.body.uploaded_by || "manual";
    const manifest = await ingestManifest({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      source: "manual",
      uploadedBy,
    });
    res.json({ status: "ok", data: manifest });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
}

async function updateManifestStatus(req, res) {
  try {
    const { status, parsing_notes } = req.body;
    const allowed = ["approved", "rejected", "needs_review"];
    if (!allowed.includes(status)) {
      return res
        .status(400)
        .json({ status: "error", message: "Status tidak valid" });
    }
    const manifest = await Manifest.findByIdAndUpdate(
      req.params.id,
      { status, parsing_notes },
      { new: true },
    );
    if (!manifest)
      return res
        .status(404)
        .json({ status: "error", message: "Manifest tidak ditemukan" });
    res.json({ status: "ok", data: manifest });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
}

function buildPassengerDoc(
  manifest,
  p,
  defaultStatus = "checked_in",
  segmentIndex = 0,
) {
  return {
    manifest_id: manifest._id,
    flight_number: manifest.flight_number,
    flight_date: manifest.flight_date,
    segment_index: segmentIndex,
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
  };
}

async function syncManifestPassengers(req, res) {
  try {
    const manifest = await Manifest.findById(req.params.id);
    if (!manifest)
      return res
        .status(404)
        .json({ status: "error", message: "Manifest tidak ditemukan" });
    if (manifest.status === "synced") {
      return res.json({ status: "ok", message: "Manifest sudah disinkronkan" });
    }

    const parsed = manifest.parsed_fields || {};
    const format = parsed.format || "airasia_pax";
    const docs = [];

    // Check flat passengers first (apis, lion_manifest, mh_manifest, sq_manifest,
    // dcs_manifest, ga_manifest, enh_manifest, baggage_list, generic_report,
    // csv_manifest, generic_manifest, xlsx_manifest, etc.)
    const hasFlatPassengers = (parsed.passengers || []).length > 0;
    const hasSegments = (parsed.segments || []).some(
      (s) => (s.passengers || []).length > 0 || (s.no_shows || []).length > 0,
    );

    if (hasFlatPassengers) {
      // Format flat: passengers + no_shows langsung di parsed_fields
      (parsed.passengers || []).forEach((p) =>
        docs.push(buildPassengerDoc(manifest, p, "checked_in", 0)),
      );
      (parsed.no_shows || []).forEach((p) =>
        docs.push(buildPassengerDoc(manifest, p, "no_show", 0)),
      );
    }

    if (hasSegments) {
      // Format segment-based (AirAsia PAX, etc.)
      (parsed.segments || []).forEach((segment, index) => {
        (segment.passengers || []).forEach((p) =>
          docs.push(buildPassengerDoc(manifest, p, "checked_in", index)),
        );
        (segment.no_shows || []).forEach((p) =>
          docs.push(buildPassengerDoc(manifest, p, "no_show", index)),
        );
      });
    }

    if (!hasFlatPassengers && !hasSegments) {
      return res.status(400).json({
        status: "error",
        message: "Manifest belum diparse atau tidak ada penumpang",
      });
    }

    if (!docs.length) {
      return res.status(400).json({
        status: "error",
        message: "Tidak ada data penumpang yang bisa disinkronkan",
      });
    }

    await ManifestPassenger.deleteMany({ manifest_id: manifest._id });
    await ManifestPassenger.insertMany(docs);

    manifest.status = "synced";
    await manifest.save();
    res.json({
      status: "ok",
      message: "Manifest berhasil disinkronkan",
      total: docs.length,
      format,
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
}

async function listManifestPassengers(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const passengers = await ManifestPassenger.find({
      manifest_id: req.params.id,
    })
      .sort({ seq_no: 1 })
      .limit(limit);
    res.json({ status: "ok", data: passengers });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
}

async function exportManifestPassengers(req, res) {
  try {
    const passengers = await ManifestPassenger.find({
      manifest_id: req.params.id,
    }).sort({ seq_no: 1 });
    const headers = [
      "status",
      "name",
      "pnr",
      "fare_class",
      "seq_no",
      "travel_date",
      "seat_no",
      "destination_code",
      "flight_no",
    ];
    const rows = passengers.map((p) => [
      p.status,
      p.name,
      p.pnr,
      p.fare_class,
      p.seq_no,
      p.travel_date,
      p.seat_no,
      p.destination_code,
      p.flight_no,
    ]);
    const csv = [
      headers.join(","),
      ...rows.map((row) =>
        row
          .map(
            (val) => `"${sanitizeCsv(String(val || "")).replace(/"/g, '""')}"`,
          )
          .join(","),
      ),
    ].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="manifest_passengers.csv"',
    );
    res.send(csv);
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
}

async function crosscheckManifestHandler(req, res) {
  try {
    const result = await crosscheckManifest(req.params.id);
    res.json({ status: "ok", data: result });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
}

module.exports = {
  listManifests,
  getManifestDetail,
  uploadManifest,
  updateManifestStatus,
  syncManifestPassengers,
  listManifestPassengers,
  exportManifestPassengers,
  crosscheckManifestHandler,
};
