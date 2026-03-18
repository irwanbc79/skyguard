function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Sanitize HTML to prevent XSS
function sanitizeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// Sanitize CSV field to prevent formula injection
function sanitizeCsv(val) {
  if (!val) return "";
  const s = String(val);
  if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
}

// Parse pagination params safely
function parsePagination(query, defaults = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || defaults.page || 1);
  const limit = Math.min(
    200,
    Math.max(1, parseInt(query.limit, 10) || defaults.limit || 50),
  );
  return { page, limit, skip: (page - 1) * limit };
}

// Validate MongoDB ObjectId (24 hex chars)
function isValidObjectId(id) {
  if (!id || typeof id !== "string") return false;
  return /^[a-fA-F0-9]{24}$/.test(id);
}

// PDF text extraction using pdf-parse v1
async function extractPdfText(buffer) {
  try {
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(buffer);
    return data.text || "";
  } catch (err) {
    console.warn("[extractPdfText] PDF parse gagal:", err.message);
    return "";
  }
}

/**
 * Validasi format nomor paspor Indonesia & internasional umum.
 * Mendukung: paspor RI (A-Z + 7 digit), paspor umum internasional.
 * @param {string} str
 * @returns {boolean}
 */
function isValidPassportNumber(str) {
  if (!str || typeof str !== "string") return false;
  const s = str.trim();
  return s.length >= 6 && s.length <= 20 && /^[A-Z0-9]+$/i.test(s);
}

/**
 * Bersihkan input string dari karakter kontrol dan whitespace berlebih.
 * @param {string} str
 * @returns {string}
 */
function sanitizeInput(str) {
  if (!str || typeof str !== "string") return "";
  // hapus karakter kontrol, normalize whitespace
  return str.replace(/[\x00-\x1F\x7F]/g, "").trim().replace(/\s+/g, " ");
}

/**
 * Buat date range filter MongoDB dari query string.
 * @param {string} dateFrom - YYYY-MM-DD
 * @param {string} dateTo - YYYY-MM-DD
 * @returns {object|null} MongoDB date filter atau null jika tidak ada input
 */
function buildDateRangeFilter(dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return null;
  const filter = {};
  if (dateFrom) {
    const d = new Date(dateFrom);
    if (!isNaN(d)) filter.$gte = d;
  }
  if (dateTo) {
    const d = new Date(dateTo + "T23:59:59.999Z");
    if (!isNaN(d)) filter.$lte = d;
  }
  return Object.keys(filter).length > 0 ? filter : null;
}

module.exports = {
  escapeRegex,
  sanitizeHtml,
  sanitizeCsv,
  sanitizeInput,
  parsePagination,
  extractPdfText,
  isValidObjectId,
  isValidPassportNumber,
  buildDateRangeFilter,
};
