require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const compression = require("compression");
const rateLimit = require("express-rate-limit");

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

// Rate Limiting (Global)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Limit each IP to 500 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    status: "error",
    message: "Too many requests, please try again later.",
  },
});
app.use("/api/", limiter);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(express.static(path.join(__dirname, "../public")));
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

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

app.get("/api/health", (req, res) => {
  const isDbUp = mongoose.connection.readyState === 1;
  res.status(isDbUp ? 200 : 503).json({
    status: isDbUp ? "ok" : "degraded",
    db: isDbUp ? "connected" : "disconnected",
    uptime_sec: Math.floor(process.uptime()),
    timestamp: new Date(),
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("[ERROR]", err.message);
  res.status(500).json({ status: "error", message: "Internal server error" });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
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
