import * as crypto from 'node:crypto'
import { getLogger } from '../utils/logger.js'

const logger = getLogger('csrf-service')

/**
 * CSRF Token Service
 *
 * Provides cryptographically secure CSRF token generation, signing, and validation
 * using HMAC-SHA256 for token integrity.
 *
 * Security features:
 * - Crypto.randomBytes(32) for token generation
 * - HMAC-SHA256 for token signing
 * - Constant-time comparison to prevent timing attacks
 * - Token rotation support
 * - Session association
 */

export interface CsrfToken {
  token: string
  signature: string
  expiresAt: number
  sessionId?: string
}

export interface CsrfConfig {
  secret: string
  tokenLength: number
  expirationMs: number
}

/** Maximum number of tokens to store before evicting oldest */
const MAX_TOKENS = 10000

export class CsrfService {
  private readonly secret: Buffer
  private readonly tokenLength: number
  private readonly expirationMs: number
  private readonly tokenStore: Map<string, CsrfToken>
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: CsrfConfig) {
    // Ensure secret is at least 32 bytes for security
    if (config.secret.length < 32) {
      throw new Error('CSRF secret must be at least 32 characters')
    }

    this.secret = Buffer.from(config.secret, 'utf8')
    this.tokenLength = config.tokenLength
    this.expirationMs = config.expirationMs
    this.tokenStore = new Map()

    // Cleanup expired tokens periodically
    this.cleanupTimer = setInterval(() => this.cleanupExpiredTokens(), 60000) // Every minute
  }

  /**
   * Generate a cryptographically secure CSRF token.
   *
   * @param sessionId - Optional session identifier for token association
   * @returns CSRF token with signature and expiration
   */
  generateToken(sessionId?: string): CsrfToken {
    // Generate random token using crypto.randomBytes
    const tokenBytes = crypto.randomBytes(this.tokenLength)
    const token = tokenBytes.toString('base64url')

    // Create expiration timestamp
    const expiresAt = Date.now() + this.expirationMs

    // Sign the token using HMAC-SHA256
    const signature = this.signToken(token, expiresAt, sessionId)

    const csrfToken: CsrfToken = {
      token,
      signature,
      expiresAt,
      sessionId,
    }

    // Enforce token store limit to prevent DoS
    if (this.tokenStore.size >= MAX_TOKENS) {
      // LRU eviction: remove oldest token (first entry in Map)
      const firstKey = this.tokenStore.keys().next().value
      if (firstKey) {
        this.tokenStore.delete(firstKey)
      }
    }

    // Store token for validation
    this.tokenStore.set(token, csrfToken)

    return csrfToken
  }

  /**
   * Validate a CSRF token using constant-time comparison.
   *
   * @param token - Token to validate
   * @param signature - Expected signature
   * @param sessionId - Optional session identifier for validation
   * @returns True if token is valid and not expired
   */
  validateToken(token: string, signature: string, sessionId?: string): boolean {
    // Retrieve stored token
    const storedToken = this.tokenStore.get(token)

    if (!storedToken) {
      return false
    }

    // Check expiration
    if (Date.now() > storedToken.expiresAt) {
      this.tokenStore.delete(token)
      return false
    }

    // Verify session association if provided
    if (sessionId && storedToken.sessionId !== sessionId) {
      return false
    }

    // Verify signature using constant-time comparison
    const expectedSignature = this.signToken(token, storedToken.expiresAt, storedToken.sessionId)

    return this.constantTimeCompare(signature, expectedSignature)
  }

  /**
   * Rotate a token (invalidate old, generate new).
   *
   * @param oldToken - Token to invalidate
   * @param sessionId - Optional session identifier
   * @returns New CSRF token
   */
  rotateToken(oldToken: string, sessionId?: string): CsrfToken {
    // Invalidate old token
    this.tokenStore.delete(oldToken)

    // Generate new token
    return this.generateToken(sessionId)
  }

  /**
   * Sign a token using HMAC-SHA256.
   *
   * @param token - Token to sign
   * @param expiresAt - Expiration timestamp
   * @param sessionId - Optional session identifier
   * @returns HMAC signature
   */
  private signToken(token: string, expiresAt: number, sessionId?: string): string {
    const hmac = crypto.createHmac('sha256', this.secret)

    // Include token, expiration, and optional session in signature
    hmac.update(token)
    hmac.update(String(expiresAt))

    if (sessionId) {
      hmac.update(sessionId)
    }

    return hmac.digest('base64url')
  }

  /**
   * Constant-time string comparison to prevent timing attacks.
   *
   * @param a - First string
   * @param b - Second string
   * @returns True if strings are equal
   */
  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false

    try {
      return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
    } catch {
      return false
    }
  }

  private cleanupExpiredTokens(): void {
    const now = Date.now()
    let cleanedCount = 0

    for (const [token, csrfToken] of this.tokenStore) {
      if (now > csrfToken.expiresAt) {
        this.tokenStore.delete(token)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      logger.debug('Cleaned up expired tokens', { cleanedCount })
    }
  }

  /** Get token count (for monitoring) */
  getTokenCount(): number {
    return this.tokenStore.size
  }

  /** Clear all tokens (for testing) */
  clearTokens(): void {
    this.tokenStore.clear()
  }

  /** Release resources */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    this.tokenStore.clear()
  }
}

/** Create a CSRF service instance with default or custom configuration */
export function createCsrfService(config?: Partial<CsrfConfig>): CsrfService {
  const secret = config?.secret || process.env.CSRF_SECRET || generateDefaultSecret()

  const defaultConfig: CsrfConfig = {
    secret,
    tokenLength: 32, // 32 bytes = 256 bits
    expirationMs: 60 * 60 * 1000, // 1 hour
  }

  return new CsrfService({ ...defaultConfig, ...config })
}

/** Generate a default secret for development. WARNING: Never use in production. */
function generateDefaultSecret(): string {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CSRF_SECRET environment variable must be set in production. Generate a secure secret using: openssl rand -base64 48'
    )
  }

  logger.warn('Using generated CSRF secret for development - set CSRF_SECRET in production')
  return crypto.randomBytes(48).toString('base64')
}
