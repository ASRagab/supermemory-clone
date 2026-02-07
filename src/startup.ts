/**
 * Application Startup Validation
 *
 * Validates all required secrets and configuration on startup.
 * Implements fail-fast pattern to prevent running with invalid configuration.
 *
 * This module should be imported and called FIRST in the application entry point.
 */

import { getSecretsService } from './services/secrets.service.js';
import {
  validateApiKey,
  validateDatabaseUrl,
  checkSecretStrength,
} from './utils/secret-validation.js';
import {
  getRequiredSecrets,
  getOptionalSecrets,
  getAllSecrets,
  type SecretDefinition,
} from './config/secrets.config.js';
import { logger } from './utils/logger.js';
import { AppError, ErrorCode } from './utils/errors.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Startup validation result
 */
export interface StartupValidationResult {
  /** All validations passed */
  success: boolean;
  /** Fatal errors (prevent startup) */
  errors: string[];
  /** Non-fatal warnings */
  warnings: string[];
  /** Loaded secrets count */
  secretsLoaded: number;
  /** Weak secrets detected */
  weakSecrets: string[];
  /** Missing optional secrets */
  missingOptional: string[];
}

/**
 * Configuration summary (sanitized for logging)
 */
export interface ConfigurationSummary {
  /** Environment */
  environment: string;
  /** Node version */
  nodeVersion: string;
  /** Required secrets status */
  requiredSecrets: {
    present: string[];
    missing: string[];
  };
  /** Optional secrets status */
  optionalSecrets: {
    present: string[];
    missing: string[];
  };
  /** Database configuration (sanitized) */
  database?: {
    type: string;
    host: string;
    port: number;
    database: string;
  };
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate all secrets on application startup
 * @returns Validation result
 * @throws AppError if critical validation fails
 */
export function validateSecretsOnStartup(): StartupValidationResult {
  const result: StartupValidationResult = {
    success: true,
    errors: [],
    warnings: [],
    secretsLoaded: 0,
    weakSecrets: [],
    missingOptional: [],
  };

  logger.info('[Startup] Validating secrets configuration...');

  // Check required secrets
  const requiredSecrets = getRequiredSecrets();
  const missingRequired: string[] = [];

  for (const secret of requiredSecrets) {
    const value = process.env[secret.envVar];

    if (!value) {
      missingRequired.push(secret.envVar);
      result.errors.push(`Required secret missing: ${secret.envVar} - ${secret.description}`);
      continue;
    }

    // Validate the secret
    const validation = validateSecret(secret, value);
    if (!validation.valid) {
      result.errors.push(
        `Invalid secret ${secret.envVar}: ${validation.errors.join(', ')}`
      );
    }

    if (validation.warnings.length > 0) {
      result.warnings.push(
        `${secret.envVar}: ${validation.warnings.join(', ')}`
      );
    }

    if (validation.weak) {
      result.weakSecrets.push(secret.envVar);
      result.warnings.push(`Weak secret detected: ${secret.envVar}`);
    }

    result.secretsLoaded++;
  }

  // Check optional secrets
  const optionalSecrets = getOptionalSecrets();

  for (const secret of optionalSecrets) {
    const value = process.env[secret.envVar];

    if (!value) {
      result.missingOptional.push(secret.envVar);
      logger.debug(`[Startup] Optional secret not set: ${secret.envVar}`, {
        description: secret.description,
        default: secret.defaultValue ? '[has default]' : '[no default]',
      });
      continue;
    }

    // Validate the secret
    const validation = validateSecret(secret, value);
    if (!validation.valid) {
      result.warnings.push(
        `Optional secret ${secret.envVar} is invalid: ${validation.errors.join(', ')}`
      );
    }

    if (validation.warnings.length > 0) {
      result.warnings.push(
        `${secret.envVar}: ${validation.warnings.join(', ')}`
      );
    }

    if (validation.weak) {
      result.weakSecrets.push(secret.envVar);
      result.warnings.push(`Weak optional secret: ${secret.envVar}`);
    }

    result.secretsLoaded++;
  }

  // Determine overall success
  result.success = result.errors.length === 0;

  return result;
}

/**
 * Validate a single secret according to its definition
 */
function validateSecret(
  definition: SecretDefinition,
  value: string
): {
  valid: boolean;
  errors: string[];
  warnings: string[];
  weak: boolean;
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  let weak = false;

  // Check minimum length
  if (definition.minLength && value.length < definition.minLength) {
    errors.push(`Must be at least ${definition.minLength} characters`);
  }

  // Format-specific validation
  switch (definition.format) {
    case 'api_key': {
      const validation = validateApiKey(value);
      if (!validation.valid && validation.error) {
        warnings.push(validation.error);
      }
      break;
    }

    case 'database_url': {
      try {
        validateDatabaseUrl(value);
      } catch (error) {
        errors.push('Invalid database URL format');
      }
      break;
    }

    case 'password':
    case 'generic': {
      const strength = checkSecretStrength(value);
      if (strength.strength === 'weak' || strength.strength === 'fair') {
        weak = true;
        warnings.push(...strength.recommendations);
      }
      break;
    }
  }

  // Custom validation function
  if (definition.validate) {
    const customValidation = definition.validate(value);
    if (!customValidation.valid && customValidation.error) {
      errors.push(customValidation.error);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    weak,
  };
}

/**
 * Get sanitized configuration summary for logging
 */
export function getConfigurationSummary(): ConfigurationSummary {
  const allSecrets = getAllSecrets();
  const requiredSecrets = getRequiredSecrets();
  const optionalSecrets = getOptionalSecrets();

  const summary: ConfigurationSummary = {
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    requiredSecrets: {
      present: [],
      missing: [],
    },
    optionalSecrets: {
      present: [],
      missing: [],
    },
  };

  // Check required secrets
  for (const secret of requiredSecrets) {
    if (process.env[secret.envVar]) {
      summary.requiredSecrets.present.push(secret.envVar);
    } else {
      summary.requiredSecrets.missing.push(secret.envVar);
    }
  }

  // Check optional secrets
  for (const secret of optionalSecrets) {
    if (process.env[secret.envVar]) {
      summary.optionalSecrets.present.push(secret.envVar);
    } else {
      summary.optionalSecrets.missing.push(secret.envVar);
    }
  }

  // Add sanitized database config if present
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    try {
      const parsed = validateDatabaseUrl(databaseUrl);
      summary.database = {
        type: parsed.type,
        host: parsed.host,
        port: parsed.port,
        database: parsed.database,
      };
    } catch {
      // Invalid database URL, skip
    }
  }

  return summary;
}

/**
 * Initialize secrets service and validate configuration
 * This should be called FIRST in the application startup sequence.
 *
 * @throws AppError if critical validation fails
 */
export async function initializeAndValidate(): Promise<void> {
  logger.info('[Startup] Initializing application...');

  // Validate secrets
  const validationResult = validateSecretsOnStartup();

  // Log configuration summary (sanitized)
  const summary = getConfigurationSummary();
  logger.info('[Startup] Configuration summary', {
    environment: summary.environment,
    nodeVersion: summary.nodeVersion,
    requiredSecretsPresent: summary.requiredSecrets.present.length,
    requiredSecretsMissing: summary.requiredSecrets.missing.length,
    optionalSecretsPresent: summary.optionalSecrets.present.length,
    database: summary.database
      ? `${summary.database.type}://${summary.database.host}:${summary.database.port}/${summary.database.database}`
      : 'not configured',
  });

  // Log warnings
  if (validationResult.warnings.length > 0) {
    logger.warn('[Startup] Configuration warnings', {
      count: validationResult.warnings.length,
      warnings: validationResult.warnings,
    });
  }

  // Log weak secrets warning
  if (validationResult.weakSecrets.length > 0) {
    logger.warn('[Startup] ⚠️  Weak secrets detected', {
      secrets: validationResult.weakSecrets,
      recommendation: 'Consider rotating these secrets with stronger values',
    });
  }

  // Log missing optional secrets
  if (validationResult.missingOptional.length > 0) {
    logger.info('[Startup] Optional secrets not configured', {
      secrets: validationResult.missingOptional,
      note: 'These features may be disabled or using defaults',
    });
  }

  // Fail fast on errors
  if (!validationResult.success) {
    logger.error('[Startup] ❌ Critical validation errors', {
      errorCount: validationResult.errors.length,
      errors: validationResult.errors,
    });

    throw new AppError(
      `Startup validation failed: ${validationResult.errors.join('; ')}`,
      ErrorCode.VALIDATION_ERROR,
      {
        errors: validationResult.errors,
        missingRequired: summary.requiredSecrets.missing,
      }
    );
  }

  // Initialize secrets service if master password is provided
  const masterPassword = process.env.SECRETS_MASTER_PASSWORD;
  if (masterPassword) {
    try {
      const secretsService = getSecretsService();
      secretsService.initialize(masterPassword);
      logger.info('[Startup] Secrets service initialized');
    } catch (error) {
      logger.error('[Startup] Failed to initialize secrets service', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  } else {
    logger.warn('[Startup] Secrets service not initialized (SECRETS_MASTER_PASSWORD not set)');
  }

  logger.info('[Startup] ✅ Validation complete', {
    secretsLoaded: validationResult.secretsLoaded,
    warnings: validationResult.warnings.length,
  });
}

/**
 * Validate environment before starting the application
 * Call this in your main entry point (src/api/index.ts or src/index.ts)
 */
export async function validateEnvironment(): Promise<void> {
  try {
    await initializeAndValidate();
  } catch (error) {
    if (error instanceof AppError) {
      // Log structured error
      logger.error('[Startup] Environment validation failed', {
        code: error.code,
        message: error.message,
        details: error.details,
      });
    } else {
      logger.error('[Startup] Unexpected error during validation', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Exit with error code
    process.exit(1);
  }
}
