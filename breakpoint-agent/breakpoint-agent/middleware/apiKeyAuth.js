// Optional API-key authentication.
//
// Behaviour is opt-in: when the API_KEY environment variable is NOT set, the
// middleware is a no-op and the API stays open (useful for local development).
// When API_KEY is set, every request must present a matching key via either:
//   - "x-api-key: <key>" header, or
//   - "Authorization: Bearer <key>" header
//
// Multiple comma-separated keys are supported in API_KEY.

function getConfiguredKeys() {
  const raw = process.env.API_KEY || ''
  return raw
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)
}

export function apiKeyEnabled() {
  return getConfiguredKeys().length > 0
}

function extractKey(req) {
  const headerKey = req.headers['x-api-key']
  if (headerKey) return String(headerKey).trim()

  const auth = req.headers['authorization']
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim()
  }
  return null
}

export function apiKeyAuth(req, res, next) {
  const keys = getConfiguredKeys()

  // Auth disabled — allow everything.
  if (keys.length === 0) return next()

  const provided = extractKey(req)

  if (!provided) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'MISSING_API_KEY',
        message: 'API key required. Provide it via the "x-api-key" header or "Authorization: Bearer <key>".',
        status: 401
      }
    })
  }

  if (!keys.includes(provided)) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'INVALID_API_KEY',
        message: 'The provided API key is invalid.',
        status: 403
      }
    })
  }

  return next()
}
