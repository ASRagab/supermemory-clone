# Secrets Management

This document describes the comprehensive secrets management system for SuperMemory Clone.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Git Hook Setup](#git-hook-setup)
- [API Reference](#api-reference)
- [Security Best Practices](#security-best-practices)

## Overview

The secrets management system provides secure handling of sensitive information including:

- **Encryption at rest** using AES-256-GCM
- **Key derivation** using PBKDF2 with 600,000 iterations (OWASP 2023)
- **Secret validation** with strength checking and format validation
- **Pattern detection** to prevent secrets from being committed to version control
- **Logging sanitization** to prevent secret leakage in logs
- **Secret rotation** with audit trail

## Features

### 1. Encryption Service

```typescript
import { getSecretsService } from './services/secrets.service.js';

const service = getSecretsService();
service.initialize('your-master-password');

// Encrypt a secret
const encrypted = service.encryptSecret('my-secret-value');

// Decrypt a secret
const decrypted = service.decryptSecret(encrypted);
```

### 2. Secret Validation

```typescript
import { validateApiKey, checkSecretStrength } from './utils/secret-validation.js';

// Validate API key format
const validation = validateApiKey('sk-ant-abc123...');
console.log(validation.valid); // true/false
console.log(validation.format); // 'anthropic'

// Check secret strength
const strength = checkSecretStrength('my-password');
console.log(strength.strength); // 'weak' | 'fair' | 'good' | 'strong'
console.log(strength.entropy); // bits of entropy
console.log(strength.recommendations); // array of suggestions
```

### 3. Pattern Detection

```typescript
const service = getSecretsService();

// Detect if a string contains secrets
const hasSecrets = service.detectSecretInString(
  'API key is sk-test-123'
);
console.log(hasSecrets); // true

// Get detected secret types
const types = service.getDetectedSecretTypes(
  'api_key=sk-test and password=secret'
);
console.log(types); // ['apiKey', 'password']
```

### 4. Logging Sanitization

```typescript
const service = getSecretsService();

const logData = {
  apiKey: 'sk-test-123',
  password: 'secret123',
  public: 'safe-value'
};

const sanitized = service.sanitizeForLogging(logData);
// {
//   apiKey: '[REDACTED]',
//   password: '[REDACTED]',
//   public: 'safe-value'
// }
```

### 5. Secret Rotation

```typescript
const service = getSecretsService();

// Generate new secret
const newSecret = service.rotateSecret('old-secret', 32);
console.log(newSecret); // cryptographically secure random value
```

## Architecture

### Components

```
src/
├── services/
│   └── secrets.service.ts       # Core secrets management service
├── utils/
│   └── secret-validation.ts     # Validation utilities
├── config/
│   └── secrets.config.ts        # Secret definitions and policies
├── startup.ts                   # Startup validation
└── scripts/
    └── pre-commit-secrets       # Git hook for secret detection
```

### SecretsService Class

```typescript
class SecretsService {
  // Initialization
  initialize(masterPassword: string): void;
  loadSecrets(requiredSecrets: string[]): Map<string, string>;
  validateSecrets(secrets: Map<string, string>): Map<string, SecretValidationResult>;

  // Encryption
  encryptSecret(plaintext: string): EncryptedSecret;
  decryptSecret(encryptedSecret: EncryptedSecret): string;

  // Rotation
  rotateSecret(oldSecret: string, length?: number): string;

  // Security
  sanitizeForLogging(data: unknown): unknown;
  detectSecretInString(text: string): boolean;
  getDetectedSecretTypes(text: string): string[];
}
```

## Configuration

### 1. Environment Variables

Add to your `.env` file:

```bash
# Master password for encrypting secrets at rest
# REQUIRED for production deployment
# Generate with: openssl rand -base64 48
SECRETS_MASTER_PASSWORD=your-secure-master-password-here

# Salt for key derivation (base64 encoded)
# Optional: If not provided, a new salt is generated on first run
# Generate with: openssl rand -base64 24
SECRETS_SALT=your-base64-encoded-salt-here
```

### 2. Secret Definitions

Define your required and optional secrets in `src/config/secrets.config.ts`:

```typescript
export const API_SECRETS: SecretCategory = {
  name: 'API',
  description: 'External API keys',
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
  ],
};
```

### 3. Rotation Policies

Configure automatic rotation policies:

```typescript
export const ROTATION_POLICIES: RotationPolicy[] = [
  {
    secretName: 'SECRETS_MASTER_PASSWORD',
    intervalDays: 180,
    autoRotate: false, // Manual rotation required
    gracePeriodDays: 0,
    notifyBeforeDays: 30,
  },
];
```

## Git Hook Setup

### Automatic Installation

The git pre-commit hook prevents secrets from being committed to version control.

#### Option 1: Manual Installation

```bash
# Copy hook to .git/hooks
cp scripts/pre-commit-secrets .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

#### Option 2: Using Husky

```bash
# Install Husky
npm install --save-dev husky

# Initialize Husky
npx husky init

# Add pre-commit hook
npx husky add .husky/pre-commit "node scripts/pre-commit-secrets"
```

### How It Works

The pre-commit hook scans staged files for secret patterns:

- **API Keys**: `sk-ant-...`, `sk-...`, `AKIA...`
- **JWT Tokens**: `eyJ...`
- **Database URLs**: `postgresql://user:pass@...`
- **Bearer Tokens**: `Bearer ...`
- **Private Keys**: `-----BEGIN PRIVATE KEY-----`

If secrets are detected, the commit is blocked with details:

```bash
❌ COMMIT BLOCKED: Potential secrets detected!

📄 src/config.ts:
  Line 12: API Key
    Looks like an API key
    "const apiKey = 'sk-ant-abc123...'"

🔒 Security Recommendations:

1. Remove the secret from your code
2. Add the file to .gitignore if it contains secrets
3. Use environment variables instead (see .env.example)
4. If this is a false positive, add the pattern to the exclusion list
```

## API Reference

### Validation Functions

#### `validateApiKey(apiKey, expectedFormat?)`

Validate API key format.

```typescript
const result = validateApiKey('sk-ant-abc123...');
// { valid: true, format: 'anthropic' }
```

#### `validateDatabaseUrl(url)`

Parse and validate database connection URLs.

```typescript
const components = validateDatabaseUrl('postgresql://user:pass@localhost:5432/db');
// {
//   type: 'postgresql',
//   username: 'user',
//   password: 'pass',
//   host: 'localhost',
//   port: 5432,
//   database: 'db'
// }
```

#### `checkSecretStrength(secret)`

Analyze secret strength based on entropy.

```typescript
const strength = checkSecretStrength('my-password');
// {
//   entropy: 45.2,
//   strength: 'fair',
//   diversity: {
//     hasLowercase: true,
//     hasUppercase: false,
//     hasNumbers: false,
//     hasSymbols: true,
//     uniqueChars: 10
//   },
//   recommendations: ['Add uppercase letters', 'Add numbers']
// }
```

#### `generateSecret(length, encoding)`

Generate cryptographically secure secret.

```typescript
const secret = generateSecret(32, 'base64url');
// 'Xk9mP2vL8qR5tN4...' (43 characters for 32 bytes)
```

### Startup Validation

#### `validateSecretsOnStartup()`

Validate all configured secrets on application startup.

```typescript
import { validateSecretsOnStartup } from './startup.js';

const result = validateSecretsOnStartup();
// {
//   success: true,
//   errors: [],
//   warnings: ['Weak secret: JWT_SECRET'],
//   secretsLoaded: 5,
//   weakSecrets: ['JWT_SECRET'],
//   missingOptional: ['REDIS_URL']
// }
```

#### `initializeAndValidate()`

Initialize secrets service and validate configuration (throws on error).

```typescript
import { initializeAndValidate } from './startup.js';

await initializeAndValidate();
// Logs configuration summary, warnings
// Throws AppError if validation fails
```

### Integration with Application

In your main entry point (`src/api/index.ts`):

```typescript
import { validateEnvironment } from './startup.js';

// FIRST thing in your application
await validateEnvironment();

// Then start your server
const app = new Hono();
// ...
```

## Security Best Practices

### 1. Master Password Storage

**Never** commit the master password to version control. Store it using:

- **AWS Secrets Manager** for AWS deployments
- **HashiCorp Vault** for on-premise deployments
- **Azure Key Vault** for Azure deployments
- **Google Secret Manager** for GCP deployments

```bash
# Example: Loading from AWS Secrets Manager
aws secretsmanager get-secret-value \
  --secret-id supermemory/master-password \
  --query SecretString \
  --output text
```

### 2. Secret Rotation

Rotate secrets regularly according to the rotation policies:

```typescript
import { getRotationPolicy, isRotationDue } from './config/secrets.config.js';

const policy = getRotationPolicy('DATABASE_URL');
const lastRotated = new Date('2024-01-01');

if (isRotationDue('DATABASE_URL', lastRotated)) {
  // Trigger rotation process
  console.log('Database credentials need rotation');
}
```

### 3. Encryption Key Derivation

The service uses PBKDF2 with 600,000 iterations (OWASP 2023 recommendation):

```typescript
// Automatically used by SecretsService
const key = pbkdf2Sync(
  masterPassword,
  salt,
  600000,        // OWASP 2023 recommendation
  32,            // 256 bits
  'sha512'       // Strong digest
);
```

### 4. Logging Best Practices

Always sanitize data before logging:

```typescript
import { logger } from './utils/logger.js';
import { getSecretsService } from './services/secrets.service.js';

const service = getSecretsService();

// BAD: Leaks secrets in logs
logger.info('User config', { apiKey: 'sk-test-123' });

// GOOD: Sanitized
const sanitized = service.sanitizeForLogging({ apiKey: 'sk-test-123' });
logger.info('User config', sanitized);
// { apiKey: '[REDACTED]' }
```

### 5. Secret Strength Requirements

Enforce minimum secret strength:

- **Minimum length**: 16 characters
- **Recommended length**: 32+ characters
- **Entropy**: 128+ bits for strong secrets
- **Character diversity**: Mix of uppercase, lowercase, numbers, symbols

```typescript
const strength = checkSecretStrength(secret);

if (strength.strength === 'weak' || strength.strength === 'fair') {
  console.warn('Weak secret detected:', strength.recommendations);
}
```

### 6. Environment-Specific Configuration

Use different secrets for different environments:

```bash
# Development
.env.development

# Production
.env.production

# Never commit these files!
# Add to .gitignore:
.env
.env.*
!.env.example
```

### 7. Fail-Fast on Startup

The startup validation ensures the application doesn't run with missing or invalid secrets:

```typescript
// Application will exit if secrets are invalid
await validateEnvironment();

// Only reached if all secrets are valid
startServer();
```

## Troubleshooting

### "Missing required secrets" error

Ensure all required secrets are set in your `.env` file:

```bash
# Check required secrets
grep "required: true" src/config/secrets.config.ts
```

### "Weak secret detected" warning

Generate stronger secrets:

```bash
# Generate secure random password (48 bytes = 64 base64 chars)
openssl rand -base64 48

# Generate URL-safe secret
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### Git hook not working

Ensure the hook is executable:

```bash
chmod +x .git/hooks/pre-commit

# Or for Husky:
chmod +x .husky/pre-commit
```

### Decryption fails after restart

Ensure `SECRETS_SALT` is set consistently:

```bash
# Generate salt once
openssl rand -base64 24

# Add to .env (and secure storage)
SECRETS_SALT=<generated-salt>
```

## See Also

- [API Authentication](./api-key-authentication.md)
- [Security Hardening Plan](./archive/phase2b/PHASE2B-SECURITY-HARDENING-PLAN.md)
- [Production Deployment Guide](./PRODUCTION-DEPLOYMENT-GUIDE.md)
