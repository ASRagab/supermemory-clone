import { Context, MiddlewareHandler } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { createCsrfService, CsrfService } from '../../services/csrf.service.js'
import { ErrorCodes } from '../../types/api.types.js'
import { getLogger } from '../../utils/logger.js'

const logger = getLogger('csrf-middleware')

/**
 * CSRF Protection Middleware for Hono
 *
 * Implements double-submit cookie pattern with:
 * - Cryptographically secure token generation
 * - HMAC-SHA256 signing
 * - Constant-time comparison
 * - SameSite=Strict cookies
 * - Origin/Referer validation
 * - Safe method exemption (GET, HEAD, OPTIONS)
 *
 * Security features:
 * - Secure flag in production
 * - HttpOnly flag always
 * - Origin whitelist validation
 * - 403 Forbidden for CSRF failures
 */

export interface CsrfConfig {
  cookieName?: string
  headerName?: string
  allowedOrigins?: string[]
  exemptMethods?: string[]
  cookieOptions?: {
    secure?: boolean
    httpOnly?: boolean
    sameSite?: 'Strict' | 'Lax' | 'None'
    maxAge?: number
  }
}

const DEFAULT_CONFIG: Required<CsrfConfig> = {
  cookieName: '_csrf',
  headerName: 'X-CSRF-Token',
  allowedOrigins: [],
  exemptMethods: ['GET', 'HEAD', 'OPTIONS'],
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'Strict',
    maxAge: 60 * 60, // 1 hour in seconds
  },
}

// Global CSRF service instance
let csrfService: CsrfService | null = null

/**
 * Get or create the global CSRF service instance.
 */
function getCsrfService(): CsrfService {
  if (!csrfService) {
    csrfService = createCsrfService()
  }
  return csrfService
}

/**
 * CSRF protection middleware.
 * Validates CSRF tokens for state-changing requests.
 */
export const csrfProtection = (config: CsrfConfig = {}): MiddlewareHandler => {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const service = getCsrfService()

  return async (c: Context, next) => {
    const method = c.req.method.toUpperCase()

    // Exempt safe methods (GET, HEAD, OPTIONS)
    if (cfg.exemptMethods.includes(method)) {
      return next()
    }

    // Validate origin/referer for non-exempted methods
    if (!validateOrigin(c, cfg.allowedOrigins)) {
      return c.json(
        {
          error: {
            code: ErrorCodes.FORBIDDEN,
            message: 'Invalid origin or referer',
          },
          status: 403,
        },
        403
      )
    }

    // Get token from cookie
    const cookieToken = getCookie(c, cfg.cookieName)

    if (!cookieToken) {
      return c.json(
        {
          error: {
            code: ErrorCodes.FORBIDDEN,
            message: 'CSRF token missing in cookie',
          },
          status: 403,
        },
        403
      )
    }

    // Parse cookie token (format: token:signature)
    const cookieParts = cookieToken.split(':')
    if (cookieParts.length !== 2) {
      return c.json(
        {
          error: {
            code: ErrorCodes.FORBIDDEN,
            message: 'Invalid CSRF token format',
          },
          status: 403,
        },
        403
      )
    }

    const [cookieTokenValue, cookieSignature] = cookieParts

    // Get token from header or form data
    let headerToken = c.req.header(cfg.headerName)

    // If not in header, try to get from form data (for traditional forms)
    if (!headerToken && c.req.header('content-type')?.includes('application/x-www-form-urlencoded')) {
      try {
        const body = await c.req.parseBody()
        headerToken = body._csrf as string
      } catch {
        // Ignore parsing errors
      }
    }

    if (!headerToken) {
      return c.json(
        {
          error: {
            code: ErrorCodes.FORBIDDEN,
            message: 'CSRF token missing in request',
          },
          status: 403,
        },
        403
      )
    }

    // Validate token (double-submit pattern: cookie token must match header token)
    if (cookieTokenValue !== headerToken) {
      return c.json(
        {
          error: {
            code: ErrorCodes.FORBIDDEN,
            message: 'CSRF token mismatch',
          },
          status: 403,
        },
        403
      )
    }

    // Validate token signature and expiration
    const isValid = service.validateToken(headerToken, cookieSignature ?? '')

    if (!isValid) {
      return c.json(
        {
          error: {
            code: ErrorCodes.FORBIDDEN,
            message: 'Invalid or expired CSRF token',
          },
          status: 403,
        },
        403
      )
    }

    // Token is valid, proceed with request
    return next()
  }
}

/**
 * Middleware to set CSRF cookie for clients.
 * Should be applied before CSRF protection middleware.
 */
export const setCsrfCookie = (config: CsrfConfig = {}): MiddlewareHandler => {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const service = getCsrfService()

  return async (c: Context, next) => {
    const issueCsrfCookie = (): void => {
      const csrfToken = service.generateToken()
      const cookieValue = `${csrfToken.token}:${csrfToken.signature}`

      setCookie(c, cfg.cookieName, cookieValue, {
        httpOnly: cfg.cookieOptions.httpOnly,
        secure: cfg.cookieOptions.secure,
        sameSite: cfg.cookieOptions.sameSite,
        maxAge: cfg.cookieOptions.maxAge,
        path: '/',
      })

      c.set('csrfToken', csrfToken.token)
    }

    // Check if cookie already exists
    const existingCookie = getCookie(c, cfg.cookieName)

    if (!existingCookie) {
      issueCsrfCookie()
    } else {
      const [token, signature, ...remainder] = existingCookie.split(':')
      const hasValidFormat = remainder.length === 0 && !!token && !!signature

      if (!hasValidFormat) {
        issueCsrfCookie()
      } else {
        // Extract token from existing cookie
        c.set('csrfToken', token)
      }
    }

    return next()
  }
}

/**
 * Validate request origin/referer against whitelist.
 *
 * @param c - Hono context
 * @param allowedOrigins - List of allowed origins
 * @returns True if origin is valid
 */
function validateOrigin(c: Context, allowedOrigins: string[]): boolean {
  // If no whitelist is configured, skip validation
  if (allowedOrigins.length === 0) {
    return true
  }

  // Get origin from Origin or Referer header
  const origin = c.req.header('origin')
  const referer = c.req.header('referer')

  // If neither header is present, require explicit opt-in
  if (!origin && !referer) {
    // Explicit opt-in for missing origin/referer (dev/test environments)
    // Use environment variable CSRF_ALLOW_MISSING_ORIGIN=true to enable
    const allowMissing = process.env.CSRF_ALLOW_MISSING_ORIGIN === 'true'

    if (!allowMissing && process.env.NODE_ENV === 'production') {
      logger.warn('Blocked request with missing Origin and Referer headers in production')
      return false
    }

    if (allowMissing && process.env.NODE_ENV !== 'production') {
      logger.debug('Allowing request with missing Origin/Referer (dev mode)')
      return true
    }

    return false
  }

  // Validate origin
  if (origin && allowedOrigins.includes(origin)) {
    return true
  }

  // Validate referer (extract origin from referer URL)
  if (referer) {
    try {
      const refererUrl = new URL(referer)
      const refererOrigin = `${refererUrl.protocol}//${refererUrl.host}`

      if (allowedOrigins.includes(refererOrigin)) {
        return true
      }
    } catch {
      // Invalid referer URL
      return false
    }
  }

  return false
}

/**
 * Extend Hono context to include CSRF token.
 */
declare module 'hono' {
  interface ContextVariableMap {
    csrfToken?: string
  }
}

/**
 * Helper to get CSRF token from context (for rendering in templates).
 */
export function getCsrfToken(c: Context): string | undefined {
  return c.get('csrfToken')
}
