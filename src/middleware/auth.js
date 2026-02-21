/**
 * SkyGuard Authentication Middleware
 * 
 * Basic API key authentication for write operations.
 * API key is set via SKYGUARD_API_KEY environment variable.
 * 
 * Usage in routes:
 *   const { requireAuth, optionalAuth } = require('../middleware/auth');
 *   router.post('/upload', requireAuth, handler);
 */

const API_KEY_HEADER = 'x-api-key';
const API_KEY_QUERY = 'api_key';

/**
 * Extract API key from request (header or query param)
 */
function extractApiKey(req) {
  return req.headers[API_KEY_HEADER] || req.query[API_KEY_QUERY] || null;
}

/**
 * Require valid API key for write operations (POST, PUT, DELETE)
 * If SKYGUARD_API_KEY is not set, all requests are allowed (dev mode)
 */
function requireAuth(req, res, next) {
  const configuredKey = process.env.SKYGUARD_API_KEY;
  
  // If no API key configured, allow all (dev mode)
  if (!configuredKey) {
    req.authenticated = true;
    req.authMode = 'dev';
    return next();
  }
  
  const providedKey = extractApiKey(req);
  
  if (!providedKey) {
    return res.status(401).json({ 
      status: 'error', 
      message: 'Authentication required. Provide API key via x-api-key header.' 
    });
  }
  
  if (providedKey !== configuredKey) {
    return res.status(403).json({ 
      status: 'error', 
      message: 'Invalid API key.' 
    });
  }
  
  req.authenticated = true;
  req.authMode = 'api_key';
  next();
}

/**
 * Optional auth — sets req.authenticated but doesn't block
 */
function optionalAuth(req, res, next) {
  const configuredKey = process.env.SKYGUARD_API_KEY;
  
  if (!configuredKey) {
    req.authenticated = true;
    req.authMode = 'dev';
    return next();
  }
  
  const providedKey = extractApiKey(req);
  req.authenticated = providedKey === configuredKey;
  req.authMode = req.authenticated ? 'api_key' : 'none';
  next();
}

module.exports = { requireAuth, optionalAuth };
