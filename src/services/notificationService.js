const { escapeRegex } = require("../utils/helpers");
const Notification = require("../models/Notification");
const Suspect = require("../models/Suspect");
const Cnpibk = require("../models/cnpibk");

/**
 * Create a notification
 */
async function createNotification({ type, priority, title, message, data }) {
  try {
    const notif = new Notification({ type, priority, title, message, data });
    await notif.save();
    console.log(`[NOTIF] ${priority} ${type}: ${title}`);
    return notif;
  } catch (err) {
    console.error("[NOTIF] Create error:", err.message);
    return null;
  }
}

/**
 * Get notifications with pagination & filters
 */
async function getNotifications(query = {}) {
  const filter = {};
  if (query.unread_only === "true" || query.unread_only === true) {
    filter.is_read = false;
  }
  if (query.type) filter.type = query.type;
  if (query.priority) filter.priority = query.priority;

  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 30;
  const skip = (page - 1) * limit;

  const [notifications, total, unread_count] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ is_read: false }),
  ]);

  return { notifications, total, unread_count, page, limit };
}

/**
 * Get unread count only (fast endpoint for polling)
 */
async function getUnreadCount() {
  const [total, bySeverity] = await Promise.all([
    Notification.countDocuments({ is_read: false }),
    Notification.aggregate([
      { $match: { is_read: false } },
      { $group: { _id: "$priority", count: { $sum: 1 } } },
    ]),
  ]);
  const severity = {};
  bySeverity.forEach((s) => {
    severity[s._id] = s.count;
  });
  return { unread: total, severity };
}

/**
 * Mark notification as read
 */
async function markRead(id) {
  return Notification.findByIdAndUpdate(
    id,
    { is_read: true, read_at: new Date() },
    { new: true },
  );
}

/**
 * Mark all as read
 */
async function markAllRead() {
  const result = await Notification.updateMany(
    { is_read: false },
    { is_read: true, read_at: new Date() },
  );
  return { modified: result.modifiedCount };
}

/**
 * Delete old notifications (> 30 days, already handled by TTL index but manual cleanup too)
 */
async function cleanup() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const result = await Notification.deleteMany({ createdAt: { $lt: cutoff } });
  return { deleted: result.deletedCount };
}

// ============================================================
// AUTO-NOTIFICATION GENERATORS
// ============================================================

/**
 * Called when crosscheck discovers suspects in a manifest
 */
async function notifySuspectDetected({ manifest, suspectAlerts }) {
  if (!suspectAlerts || suspectAlerts.length === 0) return;

  for (const alert of suspectAlerts) {
    await createNotification({
      type: "SUSPECT_DETECTED",
      priority: alert.suspect_info?.risk_level === "HIGH" ? "CRITICAL" : "HIGH",
      title: `⚠️ SUSPECT: ${alert.name || alert.suspect_info?.full_name}`,
      message: `Penumpang dalam Daftar Atensi terdeteksi di manifest ${manifest.flight_number || ""}. Passport: ${alert.passport_number}. Risk: ${alert.suspect_info?.risk_level}. Kategori: ${(alert.suspect_info?.categories || []).join(", ")}`,
      data: {
        manifest_id: manifest.id || manifest._id,
        suspect_id: alert.suspect_info?.suspect_id,
        passenger_passport: alert.passport_number,
        flight_number: manifest.flight_number,
        flight_date: manifest.flight_date,
        suspect_name: alert.suspect_info?.full_name || alert.name,
        risk_level: alert.suspect_info?.risk_level,
        categories: alert.suspect_info?.categories,
      },
    });
  }
}

/**
 * Called when a new manifest is ingested/uploaded
 */
async function notifyManifestReceived(manifest) {
  await createNotification({
    type: "MANIFEST_RECEIVED",
    priority: "LOW",
    title: `📋 Manifest: ${manifest.flight_number || manifest.filename}`,
    message: `Manifest baru diterima. Flight: ${manifest.flight_number || "-"}, Route: ${manifest.origin || "?"} → ${manifest.destination || "?"}, Date: ${manifest.flight_date ? new Date(manifest.flight_date).toLocaleDateString("id-ID") : "-"}, Status: ${manifest.status}`,
    data: {
      manifest_id: manifest._id,
      flight_number: manifest.flight_number,
      flight_date: manifest.flight_date,
    },
  });
}

/**
 * Called when a new suspect is created
 */
async function notifySuspectCreated(suspect) {
  await createNotification({
    type: "SUSPECT_CREATED",
    priority: suspect.risk_level === "HIGH" ? "HIGH" : "MEDIUM",
    title: `🔍 Suspect Baru: ${suspect.full_name}`,
    message: `${suspect.full_name} (${suspect.passport_number}) ditambahkan ke Daftar Atensi. Risk: ${suspect.risk_level}. Kategori: ${(suspect.categories || []).join(", ")}`,
    data: {
      suspect_id: suspect._id,
      passenger_passport: suspect.passport_number,
      suspect_name: suspect.full_name,
      risk_level: suspect.risk_level,
      categories: suspect.categories,
    },
  });

  // Also check cargo for this suspect
  await scanCargoForSuspect(suspect);
}

/**
 * Called when a high-risk passenger is detected in 360° profile
 */
async function notifyHighRiskPassenger({
  passport,
  nama,
  intelScore,
  riskLevel,
}) {
  // Only notify for truly high intel scores (avoid spam)
  if (intelScore < 25) return;

  // Check if we already sent a similar notification in the last 24h
  const recent = await Notification.findOne({
    type: "HIGH_RISK_PASSENGER",
    "data.passenger_passport": passport,
    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  });
  if (recent) return;

  await createNotification({
    type: "HIGH_RISK_PASSENGER",
    priority: riskLevel === "RED" ? "HIGH" : "MEDIUM",
    title: `🔥 High Risk: ${nama}`,
    message: `Penumpang ${nama} (${passport}) memiliki Intel Score ${intelScore}. Risk Level: ${riskLevel}. Perlu perhatian khusus.`,
    data: {
      passenger_passport: passport,
      suspect_name: nama,
      risk_level: riskLevel,
      intel_score: intelScore,
    },
  });
}

/**
 * Scan cargo (Cnpibk) for suspect's identity
 */
async function scanCargoForSuspect(suspect) {
  try {
    const pp = suspect.passport_number.toUpperCase().trim();
    if (!pp) return;

    // Search cargo where receiver identity matches suspect passport
    const safePp = escapeRegex(pp);
    const cargoRecords = await Cnpibk.find({
      $or: [
        { nomor_identitas_penerima: { $regex: new RegExp(safePp, "i") } },
        { nomor_identitas_pengirim: { $regex: new RegExp(safePp, "i") } },
      ],
    })
      .sort({ tanggal_hawb: -1 })
      .limit(20)
      .lean();

    if (cargoRecords.length === 0) return;

    const totalCIF = cargoRecords.reduce(
      (sum, c) => sum + (c.cif_akhir || 0),
      0,
    );

    await createNotification({
      type: "CARGO_SUSPECT_LINK",
      priority: "CRITICAL",
      title: `📦 Cargo-Suspect Link: ${suspect.full_name}`,
      message: `${cargoRecords.length} kiriman cargo terkait dengan suspect ${suspect.full_name} (${pp}). Total CIF: $${totalCIF.toFixed(2)}. Penerima/Pengirim identity match.`,
      data: {
        suspect_id: suspect._id,
        passenger_passport: pp,
        suspect_name: suspect.full_name,
        risk_level: suspect.risk_level,
        categories: suspect.categories,
        extra: {
          cargo_count: cargoRecords.length,
          total_cif: totalCIF,
          latest_cargo: cargoRecords[0]?.nomor_aju,
          latest_date: cargoRecords[0]?.tanggal_hawb,
        },
      },
    });
  } catch (err) {
    console.error("[NOTIF] Cargo-suspect scan error:", err.message);
  }
}

// Lock untuk mencegah concurrent scan
let _scanLock = false;

/**
 * Full cargo scan: check all active suspects against cargo database
 * Run this periodically or on-demand
 */
async function scanAllCargoForSuspects() {
  if (_scanLock) {
    console.log("[NOTIF] Cargo scan already running, skipping duplicate trigger.");
    return { scanned: 0, found: 0, skipped: true };
  }
  _scanLock = true;
  try {
    const activeSuspects = await Suspect.find({
      status: { $in: ["ACTIVE", "MONITORING"] },
    }).lean();

    let found = 0;
    for (const suspect of activeSuspects) {
      const pp = suspect.passport_number?.toUpperCase().trim();
      if (!pp) continue;

      // Check if we already sent this notification in the last 7 days
      const recent = await Notification.findOne({
        type: "CARGO_SUSPECT_LINK",
        "data.passenger_passport": pp,
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      });
      if (recent) continue;

      const safePp = escapeRegex(pp);
      const cargoCount = await Cnpibk.countDocuments({
        $or: [
          { nomor_identitas_penerima: { $regex: new RegExp(safePp, "i") } },
          { nomor_identitas_pengirim: { $regex: new RegExp(safePp, "i") } },
        ],
      });

      if (cargoCount > 0) {
        await scanCargoForSuspect(suspect);
        found++;
      }
    }

    console.log(
      `[NOTIF] Cargo-suspect scan complete: ${found} links found out of ${activeSuspects.length} suspects`,
    );
    return { scanned: activeSuspects.length, found };
  } catch (err) {
    console.error("[NOTIF] Full cargo scan error:", err.message);
    return { scanned: 0, found: 0 };
  } finally {
    _scanLock = false;
  }
}

module.exports = {
  createNotification,
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  cleanup,
  notifySuspectDetected,
  notifyManifestReceived,
  notifySuspectCreated,
  notifyHighRiskPassenger,
  scanCargoForSuspect,
  scanAllCargoForSuspects,
};
