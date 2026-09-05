/**
 * SkyGuard Intelligence - Comprehensive Audit Logging Middleware
 *
 * Mencatat seluruh operasi mutasi (POST, PUT, PATCH, DELETE) serta aksi sensitif
 * (Export, Bulk Operation) ke dalam basis data MongoDB (ActivityLog).
 * Dilengkapi atribusi identitas petugas (NIP, Nama, Email, Role), IP Address,
 * User Agent, dan ringkasan payload yang disaring aman untuk kebutuhan investigasi kepabeanan.
 */

const ActivityLog = require("../models/ActivityLog");

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Endpoint yang diabaikan dari audit mutasi (polling bising / read-only status)
const SKIP_PATHS = [
  "/api/health",
  "/api/notifications/unread-count",
  "/api/kantor-list",
  "/api/auth/verify",
];

// Endpoint auth yang sudah memiliki custom logger sendiri di routes/auth.js
const AUTH_SELF_LOGGED = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
]);

/**
 * Deteksi modul kepabeanan berdasarkan path URL
 */
function detectResource(path) {
  if (path.includes("/suspects")) return { resource: "suspects", label: "Target Watchlist P2" };
  if (path.includes("/imei-registrations")) return { resource: "imei", label: "Registrasi IMEI" };
  if (path.includes("/imei-details")) return { resource: "imei", label: "Detail IMEI" };
  if (path.includes("/imei-integrity")) return { resource: "imei", label: "Integritas Data IMEI" };
  if (path.includes("/devices")) return { resource: "devices", label: "Master Perangkat HKT" };
  if (path.includes("/passengers") || path.includes("/passenger")) return { resource: "passengers", label: "Manifes Penumpang" };
  if (path.includes("/manifests") || path.includes("/ceisa")) return { resource: "manifests", label: "Manifes Penerbangan" };
  if (path.includes("/price-intel")) return { resource: "prices", label: "Referensi Harga HKT" };
  if (path.includes("/admin/users")) return { resource: "users", label: "Manajemen Pengguna" };
  if (path.includes("/pmi")) return { resource: "pmi", label: "Data Pekerja Migran (PMI)" };
  if (path.includes("/pbc")) return { resource: "pbc", label: "Master Petugas & IKI PBC" };
  if (path.includes("/qsvm")) return { resource: "qsvm", label: "Deteksi Under-Invoicing QSVM" };
  if (path.includes("/hs-codes") || path.includes("/hs")) return { resource: "hscodes", label: "Klasifikasi HS Code" };
  if (path.includes("/flights")) return { resource: "flights", label: "Radar Penerbangan" };
  if (path.includes("/reports")) return { resource: "reports", label: "Laporan Intelijen" };
  if (path.includes("/auth")) return { resource: "auth", label: "Autentikasi & Sesi" };

  return { resource: "general", label: "Operasional Sistem" };
}

/**
 * Sanitasi payload agar informasi sensitif tidak tercatat di audit log
 */
function sanitizePayload(body) {
  if (!body || typeof body !== "object") return null;
  const clone = Array.isArray(body) ? [...body] : { ...body };
  const sensitiveKeys = ["password", "token", "reset_token", "verification_token", "secret", "apiKey"];

  for (const key of Object.keys(clone)) {
    if (sensitiveKeys.includes(key.toLowerCase())) {
      clone[key] = "[REDACTED]";
    } else if (typeof clone[key] === "object" && clone[key] !== null) {
      // Ringkas objek anak agar tidak membebani ukuran DB
      clone[key] = "[Object]";
    } else if (typeof clone[key] === "string" && clone[key].length > 150) {
      clone[key] = clone[key].substring(0, 150) + "...";
    }
  }
  return clone;
}

function auditLogger(req, res, next) {
  const isMutation = MUTATION_METHODS.has(req.method);
  const isExport = req.path.includes("/export") || req.path.includes("/download");

  // Hanya proses mutasi data atau permintaan ekspor
  if (!isMutation && !isExport) return next();
  if (SKIP_PATHS.some((p) => req.path.startsWith(p))) return next();

  const start = Date.now();
  const ip =
    req.ip ||
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  // Capture response finish event
  res.on("finish", () => {
    // Lewati jika rute auth sudah menangani lognya sendiri
    if (AUTH_SELF_LOGGED.has(req.path)) return;

    const latency = Date.now() - start;
    const { resource, label } = detectResource(req.originalUrl || req.path);

    // Tentukan tipe action
    let action = "api_access";
    let category = "CRUD";

    if (isExport) {
      action = "export";
      category = "EXPORT";
    } else if (req.method === "POST") {
      action = req.path.includes("/import") ? "import" : "create";
    } else if (req.method === "PUT" || req.method === "PATCH") {
      action = "update";
    } else if (req.method === "DELETE") {
      action = "delete";
    }

    if (req.path.startsWith("/api/auth")) {
      category = "AUTH";
    }

    // Ambil identifier resource bila ada di URL (e.g., /api/devices/65f...)
    const pathParts = (req.originalUrl || req.path).split("?")[0].split("/").filter(Boolean);
    const lastPart = pathParts[pathParts.length - 1];
    const resourceId = /^[0-9a-fA-F]{24}$/.test(lastPart) || /^\d+$/.test(lastPart) ? lastPart : null;

    // Ambil nama resource dari body jika ada
    const resourceName = req.body?.nama || req.body?.full_name || req.body?.model || req.body?.brand || req.body?.merk || null;

    // Susun keterangan yang mudah dipahami inspektur/auditor
    const actionVerbs = {
      create: "Menambahkan data",
      update: "Memperbarui data",
      delete: "Menghapus data",
      import: "Mengimpor data",
      export: "Mengekspor data",
      api_access: "Akses mutasi API",
    };

    const verb = actionVerbs[action] || action;
    const detail = `${verb} pada ${label}${resourceId ? ` (ID: ${resourceId})` : ""}${resourceName ? ` [${resourceName}]` : ""} — Status: ${res.statusCode}`;

    // Tentukan status log
    let logStatus = "success";
    if (res.statusCode >= 500) {
      logStatus = "failed";
    } else if (res.statusCode === 401 || res.statusCode === 403) {
      logStatus = "blocked";
    } else if (res.statusCode >= 400) {
      logStatus = "warning";
    }

    // User info didapat dari req.user (yang disematkan oleh auth middleware)
    const user = req.user || null;
    const safePayload = sanitizePayload(req.body);

    // Asynchronous non-blocking save to MongoDB
    setImmediate(() => {
      ActivityLog.create({
        user_id: user?._id || user?.id || null,
        email: user?.email || (req.path.startsWith("/api/auth") ? req.body?.email : "guest/unauthenticated"),
        full_name: user?.full_name || (user ? user.email : "Tamu"),
        nip: user?.nip || "",
        unit_kerja: user?.unit_kerja || "",
        role: user?.role || "anonymous",
        action,
        category,
        resource,
        resource_id: resourceId,
        resource_name: resourceName,
        method: req.method,
        path: req.originalUrl || req.url,
        status_code: res.statusCode,
        latency_ms: latency,
        payload_summary: safePayload,
        detail,
        ip,
        user_agent: req.headers["user-agent"] || "",
        status: logStatus,
      }).catch((err) => {
        console.error("[AUDIT] Gagal menyimpan log aktivitas:", err.message);
      });
    });

    console.log(
      `[AUDIT] ${req.method} ${req.originalUrl} | User:${user?.email || "anon"} | IP:${ip} | ${res.statusCode} | ${latency}ms`
    );
  });

  next();
}

module.exports = { auditLogger };
