/**
 * Simple API-key authentication middleware.
 * 
 * Set SKYGUARD_API_KEY in .env to enable.
 * When the env variable is not set, all requests are allowed (development mode).
 * 
 * Usage:
 *   const { requireAuth, optionalAuth } = require('../middleware/auth');
 *   router.post('/sensitive', requireAuth, handler);
 */

const API_KEY = process.env.SKYGUARD_API_KEY;

function extractKey(req) {
  const header = req.headers['x-api-key'] || req.headers['authorization'];
  if (!header) return null;
  // Support "Bearer <key>" or plain key
  return header.startsWith('Bearer ') ? header.slice(7) : header;
}

/**
 * Reject the request if no valid API key is provided.
 * When SKYGUARD_API_KEY is not configured, all requests pass through (dev mode).
 */
function requireAuth(req, res, next) {
  if (!API_KEY) return next(); // dev mode – no key configured
  const provided = extractKey(req);
  if (provided === API_KEY) return next();
  return res.status(401).json({ status: 'error', message: 'Unauthorized – invalid or missing API key' });
}

/**
 * Attach `req.authenticated = true/false` without blocking.
 */
function optionalAuth(req, _res, next) {
  req.authenticated = !API_KEY || extractKey(req) === API_KEY;
  next();
}

module.exports = { requireAuth, optionalAuth };
