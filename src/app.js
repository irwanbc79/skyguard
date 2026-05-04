require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const compression = require("compression");
const rateLimit = require("express-rate-limit");

const { auditLogger } = require("./middleware/audit");

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions =
  allowedOrigins.length > 0
    ? {
        origin(origin, callback) {
          if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
          }
          callback(new Error("CORS blocked"));
        },
        credentials: true,
      }
    : {};

// Security & Optimization Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(corsOptions));
app.use(compression()); // Compress responses (Gzip/Brotli)

// Rate Limiting — global (ringan)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: "error", message: "Too many requests, please try again later." },
});

// Rate Limiting — ketat untuk operasi berat (QSVM, analytics, parsing)
const heavyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: "error", message: "Too many heavy requests, please wait." },
});

app.use("/api/", limiter);
app.use("/api/qsvm/scan", heavyLimiter);
app.use("/api/imei-registrations/analytics", heavyLimiter);
app.use("/api/manifests/parse", heavyLimiter);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(auditLogger);
app.use(express.static(path.join(__dirname, "../public")));
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// ─── Auth Routes (public — no JWT required) ───────────────────────────────────
app.use("/api/auth", require("./routes/auth"));

// Serve login page
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/login.html"));
});

// ─── JWT Auth Middleware — protects all /api/* except auth & health ───────────
const { verifyJwt } = require("./services/authService");
const User = require("./models/User");

app.use("/api", async (req, res, next) => {
  // Skip auth for public paths
  if (
    req.path.startsWith("/auth/") ||
    req.path === "/health" ||
    req.path === "/kantor-list" ||
    req.path.startsWith("/flights/")   // FIDS public display board
  ) {
    return next();
  }
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ status: "error", message: "Token tidak ditemukan. Silakan login." });
  }
  try {
    const payload = verifyJwt(header.slice(7));
    const user = await User.findById(payload.id).select("_id email role is_active").lean();
    if (!user) {
      return res.status(401).json({ status: "error", message: "Token tidak valid atau sudah kadaluarsa. Silakan login ulang." });
    }
    if (!user.is_active) {
      return res.status(403).json({ status: "error", code: "ACCOUNT_DISABLED", message: "Akun Anda telah dinonaktifkan. Hubungi administrator." });
    }
    req.user = user;
    // Update last_seen (max once per minute to avoid excessive writes)
    const now = Date.now();
    User.updateOne(
      { _id: user._id, $or: [{ last_seen: { $lt: new Date(now - 60000) } }, { last_seen: { $exists: false } }] },
      { $set: { last_seen: new Date(now) } }
    ).catch(() => {});
    next();
  } catch {
    return res.status(401).json({ status: "error", message: "Token tidak valid atau sudah kadaluarsa. Silakan login ulang." });
  }
});

// Routes
const deviceRoutes = require("./routes/devices");
const kursRoutes = require("./routes/kurs");
const passengerRoutes = require("./routes/passenger");
const cargoRoutes = require("./routes/cargo");
const manifestRoutes = require("./routes/manifests");

app.use("/api/devices", deviceRoutes);
app.use("/api/passengers", require("./routes/passengers"));
app.use("/api/cargo", cargoRoutes);
app.use("/api/kurs", kursRoutes);
app.use("/api/passenger", passengerRoutes);
app.use("/api/manifests", manifestRoutes);
app.use("/api/dashboard", require("./routes/dashboard"));
app.use("/api/reports", require("./routes/reports"));

// HS Codes route
app.use("/api/hs-codes", require("./routes/hscodes"));
app.use("/api/hs", require("./routes/hscodes"));

// Flight Radar routes
app.use("/api/flights", require("./routes/flights"));

// Suspect watchlist routes
app.use("/api/suspects", require("./routes/suspects"));

// Notification routes
app.use("/api/notifications", require("./routes/notifications"));

// Intelligence Radar routes
app.use("/api/intelligence", require("./routes/intelligence"));

// IMEI Registration routes
app.use("/api/imei-registrations", require("./routes/imei-registrations"));

// IMEI Detail routes (device-level intelligence)
app.use("/api/imei-details", require("./routes/imei-details"));

// IMEI Data Integrity & Consistency routes
app.use("/api/imei-integrity", require("./routes/imei-integrity"));

// Price Intelligence routes (smart reference for officers)
app.use("/api/price-intel", require("./routes/price-intel"));

// Scraper Bridge routes (browser-to-server CEISA data import)
app.use("/api/scraper", require("./routes/scraper"));

// CEISA Manifest Import (List Pengangkut)
app.use("/api/ceisa", require("./routes/ceisa"));

// Unified Passport Search (Pencarian Terpadu)
app.use("/api/unified", require("./routes/unified"));

// Intelligence Center (Pusat Intelijen)
app.use("/api/intel", require("./routes/intel"));

// Quantum SVM Under-Invoicing Detection
app.use("/api/qsvm", require("./routes/qsvm"));

// PMI Record — manajemen data PMI terverifikasi
app.use("/api/pmi", require("./routes/pmi"));

// PBC — Master Petugas, Upload Data Pendukung IKI
app.use("/api/pbc", require("./routes/pbc"));

// Admin: User Management
app.use("/api/admin", require("./routes/admin-users"));

app.get("/api/health", (req, res) => {
  const isDbUp = mongoose.connection.readyState === 1;
  const pkg = require("../package.json");
  res.status(isDbUp ? 200 : 503).json({
    status: isDbUp ? "ok" : "degraded",
    db: isDbUp ? "connected" : "disconnected",
    uptime_sec: Math.floor(process.uptime()),
    memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    version: pkg.version || "1.0.0",
    app: pkg.name,
    timestamp: new Date(),
  });
});

// Endpoint lookup kode kantor — berguna untuk frontend autocomplete
app.get("/api/kantor-list", (req, res) => {
  const { KANTOR_MAP } = require("./utils/constants");
  const q = (req.query.q || "").toLowerCase().trim();
  const list = Object.entries(KANTOR_MAP)
    .map(([kode, nama]) => ({ kode, nama }))
    .filter((k) => !q || k.kode.includes(q) || k.nama.toLowerCase().includes(q));
  res.json({ status: "ok", data: list, total: list.length });
});

// Global error handler — tangani jenis error umum secara spesifik
app.use((err, req, res, next) => {
  // Multer: file upload error
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ status: "error", message: "File terlalu besar (maks 10MB)" });
  }
  if (err.message && err.message.includes("Only image files")) {
    return res.status(415).json({ status: "error", message: err.message });
  }
  // Mongoose validation error
  if (err.name === "ValidationError") {
    const fields = Object.keys(err.errors).join(", ");
    return res.status(422).json({ status: "error", message: `Validasi gagal: ${fields}`, errors: err.errors });
  }
  // Mongoose CastError (ObjectId tidak valid)
  if (err.name === "CastError") {
    return res.status(400).json({ status: "error", message: "Format ID tidak valid" });
  }
  // MongoDB duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {}).join(", ");
    return res.status(409).json({ status: "error", message: `Data duplikat pada field: ${field}` });
  }
  // CORS
  if (err.message === "CORS blocked") {
    return res.status(403).json({ status: "error", message: "Origin tidak diizinkan" });
  }

  console.error("[ERROR]", err.message, err.stack);
  res.status(500).json({ status: "error", message: "Internal server error" });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Flight Board FIDS display (standalone monitoring page)
app.get("/flight-board", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/flight-board.html"));
});

if (!process.env.MONGODB_URI) {
  console.error("[STARTUP] MONGODB_URI is not set");
  process.exit(1);
}

let server;

async function shutdown(signal) {
  console.log(`[SHUTDOWN] Signal received: ${signal}`);
  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await mongoose.connection.close(false);
    console.log("[SHUTDOWN] Graceful shutdown complete");
    process.exit(0);
  } catch (error) {
    console.error("[SHUTDOWN] Error during shutdown:", error.message);
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED_REJECTION]", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[UNCAUGHT_EXCEPTION]", error);
  shutdown("uncaughtException");
});

mongoose
  .connect(process.env.MONGODB_URI, {
    maxPoolSize: 30,
    minPoolSize: 5,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    autoIndex: false,
  })
  .then(() => {
    console.log("MongoDB connected");
    const { initKurs } = require("./services/kursService");
    initKurs();
    const { initManifestInbox } = require("./services/manifestInboxService");
    initManifestInbox();
    const { startPolling } = require("./services/flightService");
    startPolling();
    // Initial cargo-suspect scan on startup
    const {
      scanAllCargoForSuspects,
    } = require("./services/notificationService");
    scanAllCargoForSuspects().catch((e) =>
      console.error("[STARTUP] Cargo scan error:", e.message),
    );
    const PORT = process.env.PORT || 3000;
    server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB error:", err);
    process.exit(1);
  });
