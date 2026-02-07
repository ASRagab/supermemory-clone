/**
 * Secret Validation Utilities
 *
 * Provides validation functions for various secret formats and types.
 * Used during startup and secret rotation to ensure secret quality.
 */

import { randomBytes } from 'crypto';
import { ValidationError } from './errors.js';

/** API key format patterns for common providers */
const API_KEY_PATTERNS = {
  generic: /^[a-zA-Z0-9_-]{20,64}$/,
  anthropic: /^sk-ant-[a-zA-Z0-9-_]{95,}$/,
  openai: /^sk-[a-zA-Z0-9]{48,}$/,
  stripe: /^sk_(live|test)_[a-zA-Z0-9]{24,}$/,
  aws: /^AKIA[0-9A-Z]{16}$/,
  google: /^AIza[0-9A-Za-z_-]{35}$/,
} as const;

/** Database URL patterns */
const DATABASE_URL_PATTERNS = {
  postgresql: /^postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)$/,
  mysql: /^mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)$/,
  mongodb: /^mongodb(?:\+srv)?:\/\/([^:]+):([^@]+)@([^/]+)\/(.+)$/,
} as const;

const JWT_PATTERN = /^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/;

export interface ApiKeyValidation {
  valid: boolean;
  format?: keyof typeof API_KEY_PATTERNS;
  error?: string;
}

export interface DatabaseUrlComponents {
  type: 'postgresql' | 'mysql' | 'mongodb';
  username: string;
  password: string;
  host: string;
  port: number;
  database: string;
}

export interface SecretStrength {
  entropy: number;
  strength: 'weak' | 'fair' | 'good' | 'strong';
  diversity: {
    hasLowercase: boolean;
    hasUppercase: boolean;
    hasNumbers: boolean;
    hasSymbols: boolean;
    uniqueChars: number;
  };
  recommendations: string[];
}

/**
 * Validate API key format
 * @param apiKey - API key to validate
 * @param expectedFormat - Optional expected format
 * @returns Validation result
 */
export function validateApiKey(
  apiKey: string,
  expectedFormat?: keyof typeof API_KEY_PATTERNS
): ApiKeyValidation {
  if (!apiKey || apiKey.trim().length === 0) {
    return { valid: false, error: 'API key cannot be empty' };
  }

  // If specific format expected, check only that format
  if (expectedFormat) {
    const pattern = API_KEY_PATTERNS[expectedFormat];
    if (pattern.test(apiKey)) {
      return { valid: true, format: expectedFormat };
    }
    return {
      valid: false,
      error: `API key does not match ${expectedFormat} format`,
    };
  }

  // Check all known formats
  for (const [format, pattern] of Object.entries(API_KEY_PATTERNS)) {
    if (pattern.test(apiKey)) {
      return {
        valid: true,
        format: format as keyof typeof API_KEY_PATTERNS,
      };
    }
  }

  // Not matching any known format
  return {
    valid: false,
    error: 'API key format not recognized',
  };
}

/**
 * Validate and parse database URL
 * @param url - Database connection URL
 * @returns Parsed components
 * @throws ValidationError if URL is invalid
 */
export function validateDatabaseUrl(url: string): DatabaseUrlComponents {
  if (!url || url.trim().length === 0) {
    throw new ValidationError('Database URL cannot be empty');
  }

  const parsers: Array<{
    type: DatabaseUrlComponents['type'];
    pattern: RegExp;
    defaultPort?: number;
  }> = [
    { type: 'postgresql', pattern: DATABASE_URL_PATTERNS.postgresql },
    { type: 'mysql', pattern: DATABASE_URL_PATTERNS.mysql },
    { type: 'mongodb', pattern: DATABASE_URL_PATTERNS.mongodb, defaultPort: 27017 },
  ];

  for (const { type, pattern, defaultPort } of parsers) {
    const match = url.match(pattern);
    if (match) {
      return {
        type,
        username: decodeURIComponent(match[1]!),
        password: decodeURIComponent(match[2]!),
        host: match[3]!,
        port: defaultPort ?? parseInt(match[4]!, 10),
        database: type === 'mongodb' ? match[4]! : match[5]!,
      };
    }
  }

  throw new ValidationError('Invalid database URL format', {
    url: ['URL must be in format: protocol://username:password@host:port/database'],
  });
}

/**
 * Check secret strength based on entropy and character diversity
 * @param secret - Secret to check
 * @returns Strength analysis
 */
export function checkSecretStrength(secret: string): SecretStrength {
  const entropy = calculateEntropy(secret);
  const diversity = analyzeCharacterDiversity(secret);
  const recommendations: string[] = [];

  let strength: SecretStrength['strength'];
  if (entropy < 64) {
    strength = 'weak';
    recommendations.push('Increase length to at least 16 characters');
  } else if (entropy < 96) {
    strength = 'fair';
    recommendations.push('Consider using at least 24 characters for better security');
  } else if (entropy < 128) {
    strength = 'good';
  } else {
    strength = 'strong';
  }

  if (!diversity.hasLowercase) recommendations.push('Add lowercase letters');
  if (!diversity.hasUppercase) recommendations.push('Add uppercase letters');
  if (!diversity.hasNumbers) recommendations.push('Add numbers');
  if (!diversity.hasSymbols) recommendations.push('Add symbols for maximum security');
  if (diversity.uniqueChars < secret.length * 0.5) {
    recommendations.push('Increase character diversity (too many repeated characters)');
  }

  return { entropy, strength, diversity, recommendations };
}

/**
 * Generate a cryptographically secure secret
 * @param length - Length in bytes (default: 32)
 * @param encoding - Output encoding (default: base64url)
 * @returns Generated secret
 */
export function generateSecret(
  length: number = 32,
  encoding: 'hex' | 'base64' | 'base64url' = 'base64url'
): string {
  if (length < 16) {
    throw new ValidationError('Secret length must be at least 16 bytes');
  }

  return randomBytes(length).toString(encoding);
}

/**
 * Validate JWT token format
 * @param token - Token to validate
 * @returns True if valid JWT format
 */
export function validateJwtFormat(token: string): boolean {
  return JWT_PATTERN.test(token);
}

/**
 * Sanitize database URL for logging (hide credentials)
 * @param url - Database URL
 * @returns Sanitized URL with hidden credentials
 */
export function sanitizeDatabaseUrl(url: string): string {
  try {
    const parsed = validateDatabaseUrl(url);
    return `${parsed.type}://[REDACTED]:[REDACTED]@${parsed.host}:${parsed.port}/${parsed.database}`;
  } catch {
    return '[INVALID_DATABASE_URL]';
  }
}

/**
 * Check if a string appears to be a secret (high entropy, base64-like)
 * @param value - String to check
 * @returns True if likely a secret
 */
export function looksLikeSecret(value: string): boolean {
  // Must be at least 16 chars
  if (value.length < 16) {
    return false;
  }

  // Check entropy threshold
  const entropy = calculateEntropy(value);
  if (entropy < 64) {
    return false;
  }

  // Check if it's base64-like (alphanumeric + special chars)
  const base64Like = /^[a-zA-Z0-9+/=_-]+$/;
  if (!base64Like.test(value)) {
    return false;
  }

  return true;
}

/**
 * Calculate Shannon entropy of a string
 * @param str - Input string
 * @returns Entropy in bits
 */
export function calculateEntropy(str: string): number {
  const len = str.length;
  if (len === 0) return 0;

  const frequencies = new Map<string, number>();
  for (const char of str) {
    frequencies.set(char, (frequencies.get(char) || 0) + 1);
  }

  let entropy = 0;
  for (const count of frequencies.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }

  return entropy * len;
}

function analyzeCharacterDiversity(str: string) {
  return {
    hasLowercase: /[a-z]/.test(str),
    hasUppercase: /[A-Z]/.test(str),
    hasNumbers: /[0-9]/.test(str),
    hasSymbols: /[^a-zA-Z0-9]/.test(str),
    uniqueChars: new Set(str).size,
  };
}

/** Export secret patterns for use in secret detection */
export const SECRET_FORMAT_PATTERNS = {
  apiKey: API_KEY_PATTERNS,
  databaseUrl: DATABASE_URL_PATTERNS,
  jwt: JWT_PATTERN,
} as const;
