const Suspect = require("../models/Suspect");
const Passenger = require("../models/Passenger");
const ManifestPassenger = require("../models/ManifestPassenger");
const Manifest = require("../models/Manifest");
const Cnpibk = require("../models/cnpibk");
const ImeiDetail = require("../models/ImeiDetail");
const path = require("path");
const fs = require("fs");
const {
  notifySuspectCreated,
  notifyHighRiskPassenger,
} = require("./notificationService");

const UPLOAD_DIR = path.join(__dirname, "../../uploads/suspects");

// Ensure upload directory exists
function ensureUploadDir() {
  const dirs = [
    UPLOAD_DIR,
    path.join(UPLOAD_DIR, "passport"),
    path.join(UPLOAD_DIR, "passenger"),
    path.join(UPLOAD_DIR, "additional"),
  ];
  dirs.forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}
ensureUploadDir();

/**
 * Resize image using sharp - max 800px wide, JPEG quality 75
 */
async function resizeImage(buffer, outputPath) {
  try {
    const sharp = require("sharp");
    await sharp(buffer)
      .resize(800, 800, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toFile(outputPath);
    return true;
  } catch (err) {
    // Fallback: save raw buffer if sharp fails
    console.error("[Suspect] Sharp resize failed, saving raw:", err.message);
    fs.writeFileSync(outputPath, buffer);
    return false;
  }
}

/**
 * Create new suspect
 */
async function createSuspect(data, files) {
  // Handle photo uploads with resize
  if (files) {
    if (files.passport_photo && files.passport_photo[0]) {
      const fname = `passport_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.jpg`;
      const fpath = path.join(UPLOAD_DIR, "passport", fname);
      await resizeImage(files.passport_photo[0].buffer, fpath);
      data.passport_photo = `/uploads/suspects/passport/${fname}`;
    }
    if (files.passenger_photo && files.passenger_photo[0]) {
      const fname = `passenger_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.jpg`;
      const fpath = path.join(UPLOAD_DIR, "passenger", fname);
      await resizeImage(files.passenger_photo[0].buffer, fpath);
      data.passenger_photo = `/uploads/suspects/passenger/${fname}`;
    }
    if (files.additional_photos) {
      data.additional_photos = [];
      for (const file of files.additional_photos) {
        const fname = `add_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.jpg`;
        const fpath = path.join(UPLOAD_DIR, "additional", fname);
        await resizeImage(file.buffer, fpath);
        data.additional_photos.push(`/uploads/suspects/additional/${fname}`);
      }
    }
  }

  // Parse arrays from form data
  if (typeof data.categories === "string") {
    data.categories = data.categories.split(",").filter(Boolean);
  }
  if (typeof data.known_routes === "string") {
    data.known_routes = data.known_routes.split(",").filter(Boolean);
  }
  if (typeof data.known_airlines === "string") {
    data.known_airlines = data.known_airlines.split(",").filter(Boolean);
  }

  // Add creation action
  data.actions = [
    {
      action_type: "CREATED",
      description: "Suspect ditambahkan ke watchlist",
      officer_name: data.created_by_name || "",
      officer_nip: data.created_by_nip || "",
    },
  ];

  const suspect = new Suspect(data);
  await suspect.save();

  // Auto cross-check
  await crossCheckPassenger(suspect);

  // === AUTO-NOTIFY: New suspect created ===
  try {
    await notifySuspectCreated(suspect);
  } catch (e) {
    console.error("[Suspect] Notification error:", e.message);
  }

  return suspect;
}

/**
 * Update suspect
 */
async function updateSuspect(id, data, files) {
  const suspect = await Suspect.findById(id);
  if (!suspect) throw new Error("Suspect not found");

  // Handle photo uploads with resize
  if (files) {
    if (files.passport_photo && files.passport_photo[0]) {
      // Delete old file
      if (suspect.passport_photo) deleteFile(suspect.passport_photo);
      const fname = `passport_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.jpg`;
      const fpath = path.join(UPLOAD_DIR, "passport", fname);
      await resizeImage(files.passport_photo[0].buffer, fpath);
      data.passport_photo = `/uploads/suspects/passport/${fname}`;
    }
    if (files.passenger_photo && files.passenger_photo[0]) {
      if (suspect.passenger_photo) deleteFile(suspect.passenger_photo);
      const fname = `passenger_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.jpg`;
      const fpath = path.join(UPLOAD_DIR, "passenger", fname);
      await resizeImage(files.passenger_photo[0].buffer, fpath);
      data.passenger_photo = `/uploads/suspects/passenger/${fname}`;
    }
    if (files.additional_photos) {
      if (!data.additional_photos)
        data.additional_photos = suspect.additional_photos || [];
      if (typeof data.additional_photos === "string")
        data.additional_photos = JSON.parse(data.additional_photos || "[]");
      for (const file of files.additional_photos) {
        const fname = `add_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.jpg`;
        const fpath = path.join(UPLOAD_DIR, "additional", fname);
        await resizeImage(file.buffer, fpath);
        data.additional_photos.push(`/uploads/suspects/additional/${fname}`);
      }
    }
  }

  // Parse arrays
  if (typeof data.categories === "string") {
    data.categories = data.categories.split(",").filter(Boolean);
  }
  if (typeof data.known_routes === "string") {
    data.known_routes = data.known_routes.split(",").filter(Boolean);
  }
  if (typeof data.known_airlines === "string") {
    data.known_airlines = data.known_airlines.split(",").filter(Boolean);
  }

  // Remove actions from data - managed separately
  delete data.actions;

  data.updated_by_name = data.updated_by_name || "";
  data.updated_by_nip = data.updated_by_nip || "";

  Object.assign(suspect, data);
  await suspect.save();
  return suspect;
}

/**
 * Delete file helper
 */
function deleteFile(relativePath) {
  try {
    const fullPath = path.join(__dirname, "../../", relativePath);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  } catch (e) {
    console.error("[Suspect] Delete file error:", e.message);
  }
}

/**
 * Add action to suspect timeline
 */
async function addAction(id, actionData) {
  const suspect = await Suspect.findById(id);
  if (!suspect) throw new Error("Suspect not found");

  suspect.actions.push({
    action_type: actionData.action_type,
    description: actionData.description,
    officer_name: actionData.officer_name || "",
    officer_nip: actionData.officer_nip || "",
  });

  // Update status if action implies it
  if (actionData.action_type === "DETAINED") suspect.status = "ARRESTED";
  if (actionData.action_type === "RELEASED") suspect.status = "CLEARED";

  await suspect.save();
  return suspect;
}

/**
 * Cross-check suspect passport against passenger data
 */
async function crossCheckPassenger(suspect) {
  try {
    const passengers = await Passenger.find({
      paspor: { $regex: new RegExp("^" + suspect.passport_number + "$", "i") },
    })
      .sort({ tanggal_dokumen: -1 })
      .limit(50);

    if (passengers.length > 0) {
      suspect.travel_count = passengers.length;
      suspect.last_seen =
        passengers[0].tanggal_dokumen || passengers[0].created_at;
      suspect.last_flight = passengers[0].nomor_dokumen || "";
      await suspect.save();
    }

    return passengers;
  } catch (e) {
    console.error("[Suspect] Cross-check error:", e.message);
    return [];
  }
}

/**
 * Get all suspects with filters
 */
async function getSuspects(query) {
  const filter = {};

  if (query.status) filter.status = query.status;
  if (query.risk_level) filter.risk_level = query.risk_level;
  if (query.category) filter.categories = query.category;
  if (query.search) {
    filter.$or = [
      { passport_number: { $regex: query.search, $options: "i" } },
      { full_name: { $regex: query.search, $options: "i" } },
    ];
  }

  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 20;
  const skip = (page - 1) * limit;
  const sort = query.sort || "-updatedAt";

  const [suspects, total] = await Promise.all([
    Suspect.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Suspect.countDocuments(filter),
  ]);

  return { suspects, total, page, limit, pages: Math.ceil(total / limit) };
}

/**
 * Get single suspect by ID
 */
async function getSuspectById(id) {
  const suspect = await Suspect.findById(id).lean();
  if (!suspect) throw new Error("Suspect not found");

  // Auto cross-check on view
  const travelHistory = await crossCheckPassenger(suspect);
  suspect.travel_history = travelHistory;

  // Get manifest/flight history
  const manifestHistory = await getManifestHistory(suspect.passport_number);
  suspect.manifest_history = manifestHistory;

  return suspect;
}

/**
 * Delete suspect
 */
async function deleteSuspect(id) {
  const suspect = await Suspect.findById(id);
  if (!suspect) throw new Error("Suspect not found");

  // Clean up photos
  if (suspect.passport_photo) deleteFile(suspect.passport_photo);
  if (suspect.passenger_photo) deleteFile(suspect.passenger_photo);
  if (suspect.additional_photos) {
    suspect.additional_photos.forEach((p) => deleteFile(p));
  }

  await Suspect.findByIdAndDelete(id);
  return { deleted: true };
}

/**
 * Get watchlist statistics
 */
async function getStats() {
  const [total, byStatus, byCategory, byRisk, recentActions] =
    await Promise.all([
      Suspect.countDocuments(),
      Suspect.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Suspect.aggregate([
        { $unwind: "$categories" },
        { $group: { _id: "$categories", count: { $sum: 1 } } },
      ]),
      Suspect.aggregate([
        { $group: { _id: "$risk_level", count: { $sum: 1 } } },
      ]),
      Suspect.aggregate([
        { $unwind: "$actions" },
        { $sort: { "actions.created_at": -1 } },
        { $limit: 10 },
        {
          $project: {
            passport_number: 1,
            full_name: 1,
            action: "$actions",
          },
        },
      ]),
    ]);

  return {
    total,
    by_status: byStatus.reduce((o, i) => {
      o[i._id] = i.count;
      return o;
    }, {}),
    by_category: byCategory.reduce((o, i) => {
      o[i._id] = i.count;
      return o;
    }, {}),
    by_risk: byRisk.reduce((o, i) => {
      o[i._id] = i.count;
      return o;
    }, {}),
    recent_actions: recentActions,
  };
}

/**
 * Delete additional photo
 */
async function deleteAdditionalPhoto(id, photoPath) {
  const suspect = await Suspect.findById(id);
  if (!suspect) throw new Error("Suspect not found");

  suspect.additional_photos = suspect.additional_photos.filter(
    (p) => p !== photoPath,
  );
  deleteFile(photoPath);
  await suspect.save();
  return suspect;
}

/**
 * Get manifest/flight history for a passport number
 */
async function getManifestHistory(passportNumber) {
  try {
    const manifestPax = await ManifestPassenger.find({
      passport_number: { $regex: new RegExp("^" + passportNumber + "$", "i") },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    if (!manifestPax.length) return [];

    // Get manifest details for each
    const manifestIds = [
      ...new Set(
        manifestPax.map((p) => p.manifest_id?.toString()).filter(Boolean),
      ),
    ];
    const manifests = await Manifest.find({ _id: { $in: manifestIds } }).lean();
    const manifestMap = {};
    manifests.forEach((m) => {
      manifestMap[m._id.toString()] = m;
    });

    return manifestPax.map((p) => {
      const m = manifestMap[p.manifest_id?.toString()] || {};
      return {
        flight_number: p.flight_number || m.flight_number || "-",
        flight_date: p.flight_date || m.flight_date,
        origin: m.origin || "-",
        destination: m.destination || "-",
        seat_no: p.seat_no || "-",
        pnr: p.pnr || "-",
        status: p.status || "-",
        nationality: p.nationality || "-",
        name: p.name || "-",
        ceisa_match: p.ceisa_match,
        manifest_id: p.manifest_id,
      };
    });
  } catch (e) {
    console.error("[Suspect] Manifest history error:", e.message);
    return [];
  }
}

/**
 * Passenger 360° Intelligence Profile
 * Aggregates: CEISA records + Suspect status + Manifest flights
 */
async function getPassengerProfile(passportNumber) {
  const pp = passportNumber.toUpperCase().trim();

  // 1. CEISA records (bulk upload)
  const ceisaRecordsRaw = await Passenger.find({ paspor: pp })
    .sort({ tanggal_dokumen: -1 })
    .lean();

  // 1b. ImeiDetail records (real-time IMEI registry, lebih fresh)
  const imeiDetailRecords = await ImeiDetail.find({ no_identitas: new RegExp("^" + pp + "$", "i") })
    .sort({ waktu_kedatangan: -1 })
    .limit(50)
    .lean();

  // Merge: normalise ImeiDetail ke format CEISA, deduplicate by nomor_dokumen
  const ceisaDocNums = new Set(ceisaRecordsRaw.map((r) => r.nomor_dokumen).filter(Boolean));
  const imeiAsceisa = imeiDetailRecords
    .filter((d) => !ceisaDocNums.has(d.no_dokumen))
    .map((d) => ({
      nomor_dokumen: d.no_dokumen,
      tanggal_dokumen: d.tgl_dokumen || d.waktu_kedatangan,
      hkt1: [d.merk, d.tipe].filter(Boolean).join(" ") || null,
      hkt2: null,
      status_penelitian: d.cara_pembayaran || null,
      nama_petugas: d.nip_petugas || null,
      nama_lengkap: d.nama,
      _source: "imei_detail",
    }));

  const ceisaRecords = [...ceisaRecordsRaw, ...imeiAsceisa].sort(
    (a, b) => new Date(b.tanggal_dokumen || 0) - new Date(a.tanggal_dokumen || 0),
  );

  // Device analysis
  const allDevices = [];
  ceisaRecords.forEach((r) => {
    if (r.hkt1) allDevices.push(r.hkt1);
    if (r.hkt2) allDevices.push(r.hkt2);
  });
  const uniqueDevices = [...new Set(allDevices)];
  const billingCount = ceisaRecords.filter(
    (r) => r.status_penelitian === "BILLING",
  ).length;
  const pembebasanCount = ceisaRecords.filter(
    (r) => r.status_penelitian === "PEMBEBASAN",
  ).length;

  // Device detail map
  const deviceMap = {};
  ceisaRecords.forEach((r) => {
    [r.hkt1, r.hkt2].filter(Boolean).forEach((dev) => {
      if (!deviceMap[dev])
        deviceMap[dev] = { name: dev, count: 0, dates: [], statuses: [] };
      deviceMap[dev].count++;
      if (r.tanggal_dokumen) deviceMap[dev].dates.push(r.tanggal_dokumen);
      if (r.status_penelitian)
        deviceMap[dev].statuses.push(r.status_penelitian);
    });
  });

  // Risk score
  const riskScore =
    ceisaRecords.length * 2 + uniqueDevices.length * 3 + billingCount * 5;
  let riskLevel = "GREEN",
    riskColor = "#22c55e";
  if (
    riskScore >= 30 ||
    ceisaRecords.length >= 10 ||
    uniqueDevices.length >= 8
  ) {
    riskLevel = "RED";
    riskColor = "#ef4444";
  } else if (
    riskScore >= 15 ||
    ceisaRecords.length >= 5 ||
    uniqueDevices.length >= 4
  ) {
    riskLevel = "YELLOW";
    riskColor = "#eab308";
  }

  // 2. Suspect watchlist status
  const suspect = await Suspect.findOne({
    passport_number: { $regex: new RegExp("^" + pp + "$", "i") },
    status: { $in: ["ACTIVE", "MONITORING", "ARRESTED"] },
  }).lean();

  // 3. Manifest/flight history
  const manifestPax = await ManifestPassenger.find({
    passport_number: { $regex: new RegExp("^" + pp + "$", "i") },
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const manifestIds = [
    ...new Set(
      manifestPax.map((p) => p.manifest_id?.toString()).filter(Boolean),
    ),
  ];
  const manifests = await Manifest.find({ _id: { $in: manifestIds } }).lean();
  const manifestMap = {};
  manifests.forEach((m) => {
    manifestMap[m._id.toString()] = m;
  });

  const flights = manifestPax.map((p) => {
    const m = manifestMap[p.manifest_id?.toString()] || {};
    return {
      flight_number: p.flight_number || m.flight_number || "-",
      flight_date: p.flight_date || m.flight_date,
      origin: m.origin || "-",
      destination: m.destination || "-",
      seat_no: p.seat_no || "-",
      pnr: p.pnr || "-",
      status: p.status || "-",
      nationality: p.nationality || "-",
    };
  });

  // Route analysis
  const routeFreq = {};
  const airlineFreq = {};
  flights.forEach((f) => {
    const route = f.origin + "→" + f.destination;
    if (route !== "-→-") routeFreq[route] = (routeFreq[route] || 0) + 1;
    const airline = (f.flight_number || "").replace(/[0-9]/g, "").trim();
    if (airline) airlineFreq[airline] = (airlineFreq[airline] || 0) + 1;
  });

  const profile = {
    passport: pp,
    nama: ceisaRecords[0]?.nama_lengkap || manifestPax[0]?.name || "-",
    ceisa: {
      total_visits: ceisaRecords.length,
      unique_devices: uniqueDevices.length,
      devices: Object.values(deviceMap).sort((a, b) => b.count - a.count),
      billing_count: billingCount,
      pembebasan_count: pembebasanCount,
      first_visit: ceisaRecords.length
        ? ceisaRecords[ceisaRecords.length - 1].tanggal_dokumen
        : null,
      last_visit: ceisaRecords.length ? ceisaRecords[0].tanggal_dokumen : null,
      records: ceisaRecords.slice(0, 30),
    },

    // Risk assessment
    risk: { score: riskScore, level: riskLevel, color: riskColor },

    // Watchlist status
    watchlist: suspect
      ? {
          is_suspect: true,
          suspect_id: suspect._id,
          status: suspect.status,
          risk_level: suspect.risk_level,
          categories: suspect.categories,
          description: suspect.description,
          created_at: suspect.createdAt,
          full_name: suspect.full_name,
        }
      : { is_suspect: false },

    // Flight/manifest history
    flights: {
      total: flights.length,
      records: flights,
      top_routes: Object.entries(routeFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([route, count]) => ({ route, count })),
      airlines: Object.entries(airlineFreq)
        .sort((a, b) => b[1] - a[1])
        .map(([code, count]) => ({ code, count })),
    },

    // === CARGO-PASSENGER BRIDGE ===
    cargo: await (async () => {
      try {
        const cargoRecords = await Cnpibk.find({
          $or: [
            { nomor_identitas_penerima: { $regex: new RegExp(pp, "i") } },
            { nomor_identitas_pengirim: { $regex: new RegExp(pp, "i") } },
          ],
        })
          .sort({ tanggal_hawb: -1 })
          .limit(30)
          .lean();
        const totalCIF = cargoRecords.reduce(
          (sum, c) => sum + (c.cif_akhir || 0),
          0,
        );
        return {
          total: cargoRecords.length,
          total_cif: totalCIF,
          records: cargoRecords.slice(0, 15).map((c) => ({
            nomor_aju: c.nomor_aju,
            tanggal_hawb: c.tanggal_hawb,
            nama_penerima: c.nama_penerima,
            nama_pengirim: c.nama_pengirim,
            cif_akhir: c.cif_akhir,
            current_status: c.current_status,
            nama_pemberitahu: c.nama_pemberitahu,
          })),
        };
      } catch (e) {
        return { total: 0, total_cif: 0, records: [] };
      }
    })(),

    // Combined intelligence score (higher = more attention needed)
    intel_score:
      riskScore + (suspect ? 20 : 0) + flights.length * 1 + billingCount * 3,
  };

  // === AUTO-NOTIFY: High risk passenger ===
  try {
    const nama = ceisaRecords[0]?.nama_lengkap || manifestPax[0]?.name || "-";
    await notifyHighRiskPassenger({
      passport: pp,
      nama,
      intelScore: profile.intel_score,
      riskLevel: riskLevel,
    });
  } catch (e) {
    /* silent */
  }

  return profile;
}

module.exports = {
  createSuspect,
  updateSuspect,
  addAction,
  crossCheckPassenger,
  getSuspects,
  getSuspectById,
  deleteSuspect,
  getStats,
  deleteAdditionalPhoto,
  getManifestHistory,
  getPassengerProfile,
};
