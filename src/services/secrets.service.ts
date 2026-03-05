/**
 * Secrets Management Service
 *
 * Handles secure storage, validation, rotation, and lifecycle management of secrets.
 *
 * Security Features:
 * - AES-256-GCM encryption at rest
 * - PBKDF2 key derivation with salt
 * - Secret pattern detection (API keys, tokens, passwords)
 * - Logging sanitization (prevents secret leakage)
 * - Secret rotation with audit trail
 * - Entropy validation for secret strength
 */

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto'
import { AppError, ErrorCode } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { calculateEntropy } from '../utils/secret-validation.js'

const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
/** 600,000 iterations as per OWASP 2023 recommendations */
const PBKDF2_ITERATIONS = 600000
const PBKDF2_DIGEST = 'sha512'
const KEY_LENGTH = 32
const SALT_LENGTH = 16
const IV_LENGTH = 12
const MIN_SECRET_ENTROPY = 128
const REDACTED = '[REDACTED]'

/** Patterns for detecting various secret types */
const SECRET_PATTERNS = {
  apiKey: /(?:api[_-]?key|apikey)[=:\s]+['"]?([a-z0-9_-]{20,})/gi,
  bearerToken: /bearer\s+([a-z0-9_.-]+)/gi,
  awsAccessKey: /AKIA[0-9A-Z]{16}/g,
  awsSecretKey: /aws[_-]?secret[_-]?access[_-]?key[=:\s]+['"]?([a-z0-9/+=]{40})/gi,
  token: /(?:auth[_-]?token|access[_-]?token|refresh[_-]?token)[=:\s]+['"]?([a-z0-9_.-]{20,})/gi,
  privateKey: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/i,
  databaseUrl: /(?:postgres|mysql|mongodb):\/\/([^:]+):([^@]+)@/gi,
  password: /(?:password|passwd|pwd)[=:\s]+['"]?([^\s'"]{8,})/gi,
  jwt: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
  secret: /secret[_-]?key[=:\s]+['"]?([a-z0-9_.-]{20,})/gi,
} as const

/** Encrypted secret format */
export interface EncryptedSecret {
  encrypted: string
  iv: string
  authTag: string
  salt: string
  algorithm: string
  encryptedAt: Date
}

/** Secret metadata for audit trail */
export interface SecretMetadata {
  id: string
  name: string
  createdAt: Date
  lastRotated?: Date
  rotationCount: number
  type?: string
}

/** Secret validation result */
export interface SecretValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  entropy?: number
}

export class SecretsService {
  private masterKey: Buffer | null = null
  private readonly secretsCache = new Map<string, EncryptedSecret>()

  /**
   * Initialize the secrets service with a master encryption key
   * @param masterPassword - Master password for key derivation (from env)
   */
  initialize(masterPassword: string): void {
    if (!masterPassword || masterPassword.length < 16) {
      throw new AppError('Master password must be at least 16 characters', ErrorCode.INVALID_INPUT)
    }

    // Derive master key from password using PBKDF2
    // In production, this salt should be stored securely (e.g., KMS, secrets manager)
    const salt = process.env.SECRETS_SALT ? Buffer.from(process.env.SECRETS_SALT, 'base64') : randomBytes(SALT_LENGTH)

    this.masterKey = pbkdf2Sync(masterPassword, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST)

    logger.info('[Secrets] Service initialized', {
      algorithm: ENCRYPTION_ALGORITHM,
      iterations: PBKDF2_ITERATIONS,
    })
  }

  /**
   * Load and validate secrets from environment variables
   * @param requiredSecrets - List of required secret names
   * @returns Map of secret names to decrypted values
   */
  loadSecrets(requiredSecrets: string[]): Map<string, string> {
    this.assertInitialized()

    const secrets = new Map<string, string>()
    const missingSecrets: string[] = []

    for (const secretName of requiredSecrets) {
      const envValue = process.env[secretName]

      if (!envValue) {
        missingSecrets.push(secretName)
        continue
      }

      // Store encrypted if needed, or use plaintext from env
      secrets.set(secretName, envValue)
    }

    if (missingSecrets.length > 0) {
      throw new AppError(`Missing required secrets: ${missingSecrets.join(', ')}`, ErrorCode.VALIDATION_ERROR, {
        missingSecrets,
      })
    }

    logger.info('[Secrets] Loaded secrets', {
      count: secrets.size,
      secrets: Array.from(secrets.keys()), // Names only, not values
    })

    return secrets
  }

  /**
   * Validate secrets configuration
   * @param secrets - Map of secret names to values
   * @returns Validation results for each secret
   */
  validateSecrets(secrets: Map<string, string>): Map<string, SecretValidationResult> {
    const results = new Map<string, SecretValidationResult>()

    for (const [name, value] of secrets) {
      const result = this.validateSecret(name, value)
      results.set(name, result)

      if (!result.valid) {
        logger.warn('[Secrets] Secret validation failed', {
          secret: name,
          errors: result.errors,
        })
      } else if (result.warnings.length > 0) {
        logger.warn('[Secrets] Secret validation warnings', {
          secret: name,
          warnings: result.warnings,
        })
      }
    }

    return results
  }

  /**
   * Validate a single secret
   */
  private validateSecret(name: string, value: string): SecretValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    if (value.length < 8) {
      errors.push('Secret must be at least 8 characters')
    }

    const entropy = calculateEntropy(value)

    if (entropy < MIN_SECRET_ENTROPY) {
      warnings.push(`Low entropy (${entropy.toFixed(0)} bits). Consider using a stronger secret.`)
    }

    // Check for common weak patterns
    if (/^(password|secret|key|token)$/i.test(value)) {
      errors.push('Secret cannot be a common word')
    }

    const hasMixedCase = /[a-z]/.test(value) && /[A-Z]/.test(value)
    const hasNumbers = /[0-9]/.test(value)
    const hasSymbols = /[^a-zA-Z0-9]/.test(value)

    if (!hasMixedCase && !hasNumbers && !hasSymbols) {
      warnings.push('Secret should contain a mix of characters for better security')
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      entropy,
    }
  }

  /**
   * Encrypt a secret
   * @param plaintext - Secret to encrypt
   * @returns Encrypted secret object
   */
  encryptSecret(plaintext: string): EncryptedSecret {
    this.assertInitialized()

    const iv = randomBytes(IV_LENGTH)
    const salt = randomBytes(SALT_LENGTH)
    const key = pbkdf2Sync(this.masterKey!, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST)
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()

    return {
      encrypted: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      salt: salt.toString('base64'),
      algorithm: ENCRYPTION_ALGORITHM,
      encryptedAt: new Date(),
    }
  }

  /**
   * Decrypt a secret
   * @param encryptedSecret - Encrypted secret object
   * @returns Decrypted plaintext
   */
  decryptSecret(encryptedSecret: EncryptedSecret): string {
    this.assertInitialized()

    try {
      const encrypted = Buffer.from(encryptedSecret.encrypted, 'base64')
      const iv = Buffer.from(encryptedSecret.iv, 'base64')
      const authTag = Buffer.from(encryptedSecret.authTag, 'base64')
      const salt = Buffer.from(encryptedSecret.salt, 'base64')
      const key = pbkdf2Sync(this.masterKey!, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST)
      const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv)
      decipher.setAuthTag(authTag)
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])

      return decrypted.toString('utf8')
    } catch (error) {
      throw new AppError('Failed to decrypt secret', ErrorCode.INTERNAL_ERROR, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Rotate a secret (generate new value)
   * @param oldSecret - Current secret value
   * @param length - Length of new secret (default: 32)
   * @returns New secret value
   */
  rotateSecret(oldSecret: string, length: number = 32): string {
    logger.info('[Secrets] Rotating secret', { oldLength: oldSecret.length, newLength: length })

    // Generate cryptographically secure random secret
    return randomBytes(length).toString('base64url')
  }

  /**
   * Sanitize data for logging (remove secrets)
   * @param data - Data to sanitize
   * @returns Sanitized data with secrets redacted
   */
  sanitizeForLogging(data: unknown): unknown {
    if (typeof data === 'string') {
      return this.sanitizeString(data)
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizeForLogging(item))
    }

    if (typeof data === 'object' && data !== null) {
      const sanitized: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(data)) {
        sanitized[key] = this.isSecretKey(key) ? REDACTED : this.sanitizeForLogging(value)
      }
      return sanitized
    }

    return data
  }

  /**
   * Detect if a string contains secrets
   * @param text - Text to scan
   * @returns True if secrets detected
   */
  detectSecretInString(text: string): boolean {
    for (const pattern of Object.values(SECRET_PATTERNS)) {
      // Reset regex state to prevent lastIndex pollution across calls
      pattern.lastIndex = 0
      if (pattern.test(text)) {
        return true
      }
    }
    return false
  }

  /**
   * Get detected secret types in a string
   * @param text - Text to scan
   * @returns Array of detected secret types
   */
  getDetectedSecretTypes(text: string): string[] {
    const detected: string[] = []

    for (const [type, pattern] of Object.entries(SECRET_PATTERNS)) {
      // Reset regex state to prevent lastIndex pollution across calls
      pattern.lastIndex = 0
      if (pattern.test(text)) {
        detected.push(type)
      }
    }

    return detected
  }

  private assertInitialized(): void {
    if (!this.masterKey) {
      throw new AppError('Secrets service not initialized. Call initialize() first.', ErrorCode.INTERNAL_ERROR)
    }
  }

  private sanitizeString(str: string): string {
    return Object.values(SECRET_PATTERNS).reduce((result, pattern) => {
      // Reset regex state to prevent lastIndex pollution across calls
      pattern.lastIndex = 0
      return result.replace(pattern, REDACTED)
    }, str)
  }

  private isSecretKey(key: string): boolean {
    const secretKeywords = [
      'password',
      'passwd',
      'pwd',
      'secret',
      'token',
      'key',
      'apikey',
      'api_key',
      'auth',
      'credential',
      'private',
    ]

    const lowerKey = key.toLowerCase()
    return secretKeywords.some((keyword) => lowerKey.includes(keyword))
  }
}

let secretsServiceInstance: SecretsService | null = null

/**
 * Get or create the secrets service singleton
 */
export function getSecretsService(): SecretsService {
  if (!secretsServiceInstance) {
    secretsServiceInstance = new SecretsService()
  }
  return secretsServiceInstance
}

/**
 * Initialize secrets service from environment
 * Should be called during application startup
 */
export function initializeSecretsService(): SecretsService {
  const service = getSecretsService()

  const masterPassword = process.env.SECRETS_MASTER_PASSWORD
  if (!masterPassword) {
    throw new AppError('SECRETS_MASTER_PASSWORD environment variable is required', ErrorCode.VALIDATION_ERROR)
  }

  service.initialize(masterPassword)
  return service
}
