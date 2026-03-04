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

module.exports = {
  escapeRegex,
  sanitizeHtml,
  sanitizeCsv,
  parsePagination,
  extractPdfText,
  isValidObjectId,
};
