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
  const page = Math.max(1, parseInt(query.page) || defaults.page || 1);
  const limit = Math.min(
    200,
    Math.max(1, parseInt(query.limit) || defaults.limit || 50),
  );
  return { page, limit, skip: (page - 1) * limit };
}

// PDF text extraction — compatible with pdf-parse v1 and v2
async function extractPdfText(buffer) {
  try {
    const pdfMod = require("pdf-parse");
    // pdf-parse v1: module exports a function directly
    if (typeof pdfMod === "function") {
      const data = await pdfMod(buffer);
      return data.text || "";
    }
    // pdf-parse v2: module exports { PDFParse, ... }
    if (pdfMod.PDFParse) {
      const parser = new pdfMod.PDFParse();
      const data = await parser.parse(buffer);
      return data.text || "";
    }
    // pdf-parse v2 default export
    if (typeof pdfMod.default === "function") {
      const data = await pdfMod.default(buffer);
      return data.text || "";
    }
    console.warn(
      "[extractPdfText] Unknown pdf-parse API. Keys:",
      Object.keys(pdfMod),
    );
    return "";
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
};
