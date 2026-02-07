/**
 * Secret Validation Test Suite
 *
 * Tests for secret format validation and pattern matching:
 * - API key format validation
 * - Database URL parsing and validation
 * - Secret strength checking
 * - Pattern matching (API keys, tokens, passwords)
 * - False positive handling
 * - Various secret formats (JWT, Bearer, AWS keys)
 *
 * Target: 10+ validation tests
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ============================================================================
// Secret Validation Service
// ============================================================================

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface SecretFormat {
  type: string;
  pattern: RegExp;
  minLength?: number;
  maxLength?: number;
  examples: string[];
}

class SecretValidationService {
  /**
   * Supported secret formats
   */
  private formats: SecretFormat[] = [
    {
      type: 'API Key (sk-mem)',
      pattern: /^sk-mem_[A-Za-z0-9_-]{40,}$/,
      minLength: 47,
      examples: ['sk-mem_' + 'a'.repeat(40)],
    },
    {
      type: 'API Key (sk-ant)',
      pattern: /^sk-ant-[a-zA-Z0-9_-]{95,}$/,
      minLength: 102,
      examples: ['sk-ant-' + 'a'.repeat(95)],
    },
    {
      type: 'API Key (sk-)',
      pattern: /^sk-[a-zA-Z0-9]{48}$/,
      minLength: 51,
      examples: ['sk-' + 'a'.repeat(48)],
    },
    {
      type: 'AWS Access Key',
      pattern: /^AKIA[0-9A-Z]{16}$/,
      minLength: 20,
      maxLength: 20,
      examples: ['AKIAIOSFODNN7EXAMPLE'],
    },
    {
      type: 'JWT',
      pattern: /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/,
      examples: ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signature'],
    },
    {
      type: 'Bearer Token',
      pattern: /^Bearer\s+[a-zA-Z0-9_-]{20,}$/,
      minLength: 27,
      examples: ['Bearer ' + 'a'.repeat(20)],
    },
  ];

  /**
   * Validate API key format
   */
  validateApiKey(key: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if empty
    if (!key || key.trim() === '') {
      errors.push('API key cannot be empty');
      return { valid: false, errors, warnings };
    }

    // Check format
    const matchedFormat = this.formats.find(f => f.pattern.test(key));

    if (!matchedFormat) {
      errors.push('API key does not match any known format');
      return { valid: false, errors, warnings };
    }

    // Check length constraints
    if (matchedFormat.minLength && key.length < matchedFormat.minLength) {
      errors.push(`API key is too short (minimum ${matchedFormat.minLength} characters)`);
    }

    if (matchedFormat.maxLength && key.length > matchedFormat.maxLength) {
      errors.push(`API key is too long (maximum ${matchedFormat.maxLength} characters)`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Parse and validate database URL
   */
  parseDatabaseUrl(url: string): {
    valid: boolean;
    parsed?: {
      protocol: string;
      username: string;
      password: string;
      host: string;
      port: number;
      database: string;
    };
    errors: string[];
  } {
    const errors: string[] = [];

    // Check if empty
    if (!url || url.trim() === '') {
      errors.push('Database URL cannot be empty');
      return { valid: false, errors };
    }

    // Parse URL
    const urlPattern = /^(postgres(?:ql)?):\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)$/;
    const match = url.match(urlPattern);

    if (!match) {
      errors.push('Invalid database URL format');
      return { valid: false, errors };
    }

    const [, protocol, username, password, host, portStr, database] = match;

    const port = parseInt(portStr!, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      errors.push('Invalid port number');
    }

    // Security checks
    if (password === 'password' || password === '123456') {
      errors.push('Weak database password detected');
    }

    return {
      valid: errors.length === 0,
      parsed: {
        protocol: protocol!,
        username: username!,
        password: password!,
        host: host!,
        port,
        database: database!,
      },
      errors,
    };
  }

  /**
   * Check secret strength
   */
  checkSecretStrength(secret: string): {
    strength: 'weak' | 'medium' | 'strong';
    score: number;
    feedback: string[];
  } {
    const feedback: string[] = [];
    let score = 0;

    // Length check
    if (secret.length < 12) {
      feedback.push('Secret is too short (minimum 12 characters recommended)');
    } else if (secret.length >= 20) {
      score += 20;
    } else {
      score += 10;
    }

    // Character diversity
    const hasLower = /[a-z]/.test(secret);
    const hasUpper = /[A-Z]/.test(secret);
    const hasDigit = /[0-9]/.test(secret);
    const hasSpecial = /[^a-zA-Z0-9]/.test(secret);

    const diversity = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;
    score += diversity * 15;

    if (diversity < 2) {
      feedback.push('Use a mix of uppercase, lowercase, digits, and special characters');
    }

    // Entropy check
    const uniqueChars = new Set(secret).size;
    const entropyRatio = uniqueChars / secret.length;

    if (entropyRatio > 0.7) {
      score += 25;
    } else if (entropyRatio > 0.5) {
      score += 15;
    } else {
      feedback.push('Secret has low character diversity');
    }

    // Common patterns
    const commonPatterns = [
      'password',
      '123456',
      'admin',
      'test',
      'secret',
      'qwerty',
    ];

    const lowerSecret = secret.toLowerCase();
    const hasCommonPattern = commonPatterns.some(pattern => lowerSecret.includes(pattern));

    if (hasCommonPattern) {
      score -= 30;
      feedback.push('Avoid common words and patterns');
    }

    // Sequential characters
    if (/(?:abc|123|xyz)/i.test(secret)) {
      feedback.push('Avoid sequential characters');
      score -= 10;
    }

    // Repeated characters
    if (/(.)\1{2,}/.test(secret)) {
      feedback.push('Avoid repeated characters');
      score -= 10;
    }

    // Determine strength
    let strength: 'weak' | 'medium' | 'strong';
    if (score < 40) {
      strength = 'weak';
    } else if (score < 70) {
      strength = 'medium';
    } else {
      strength = 'strong';
    }

    return {
      strength,
      score: Math.max(0, Math.min(100, score)),
      feedback,
    };
  }

  /**
   * Detect secret type from value
   */
  detectSecretType(value: string): {
    type: string | null;
    confidence: number;
    falsePositive: boolean;
  } {
    // Check against known formats
    for (const format of this.formats) {
      if (format.pattern.test(value)) {
        return {
          type: format.type,
          confidence: 0.95,
          falsePositive: false,
        };
      }
    }

    // Heuristic detection
    if (value.length > 30 && /^[A-Za-z0-9_-]+$/.test(value)) {
      return {
        type: 'Unknown API Key',
        confidence: 0.7,
        falsePositive: false,
      };
    }

    // Check for false positives
    if (this.isFalsePositive(value)) {
      return {
        type: null,
        confidence: 0,
        falsePositive: true,
      };
    }

    return {
      type: null,
      confidence: 0,
      falsePositive: false,
    };
  }

  /**
   * Detect false positives
   */
  private isFalsePositive(value: string): boolean {
    const falsePositivePatterns = [
      // Example/placeholder values
      /example/i,
      /placeholder/i,
      /test_?key/i,
      /your_?key/i,

      // Repeated characters
      /^(.)\1+$/,

      // Very short
      value.length < 8,

      // All same case and alphanumeric
      /^[a-z]+$/.test(value) || /^[A-Z]+$/.test(value) || /^[0-9]+$/.test(value),
    ];

    return falsePositivePatterns.some(pattern =>
      typeof pattern === 'boolean' ? pattern : pattern.test(value)
    );
  }

  /**
   * Validate JWT token
   */
  validateJwt(token: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check format
    const parts = token.split('.');
    if (parts.length !== 3) {
      errors.push('JWT must have 3 parts (header.payload.signature)');
      return { valid: false, errors, warnings };
    }

    // Check each part is base64url
    for (let i = 0; i < 3; i++) {
      if (!/^[A-Za-z0-9_-]+$/.test(parts[i]!)) {
        errors.push(`JWT part ${i + 1} is not valid base64url`);
      }
    }

    // Check header starts with eyJ (base64 of {"alg":...)
    if (!parts[0]!.startsWith('eyJ')) {
      warnings.push('JWT header does not start with eyJ (unusual)');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate AWS credentials
   */
  validateAwsCredentials(credentials: {
    accessKeyId?: string;
    secretAccessKey?: string;
  }): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate access key
    if (!credentials.accessKeyId) {
      errors.push('AWS Access Key ID is required');
    } else if (!/^AKIA[0-9A-Z]{16}$/.test(credentials.accessKeyId)) {
      errors.push('Invalid AWS Access Key ID format');
    }

    // Validate secret key
    if (!credentials.secretAccessKey) {
      errors.push('AWS Secret Access Key is required');
    } else if (credentials.secretAccessKey.length !== 40) {
      errors.push('AWS Secret Access Key must be 40 characters');
    } else if (!/^[A-Za-z0-9/+=]+$/.test(credentials.secretAccessKey)) {
      errors.push('Invalid AWS Secret Access Key format');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate Bearer token
   */
  validateBearerToken(token: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check format
    if (!token.startsWith('Bearer ')) {
      errors.push('Bearer token must start with "Bearer "');
      return { valid: false, errors, warnings };
    }

    const tokenValue = token.substring(7);

    // Check length
    if (tokenValue.length < 20) {
      errors.push('Bearer token value is too short');
    }

    // Check format
    if (!/^[A-Za-z0-9_-]+$/.test(tokenValue)) {
      errors.push('Bearer token contains invalid characters');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

// ============================================================================
// Validation Tests
// ============================================================================

describe('Secret Validation Tests', () => {
  let service: SecretValidationService;

  beforeEach(() => {
    service = new SecretValidationService();
  });

  // ============================================================================
  // API Key Validation Tests
  // ============================================================================

  describe('API Key Format Validation', () => {
    it('should validate sk-mem API key', () => {
      const key = 'sk-mem_' + 'a'.repeat(40);
      const result = service.validateApiKey(key);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate sk-ant API key', () => {
      const key = 'sk-ant-' + 'a'.repeat(95);
      const result = service.validateApiKey(key);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate OpenAI API key', () => {
      const key = 'sk-' + 'a'.repeat(48);
      const result = service.validateApiKey(key);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject empty API key', () => {
      const result = service.validateApiKey('');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('API key cannot be empty');
    });

    it('should reject invalid API key format', () => {
      const result = service.validateApiKey('invalid-api-key');

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('does not match'))).toBe(true);
    });

    it('should reject short API key', () => {
      const result = service.validateApiKey('sk-mem_short');

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Database URL Validation Tests
  // ============================================================================

  describe('Database URL Parsing', () => {
    it('should parse valid PostgreSQL URL', () => {
      const url = 'postgresql://user:strong-random-pass-xyz@localhost:5432/dbname';
      const result = service.parseDatabaseUrl(url);

      expect(result.valid).toBe(true);
      expect(result.parsed).toBeDefined();
      expect(result.parsed?.protocol).toBe('postgresql');
      expect(result.parsed?.username).toBe('user');
      expect(result.parsed?.host).toBe('localhost');
      expect(result.parsed?.port).toBe(5432);
      expect(result.parsed?.database).toBe('dbname');
    });

    it('should parse postgres:// URL', () => {
      const url = 'postgres://user:strong-pass-abc@host:5432/db';
      const result = service.parseDatabaseUrl(url);

      expect(result.valid).toBe(true);
      expect(result.parsed?.protocol).toBe('postgres');
    });

    it('should reject empty URL', () => {
      const result = service.parseDatabaseUrl('');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Database URL cannot be empty');
    });

    it('should reject invalid URL format', () => {
      const result = service.parseDatabaseUrl('invalid-url');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid database URL format');
    });

    it('should reject invalid port', () => {
      const url = 'postgresql://user:pass@host:99999/db';
      const result = service.parseDatabaseUrl(url);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid port number');
    });

    it('should detect weak password', () => {
      const url = 'postgresql://user:password@host:5432/db';
      const result = service.parseDatabaseUrl(url);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Weak database password detected');
    });
  });

  // ============================================================================
  // Secret Strength Tests
  // ============================================================================

  describe('Secret Strength Checking', () => {
    it('should detect strong secret', () => {
      const result = service.checkSecretStrength('MyStr0ng!P@ssw0rd#2024');

      expect(result.strength).toBe('strong');
      expect(result.score).toBeGreaterThan(70);
    });

    it('should detect medium strength secret', () => {
      const result = service.checkSecretStrength('simplepass99');

      expect(result.strength).toBe('medium');
      expect(result.score).toBeGreaterThanOrEqual(40);
      expect(result.score).toBeLessThan(70);
    });

    it('should detect weak secret', () => {
      const result = service.checkSecretStrength('password');

      expect(result.strength).toBe('weak');
      expect(result.score).toBeLessThan(40);
    });

    it('should penalize short secrets', () => {
      const result = service.checkSecretStrength('short');

      expect(result.feedback.some(f => f.includes('too short'))).toBe(true);
    });

    it('should penalize common patterns', () => {
      const result = service.checkSecretStrength('password123');

      expect(result.feedback.some(f => f.includes('common words'))).toBe(true);
    });

    it('should penalize sequential characters', () => {
      const result = service.checkSecretStrength('abc123xyz');

      expect(result.feedback.some(f => f.includes('sequential'))).toBe(true);
    });

    it('should penalize repeated characters', () => {
      const result = service.checkSecretStrength('aaabbbccc');

      expect(result.feedback.some(f => f.includes('repeated'))).toBe(true);
    });

    it('should reward character diversity', () => {
      const result = service.checkSecretStrength('Abc!123@xyz#456');

      expect(result.score).toBeGreaterThan(60);
    });
  });

  // ============================================================================
  // Pattern Matching Tests
  // ============================================================================

  describe('Secret Type Detection', () => {
    it('should detect AWS access key', () => {
      const result = service.detectSecretType('AKIAIOSFODNN7EXAMPLE');

      expect(result.type).toBe('AWS Access Key');
      expect(result.confidence).toBeGreaterThan(0.9);
      expect(result.falsePositive).toBe(false);
    });

    it('should detect JWT token', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signature';
      const result = service.detectSecretType(jwt);

      expect(result.type).toBe('JWT');
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('should detect Bearer token', () => {
      const token = 'Bearer ' + 'a'.repeat(30);
      const result = service.detectSecretType(token);

      expect(result.type).toBe('Bearer Token');
    });

    it('should detect unknown long tokens', () => {
      const token = 'x'.repeat(40);
      const result = service.detectSecretType(token);

      expect(result.type).toBe('Unknown API Key');
      expect(result.confidence).toBeLessThan(0.9);
    });

    it('should not detect non-secrets', () => {
      const result = service.detectSecretType('normal-string');

      expect(result.type).toBeNull();
      expect(result.confidence).toBe(0);
    });
  });

  // ============================================================================
  // False Positive Handling Tests
  // ============================================================================

  describe('False Positive Handling', () => {
    it('should detect example placeholders', () => {
      const result = service.detectSecretType('example_api_key');

      expect(result.falsePositive).toBe(true);
    });

    it('should detect test keys', () => {
      const result = service.detectSecretType('test_key_12345');

      expect(result.falsePositive).toBe(true);
    });

    it('should detect placeholder values', () => {
      const result = service.detectSecretType('placeholder');

      expect(result.falsePositive).toBe(true);
    });

    it('should detect repeated characters', () => {
      const result = service.detectSecretType('aaaaaaaaaa');

      expect(result.falsePositive).toBe(true);
    });

    it('should not flag real secrets as false positives', () => {
      const realKey = 'sk-mem_' + 'a'.repeat(40);
      const result = service.detectSecretType(realKey);

      expect(result.falsePositive).toBe(false);
    });
  });

  // ============================================================================
  // JWT Validation Tests
  // ============================================================================

  describe('JWT Validation', () => {
    it('should validate correct JWT format', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signature';
      const result = service.validateJwt(jwt);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject JWT with wrong number of parts', () => {
      const result = service.validateJwt('invalid.jwt');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('JWT must have 3 parts (header.payload.signature)');
    });

    it('should reject JWT with invalid base64url', () => {
      const result = service.validateJwt('inv@lid.token.here');

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('not valid base64url'))).toBe(true);
    });

    it('should warn about unusual header', () => {
      const result = service.validateJwt('abc.def.ghi');

      expect(result.warnings.some(w => w.includes('unusual'))).toBe(true);
    });
  });

  // ============================================================================
  // AWS Credentials Validation Tests
  // ============================================================================

  describe('AWS Credentials Validation', () => {
    it('should validate correct AWS credentials', () => {
      const result = service.validateAwsCredentials({
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'a'.repeat(40),
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing access key', () => {
      const result = service.validateAwsCredentials({
        secretAccessKey: 'a'.repeat(40),
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('AWS Access Key ID is required');
    });

    it('should reject invalid access key format', () => {
      const result = service.validateAwsCredentials({
        accessKeyId: 'INVALID_KEY',
        secretAccessKey: 'a'.repeat(40),
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid AWS Access Key ID format');
    });

    it('should reject wrong secret key length', () => {
      const result = service.validateAwsCredentials({
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'too-short',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('AWS Secret Access Key must be 40 characters');
    });
  });

  // ============================================================================
  // Bearer Token Validation Tests
  // ============================================================================

  describe('Bearer Token Validation', () => {
    it('should validate correct Bearer token', () => {
      const token = 'Bearer ' + 'a'.repeat(30);
      const result = service.validateBearerToken(token);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject token without Bearer prefix', () => {
      const result = service.validateBearerToken('token123');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Bearer token must start with "Bearer "');
    });

    it('should reject short Bearer token', () => {
      const result = service.validateBearerToken('Bearer short');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Bearer token value is too short');
    });

    it('should reject Bearer token with invalid characters', () => {
      const result = service.validateBearerToken('Bearer token@#$%^&*()');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Bearer token contains invalid characters');
    });
  });
});
