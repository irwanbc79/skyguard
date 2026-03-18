/**
 * Audit Logging Middleware
 *
 * Mencatat semua operasi mutasi (POST, PUT, PATCH, DELETE) ke console
 * dalam format terstruktur. Berguna untuk forensik dan audit trail.
 *
 * Format: [AUDIT] METHOD /path | IP | status | latency_ms | body_keys
 */

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Path yang tidak perlu di-audit (terlalu sering / tidak informatif)
const SKIP_PATHS = ["/api/health", "/api/notifications/unread-count"];

function auditLogger(req, res, next) {
  if (!MUTATION_METHODS.has(req.method)) return next();
  if (SKIP_PATHS.some((p) => req.path.startsWith(p))) return next();

  const start = Date.now();
  const ip =
    req.ip ||
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    "unknown";

  // Capture response finish to log status code + latency
  res.on("finish", () => {
    const latency = Date.now() - start;
    const bodyKeys = req.body && typeof req.body === "object"
      ? Object.keys(req.body).join(",")
      : "";

    console.log(
      `[AUDIT] ${req.method} ${req.originalUrl} | IP:${ip} | ${res.statusCode} | ${latency}ms` +
        (bodyKeys ? ` | fields:${bodyKeys}` : ""),
    );
  });

  next();
}

module.exports = { auditLogger };
