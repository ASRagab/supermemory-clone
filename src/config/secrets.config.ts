/**
 * Secrets Configuration
 *
 * Defines required secrets, optional secrets, validation rules, and rotation policies.
 * Used during application startup to validate environment configuration.
 */

/** Secret definition with validation rules */
export interface SecretDefinition {
  envVar: string;
  description: string;
  required: boolean;
  format?: 'api_key' | 'database_url' | 'jwt' | 'password' | 'generic';
  minLength?: number;
  rotationDays?: number;
  defaultValue?: string;
  validate?: (value: string) => { valid: boolean; error?: string };
}

/** Secret category for organization */
export interface SecretCategory {
  name: string;
  description: string;
  secrets: SecretDefinition[];
}

export const DATABASE_SECRETS: SecretCategory = {
  name: 'Database',
  description: 'Database connection credentials',
  secrets: [
    {
      envVar: 'DATABASE_URL',
      description: 'PostgreSQL connection URL',
      required: true,
      format: 'database_url',
      rotationDays: 90,
    },
    {
      envVar: 'REDIS_URL',
      description: 'Redis connection URL (for caching and queues)',
      required: false,
      format: 'database_url',
      defaultValue: 'redis://localhost:6379',
    },
  ],
};

export const ENCRYPTION_SECRETS: SecretCategory = {
  name: 'Encryption',
  description: 'Master encryption keys',
  secrets: [
    {
      envVar: 'SECRETS_MASTER_PASSWORD',
      description: 'Optional master password for secrets encryption features',
      required: false,
      format: 'password',
      minLength: 32,
      rotationDays: 180,
    },
    {
      envVar: 'SECRETS_SALT',
      description: 'Salt for key derivation (base64)',
      required: false,
      format: 'generic',
      minLength: 24,
    },
  ],
};

export const API_SECRETS: SecretCategory = {
  name: 'API',
  description: 'External API keys and tokens',
  secrets: [
    {
      envVar: 'ANTHROPIC_API_KEY',
      description: 'Anthropic API key for Claude',
      required: false,
      format: 'api_key',
      rotationDays: 365,
      validate: (value: string) => {
        if (value.startsWith('sk-ant-')) {
          return { valid: true };
        }
        return { valid: false, error: 'Must start with sk-ant-' };
      },
    },
    {
      envVar: 'OPENAI_API_KEY',
      description: 'OpenAI API key',
      required: false,
      format: 'api_key',
      rotationDays: 365,
      validate: (value: string) => {
        if (value.startsWith('sk-')) {
          return { valid: true };
        }
        return { valid: false, error: 'Must start with sk-' };
      },
    },
  ],
};

export const AUTH_SECRETS: SecretCategory = {
  name: 'Authentication',
  description: 'Authentication and authorization secrets',
  secrets: [
    {
      envVar: 'JWT_SECRET',
      description: 'Secret for JWT token signing',
      required: false,
      format: 'password',
      minLength: 32,
      rotationDays: 90,
    },
    {
      envVar: 'AUTH_TOKEN',
      description: 'Bearer token for optional REST API auth',
      required: false,
      format: 'password',
      minLength: 16,
      rotationDays: 90,
    },
    {
      envVar: 'CSRF_SECRET',
      description: 'Secret for CSRF token generation',
      required: false,
      format: 'password',
      minLength: 32,
      rotationDays: 90,
    },
  ],
};

export const SESSION_SECRETS: SecretCategory = {
  name: 'Session',
  description: 'Session management secrets',
  secrets: [
    {
      envVar: 'SESSION_SECRET',
      description: 'Secret for session cookie signing',
      required: false,
      format: 'password',
      minLength: 32,
      rotationDays: 90,
    },
  ],
};

export const ALL_SECRET_CATEGORIES: SecretCategory[] = [
  DATABASE_SECRETS,
  ENCRYPTION_SECRETS,
  API_SECRETS,
  AUTH_SECRETS,
  SESSION_SECRETS,
];

/** Rotation policy definition */
export interface RotationPolicy {
  secretName: string;
  intervalDays: number;
  autoRotate: boolean;
  gracePeriodDays: number;
  notifyBeforeDays: number;
}

export const ROTATION_POLICIES: RotationPolicy[] = [
  {
    secretName: 'SECRETS_MASTER_PASSWORD',
    intervalDays: 180,
    autoRotate: false, // Manual rotation required for master password
    gracePeriodDays: 0,
    notifyBeforeDays: 30,
  },
  {
    secretName: 'DATABASE_URL',
    intervalDays: 90,
    autoRotate: false, // Manual rotation for database credentials
    gracePeriodDays: 7,
    notifyBeforeDays: 14,
  },
  {
    secretName: 'JWT_SECRET',
    intervalDays: 90,
    autoRotate: true, // Can auto-rotate JWT secret with grace period
    gracePeriodDays: 14,
    notifyBeforeDays: 7,
  },
  {
    secretName: 'CSRF_SECRET',
    intervalDays: 90,
    autoRotate: true,
    gracePeriodDays: 7,
    notifyBeforeDays: 7,
  },
  {
    secretName: 'SESSION_SECRET',
    intervalDays: 90,
    autoRotate: true,
    gracePeriodDays: 14,
    notifyBeforeDays: 7,
  },
];

/** Get all required secrets */
export function getRequiredSecrets(): SecretDefinition[] {
  return ALL_SECRET_CATEGORIES.flatMap((cat) => cat.secrets.filter((s) => s.required));
}

/** Get all optional secrets */
export function getOptionalSecrets(): SecretDefinition[] {
  return ALL_SECRET_CATEGORIES.flatMap((cat) => cat.secrets.filter((s) => !s.required));
}

/** Get all secrets (required + optional) */
export function getAllSecrets(): SecretDefinition[] {
  return ALL_SECRET_CATEGORIES.flatMap((cat) => cat.secrets);
}

/** Get secret definition by environment variable name */
export function getSecretDefinition(envVar: string): SecretDefinition | undefined {
  for (const category of ALL_SECRET_CATEGORIES) {
    const secret = category.secrets.find((s) => s.envVar === envVar);
    if (secret) return secret;
  }
  return undefined;
}

/** Get rotation policy for a secret */
export function getRotationPolicy(secretName: string): RotationPolicy | undefined {
  return ROTATION_POLICIES.find((p) => p.secretName === secretName);
}

/** Check if a secret is due for rotation */
export function isRotationDue(secretName: string, lastRotated: Date): boolean {
  const policy = getRotationPolicy(secretName);
  if (!policy) {
    return false;
  }

  const now = new Date();
  const daysSinceRotation =
    (now.getTime() - lastRotated.getTime()) / (1000 * 60 * 60 * 24);

  return daysSinceRotation >= policy.intervalDays;
}

/** Check if rotation warning should be shown */
export function shouldWarnRotation(secretName: string, lastRotated: Date): boolean {
  const policy = getRotationPolicy(secretName);
  if (!policy) {
    return false;
  }

  const now = new Date();
  const daysSinceRotation =
    (now.getTime() - lastRotated.getTime()) / (1000 * 60 * 60 * 24);
  const daysUntilRotation = policy.intervalDays - daysSinceRotation;

  return daysUntilRotation <= policy.notifyBeforeDays && daysUntilRotation > 0;
}

export interface EncryptionKeyConfig {
  kdf: 'pbkdf2' | 'scrypt' | 'argon2';
  iterations: number;
  keyLength: number;
  digest: 'sha256' | 'sha512';
}

/** Default encryption key configuration (OWASP 2023 recommendations) */
export const DEFAULT_ENCRYPTION_CONFIG: EncryptionKeyConfig = {
  kdf: 'pbkdf2',
  iterations: 600000, // OWASP 2023 recommendation for PBKDF2-SHA512
  keyLength: 32, // 256 bits
  digest: 'sha512',
};

/** Alternative encryption configs for different security levels */
export const ENCRYPTION_CONFIGS = {
  standard: DEFAULT_ENCRYPTION_CONFIG,
  high: {
    kdf: 'pbkdf2' as const,
    iterations: 1200000,
    keyLength: 32,
    digest: 'sha512' as const,
  },
  /** Performance-optimized (minimum secure iterations) */
  performance: {
    kdf: 'pbkdf2' as const,
    iterations: 310000, // OWASP minimum for PBKDF2-SHA256
    keyLength: 32,
    digest: 'sha256' as const,
  },
} as const;
