function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitize string for HTML output — prevents XSS
 */
function sanitizeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Sanitize value for CSV output — prevents CSV injection
 */
function sanitizeCsv(val) {
  if (typeof val !== 'string') return val;
  // Prevent formula injection
  if (/^[=+\-@\t\r]/.test(val)) {
    return "'" + val;
  }
  return val;
}

/**
 * Validate and sanitize pagination params
 */
function parsePagination(query, defaults = { page: 1, limit: 20, maxLimit: 100 }) {
  let page = parseInt(query.page) || defaults.page;
  let limit = parseInt(query.limit) || defaults.limit;
  page = Math.max(1, page);
  limit = Math.min(Math.max(1, limit), defaults.maxLimit);
  return { page, limit, skip: (page - 1) * limit };
}

module.exports = { escapeRegex, sanitizeHtml, sanitizeCsv, parsePagination };
