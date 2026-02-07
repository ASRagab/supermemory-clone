/**
 * Utilities Index
 *
 * Export all utility functions and classes
 */

// ID Generation
export { generateId, generateUUID } from './id.js';

// Logging
export {
  Logger,
  LogLevel,
  type LogLevelName,
  type LogLevelValue,
  type LogEntry,
  type LoggerConfig,
  createLogger,
  getLogger,
  resetLoggers,
  logger,
} from './logger.js';

// Error Handling
export {
  ErrorCode,
  type ErrorCodeType,
  ErrorStatusCode,
  AppError,
  ValidationError,
  NotFoundError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  RateLimitError,
  DatabaseError,
  EmbeddingError,
  ExtractionError,
  ExternalServiceError,
  isAppError,
  isValidationError,
  isNotFoundError,
  isRetryableError,
  isOperationalError,
} from './errors.js';

// Validation
export {
  // Common schemas
  nonEmptyString,
  uuidSchema,
  positiveInt,
  nonNegativeInt,
  confidenceScore,
  containerTagSchema,
  paginationSchema,
  dateRangeSchema,
  // Memory schemas
  memoryTypeSchema,
  relationshipTypeSchema,
  createMemoryInputSchema,
  memoryQueryOptionsSchema,
  // Profile schemas
  factTypeSchema,
  factCategorySchema,
  profileFactInputSchema,
  // Search schemas
  searchModeSchema,
  filterOperatorSchema,
  metadataFilterSchema,
  searchOptionsSchema,
  // Extraction schemas
  contentTypeSchema,
  chunkingStrategySchema,
  documentInputSchema,
  // Validation functions
  validate,
  validateSafe,
  validateWithDefaults,
  createValidator,
  assertDefined,
  assertNonEmpty,
  validateMemoryContent,
  validateSearchQuery,
  validateContainerTag,
} from './validation.js';

// Secret Validation
export {
  validateApiKey,
  validateDatabaseUrl,
  checkSecretStrength,
  generateSecret,
  validateJwtFormat,
  sanitizeDatabaseUrl,
  looksLikeSecret,
  SECRET_FORMAT_PATTERNS,
  type ApiKeyValidation,
  type DatabaseUrlComponents,
  type SecretStrength,
} from './secret-validation.js';
