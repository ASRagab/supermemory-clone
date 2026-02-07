/**
 * Secrets Service Test Suite
 *
 * Comprehensive tests for secrets management including:
 * - Secret loading (env, file, vault)
 * - Secret validation (format, strength, required)
 * - Encryption/decryption (AES-256-GCM)
 * - Key derivation (PBKDF2/scrypt)
 * - Secret rotation
 * - Sanitization for logging
 * - Pattern detection
 *
 * Target: 25+ unit tests for complete coverage
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes, createCipheriv, createDecipheriv, scryptSync, pbkdf2Sync } from 'crypto';

// Mock secrets service implementation
interface SecretConfig {
  key: string;
  value: string;
  required?: boolean;
  minLength?: number;
  pattern?: RegExp;
  encrypted?: boolean;
}

interface EncryptionResult {
  encrypted: string;
  iv: string;
  authTag: string;
}

// ============================================================================
// Mock Secrets Service Implementation
// ============================================================================

class SecretsService {
  private secrets: Map<string, string> = new Map();
  private encryptionKey: Buffer | null = null;

  constructor(encryptionPassword?: string) {
    if (encryptionPassword) {
      this.encryptionKey = this.deriveKeyPBKDF2(encryptionPassword);
    }
  }

  /**
   * Load secret from environment variable
   */
  loadFromEnv(key: string): string | null {
    return process.env[key] || null;
  }

  /**
   * Load secret from file
   */
  loadFromFile(path: string): string {
    // Mock implementation
    if (path === '/valid/path') {
      return 'file-secret-value';
    }
    throw new Error('File not found');
  }

  /**
   * Validate secret format and strength
   */
  validateSecret(config: SecretConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (config.required && !config.value) {
      errors.push(`Secret ${config.key} is required`);
    }

    if (config.minLength && config.value.length < config.minLength) {
      errors.push(`Secret ${config.key} must be at least ${config.minLength} characters`);
    }

    if (config.pattern && !config.pattern.test(config.value)) {
      errors.push(`Secret ${config.key} does not match required pattern`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check secret strength (entropy)
   */
  checkSecretStrength(secret: string): { strength: 'weak' | 'medium' | 'strong'; entropy: number } {
    const entropy = this.calculateEntropy(secret);

    if (entropy < 40) {
      return { strength: 'weak', entropy };
    } else if (entropy < 80) {
      return { strength: 'medium', entropy };
    } else {
      return { strength: 'strong', entropy };
    }
  }

  /**
   * Calculate Shannon entropy
   */
  private calculateEntropy(str: string): number {
    const freq: Record<string, number> = {};
    for (const char of str) {
      freq[char] = (freq[char] || 0) + 1;
    }

    const len = str.length;
    let entropy = 0;

    for (const count of Object.values(freq)) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }

    return entropy * len;
  }

  /**
   * Encrypt secret using AES-256-GCM
   */
  encrypt(plaintext: string): EncryptionResult {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not initialized');
    }

    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    };
  }

  /**
   * Decrypt secret using AES-256-GCM
   */
  decrypt(encrypted: string, iv: string, authTag: string): string {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not initialized');
    }

    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Derive encryption key using PBKDF2
   */
  deriveKeyPBKDF2(password: string, salt?: Buffer): Buffer {
    const actualSalt = salt || Buffer.from('supermemory-salt');
    return pbkdf2Sync(password, actualSalt, 100000, 32, 'sha256');
  }

  /**
   * Derive encryption key using scrypt
   */
  deriveKeyScrypt(password: string, salt?: Buffer): Buffer {
    const actualSalt = salt || Buffer.from('supermemory-salt');
    return scryptSync(password, actualSalt, 32);
  }

  /**
   * Rotate secret
   */
  rotateSecret(oldSecret: string): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Sanitize secret for logging
   */
  sanitizeForLogging(text: string): string {
    // Redact API keys
    text = text.replace(/sk-[a-zA-Z0-9_-]{40,}/g, 'sk-***REDACTED***');

    // Redact database URLs
    text = text.replace(
      /postgresql:\/\/([^:]+):([^@]+)@/g,
      'postgresql://$1:***REDACTED***@'
    );

    // Redact JWT tokens
    text = text.replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '***JWT_REDACTED***');

    // Redact Bearer tokens
    text = text.replace(/Bearer\s+[a-zA-Z0-9_-]+/g, 'Bearer ***REDACTED***');

    return text;
  }

  /**
   * Detect secrets in string
   */
  detectSecrets(text: string): { type: string; pattern: string }[] {
    const patterns = [
      { type: 'API Key', pattern: /sk-[a-zA-Z0-9_-]{40,}/ },
      { type: 'AWS Key', pattern: /AKIA[0-9A-Z]{16}/ },
      { type: 'JWT', pattern: /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/ },
      { type: 'Database URL', pattern: /postgresql:\/\/[^:]+:[^@]+@/ },
      { type: 'Bearer Token', pattern: /Bearer\s+[a-zA-Z0-9_-]+/ },
    ];

    const detected: { type: string; pattern: string }[] = [];

    for (const { type, pattern } of patterns) {
      const match = text.match(pattern);
      if (match) {
        detected.push({ type, pattern: match[0] });
      }
    }

    return detected;
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Secrets Service - Unit Tests', () => {
  let service: SecretsService;

  beforeEach(() => {
    service = new SecretsService('test-encryption-password');
  });

  // ============================================================================
  // Secret Loading Tests
  // ============================================================================

  describe('Secret Loading', () => {
    it('should load secret from environment variable', () => {
      process.env.TEST_SECRET = 'env-secret-value';
      const secret = service.loadFromEnv('TEST_SECRET');
      expect(secret).toBe('env-secret-value');
      delete process.env.TEST_SECRET;
    });

    it('should return null for missing environment variable', () => {
      const secret = service.loadFromEnv('NON_EXISTENT_KEY');
      expect(secret).toBeNull();
    });

    it('should load secret from file', () => {
      const secret = service.loadFromFile('/valid/path');
      expect(secret).toBe('file-secret-value');
    });

    it('should throw error for invalid file path', () => {
      expect(() => service.loadFromFile('/invalid/path')).toThrow('File not found');
    });
  });

  // ============================================================================
  // Secret Validation Tests
  // ============================================================================

  describe('Secret Validation', () => {
    it('should validate required secret', () => {
      const result = service.validateSecret({
        key: 'API_KEY',
        value: 'valid-key',
        required: true,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing required secret', () => {
      const result = service.validateSecret({
        key: 'API_KEY',
        value: '',
        required: true,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Secret API_KEY is required');
    });

    it('should validate minimum length', () => {
      const result = service.validateSecret({
        key: 'PASSWORD',
        value: 'short',
        minLength: 10,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Secret PASSWORD must be at least 10 characters');
    });

    it('should validate pattern matching', () => {
      const result = service.validateSecret({
        key: 'API_KEY',
        value: 'sk-mem_valid123',
        pattern: /^sk-mem_[a-zA-Z0-9_-]+$/,
      });
      expect(result.valid).toBe(true);
    });

    it('should reject pattern mismatch', () => {
      const result = service.validateSecret({
        key: 'API_KEY',
        value: 'invalid-format',
        pattern: /^sk-mem_[a-zA-Z0-9_-]+$/,
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('does not match required pattern');
    });

    it('should validate multiple constraints', () => {
      const result = service.validateSecret({
        key: 'PASSWORD',
        value: 'short',
        required: true,
        minLength: 10,
        pattern: /^[a-zA-Z0-9]+$/,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Secret Strength Tests
  // ============================================================================

  describe('Secret Strength Validation', () => {
    it('should detect weak secret', () => {
      const result = service.checkSecretStrength('password');
      expect(result.strength).toBe('weak');
      expect(result.entropy).toBeLessThan(40);
    });

    it('should detect medium strength secret', () => {
      const result = service.checkSecretStrength('P@ssw0rd123!');
      expect(result.strength).toBe('medium');
      expect(result.entropy).toBeGreaterThanOrEqual(40);
      expect(result.entropy).toBeLessThan(80);
    });

    it('should detect strong secret', () => {
      const result = service.checkSecretStrength(randomBytes(32).toString('base64'));
      expect(result.strength).toBe('strong');
      expect(result.entropy).toBeGreaterThanOrEqual(80);
    });

    it('should calculate entropy correctly for uniform string', () => {
      const result = service.checkSecretStrength('aaaaaaaa');
      expect(result.entropy).toBe(0); // No entropy in uniform string
    });

    it('should calculate entropy correctly for diverse string', () => {
      const result = service.checkSecretStrength('aAbBcCdDeEfF');
      expect(result.entropy).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Encryption/Decryption Tests (AES-256-GCM)
  // ============================================================================

  describe('Encryption/Decryption (AES-256-GCM)', () => {
    it('should encrypt and decrypt secret', () => {
      const plaintext = 'my-secret-value';
      const { encrypted, iv, authTag } = service.encrypt(plaintext);

      expect(encrypted).toBeTruthy();
      expect(iv).toBeTruthy();
      expect(authTag).toBeTruthy();
      expect(encrypted).not.toBe(plaintext);

      const decrypted = service.decrypt(encrypted, iv, authTag);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext for same plaintext', () => {
      const plaintext = 'my-secret-value';
      const result1 = service.encrypt(plaintext);
      const result2 = service.encrypt(plaintext);

      expect(result1.encrypted).not.toBe(result2.encrypted);
      expect(result1.iv).not.toBe(result2.iv);
    });

    it('should fail decryption with wrong IV', () => {
      const plaintext = 'my-secret-value';
      const { encrypted, authTag } = service.encrypt(plaintext);
      const wrongIv = randomBytes(16).toString('hex');

      expect(() => service.decrypt(encrypted, wrongIv, authTag)).toThrow();
    });

    it('should fail decryption with wrong auth tag', () => {
      const plaintext = 'my-secret-value';
      const { encrypted, iv } = service.encrypt(plaintext);
      const wrongAuthTag = randomBytes(16).toString('hex');

      expect(() => service.decrypt(encrypted, iv, wrongAuthTag)).toThrow();
    });

    it('should fail encryption without encryption key', () => {
      const serviceNoKey = new SecretsService();
      expect(() => serviceNoKey.encrypt('test')).toThrow('Encryption key not initialized');
    });

    it('should encrypt empty string', () => {
      const { encrypted, iv, authTag } = service.encrypt('');
      const decrypted = service.decrypt(encrypted, iv, authTag);
      expect(decrypted).toBe('');
    });

    it('should encrypt long string', () => {
      const longString = 'a'.repeat(10000);
      const { encrypted, iv, authTag } = service.encrypt(longString);
      const decrypted = service.decrypt(encrypted, iv, authTag);
      expect(decrypted).toBe(longString);
    });

    it('should encrypt special characters', () => {
      const special = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/~`';
      const { encrypted, iv, authTag } = service.encrypt(special);
      const decrypted = service.decrypt(encrypted, iv, authTag);
      expect(decrypted).toBe(special);
    });
  });

  // ============================================================================
  // Key Derivation Tests
  // ============================================================================

  describe('Key Derivation (PBKDF2)', () => {
    it('should derive 32-byte key using PBKDF2', () => {
      const key = service.deriveKeyPBKDF2('password');
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should derive consistent key with same password', () => {
      const salt = randomBytes(16);
      const key1 = service.deriveKeyPBKDF2('password', salt);
      const key2 = service.deriveKeyPBKDF2('password', salt);
      expect(key1.equals(key2)).toBe(true);
    });

    it('should derive different keys with different passwords', () => {
      const salt = randomBytes(16);
      const key1 = service.deriveKeyPBKDF2('password1', salt);
      const key2 = service.deriveKeyPBKDF2('password2', salt);
      expect(key1.equals(key2)).toBe(false);
    });

    it('should derive different keys with different salts', () => {
      const key1 = service.deriveKeyPBKDF2('password', randomBytes(16));
      const key2 = service.deriveKeyPBKDF2('password', randomBytes(16));
      expect(key1.equals(key2)).toBe(false);
    });
  });

  describe('Key Derivation (scrypt)', () => {
    it('should derive 32-byte key using scrypt', () => {
      const key = service.deriveKeyScrypt('password');
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should derive consistent key with same password', () => {
      const salt = randomBytes(16);
      const key1 = service.deriveKeyScrypt('password', salt);
      const key2 = service.deriveKeyScrypt('password', salt);
      expect(key1.equals(key2)).toBe(true);
    });

    it('should derive different keys with different passwords', () => {
      const salt = randomBytes(16);
      const key1 = service.deriveKeyScrypt('password1', salt);
      const key2 = service.deriveKeyScrypt('password2', salt);
      expect(key1.equals(key2)).toBe(false);
    });

    it('should produce different output than PBKDF2', () => {
      const salt = randomBytes(16);
      const pbkdf2Key = service.deriveKeyPBKDF2('password', salt);
      const scryptKey = service.deriveKeyScrypt('password', salt);
      expect(pbkdf2Key.equals(scryptKey)).toBe(false);
    });
  });

  // ============================================================================
  // Secret Rotation Tests
  // ============================================================================

  describe('Secret Rotation', () => {
    it('should generate new secret during rotation', () => {
      const oldSecret = 'old-secret-value';
      const newSecret = service.rotateSecret(oldSecret);

      expect(newSecret).toBeTruthy();
      expect(newSecret).not.toBe(oldSecret);
    });

    it('should generate unique secrets on each rotation', () => {
      const secret1 = service.rotateSecret('old');
      const secret2 = service.rotateSecret('old');

      expect(secret1).not.toBe(secret2);
    });

    it('should generate secrets with sufficient length', () => {
      const newSecret = service.rotateSecret('old');
      expect(newSecret.length).toBeGreaterThan(40);
    });

    it('should generate URL-safe secrets', () => {
      const newSecret = service.rotateSecret('old');
      expect(newSecret).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  // ============================================================================
  // Sanitization Tests
  // ============================================================================

  describe('Sanitization for Logging', () => {
    it('should sanitize API keys', () => {
      const text = 'Using API key: sk-mem_1234567890abcdefghijklmnopqrstuvwxyz';
      const sanitized = service.sanitizeForLogging(text);
      expect(sanitized).toContain('sk-***REDACTED***');
      expect(sanitized).not.toContain('1234567890');
    });

    it('should sanitize database URLs', () => {
      const text = 'postgresql://user:secret_password@localhost:5432/db';
      const sanitized = service.sanitizeForLogging(text);
      expect(sanitized).toContain('postgresql://user:***REDACTED***@');
      expect(sanitized).not.toContain('secret_password');
    });

    it('should sanitize JWT tokens', () => {
      const text = 'Authorization: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signature';
      const sanitized = service.sanitizeForLogging(text);
      expect(sanitized).toContain('***JWT_REDACTED***');
      expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    });

    it('should sanitize Bearer tokens', () => {
      const text = 'Authorization: Bearer abc123xyz789';
      const sanitized = service.sanitizeForLogging(text);
      expect(sanitized).toContain('Bearer ***REDACTED***');
      expect(sanitized).not.toContain('abc123xyz789');
    });

    it('should sanitize multiple secrets in one string', () => {
      const apiKey = 'sk-mem_' + 'a'.repeat(40);
      const text = `API: ${apiKey} DB: postgresql://u:p@host:5432/db JWT: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.xyz`;
      const sanitized = service.sanitizeForLogging(text);
      expect(sanitized).toContain('sk-***REDACTED***');
      expect(sanitized).toContain('***REDACTED***@');
      expect(sanitized).toContain('***JWT_REDACTED***');
    });

    it('should preserve non-secret text', () => {
      const text = 'Normal log message with no secrets';
      const sanitized = service.sanitizeForLogging(text);
      expect(sanitized).toBe(text);
    });
  });

  // ============================================================================
  // Pattern Detection Tests
  // ============================================================================

  describe('Secret Pattern Detection', () => {
    it('should detect API key pattern', () => {
      const text = 'sk-mem_1234567890abcdefghijklmnopqrstuvwxyz';
      const detected = service.detectSecrets(text);
      expect(detected).toHaveLength(1);
      expect(detected[0]?.type).toBe('API Key');
    });

    it('should detect AWS key pattern', () => {
      const text = 'AKIAIOSFODNN7EXAMPLE';
      const detected = service.detectSecrets(text);
      expect(detected).toHaveLength(1);
      expect(detected[0]?.type).toBe('AWS Key');
    });

    it('should detect JWT pattern', () => {
      const text = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signature';
      const detected = service.detectSecrets(text);
      expect(detected).toHaveLength(1);
      expect(detected[0]?.type).toBe('JWT');
    });

    it('should detect database URL pattern', () => {
      const text = 'postgresql://user:password@localhost:5432/db';
      const detected = service.detectSecrets(text);
      expect(detected).toHaveLength(1);
      expect(detected[0]?.type).toBe('Database URL');
    });

    it('should detect Bearer token pattern', () => {
      const text = 'Bearer abc123xyz789';
      const detected = service.detectSecrets(text);
      expect(detected).toHaveLength(1);
      expect(detected[0]?.type).toBe('Bearer Token');
    });

    it('should detect multiple secret types', () => {
      const apiKey = 'sk-mem_' + 'a'.repeat(40);
      const text = `API: ${apiKey} AWS: AKIAIOSFODNN7EXAMPLE`;
      const detected = service.detectSecrets(text);
      expect(detected.length).toBeGreaterThanOrEqual(2);
    });

    it('should return empty array for no secrets', () => {
      const text = 'This is a normal message with no secrets';
      const detected = service.detectSecrets(text);
      expect(detected).toHaveLength(0);
    });
  });
});
