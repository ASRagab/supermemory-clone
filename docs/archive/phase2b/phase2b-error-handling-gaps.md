# Phase 2B - Error Handling Gaps Analysis

**Generated:** 2026-02-03
**Analysis Scope:** All service files, middleware, MCP, workers

---

## Executive Summary

| Category | Count | Severity |
|----------|-------|----------|
| **Generic throw Error()** | 59 | High |
| **Silent catch blocks** | 8 | High |
| **Missing error context** | 45 | Medium |
| **Inconsistent error types** | All files | Medium |
| **Missing error logging** | 12 | Medium |

---

## 1. Generic Error Throwing Without Context

### Overview
59 instances of `throw new Error()` without structured error types or sufficient context.

### Impact
- Lost error context in production
- Difficult debugging
- Inconsistent API error responses
- No error categorization for monitoring
- Generic 500 errors to clients

---

### Critical Files Analysis

#### A. PgVector Store (12 instances)

**File:** `src/services/vectorstore/pgvector.ts`

**Pattern:**
```typescript
if (!this.pool) throw new Error('Database not initialized');
```

**Instances:**
- Line 111: Database not initialized (search)
- Line 131: Database not initialized (upsert)
- Line 157: Database not initialized (upsertBatch)
- Line 199: Database not initialized (delete)
- Line 251: Database not initialized (clear)
- Line 303: Database not initialized (similarity search)
- Line 344: Database not initialized (getById)
- Line 364: Database not initialized (exists)
- Line 379: Database not initialized (count)
- Line 446: Database not initialized (getAll)
- Line 479: Database not initialized (rebuildIndex)
- Line 503: Database not initialized (getStats)
- Line 518: Database not initialized (close)

**Issues:**
1. Same error message for different operations
2. No context about what operation failed
3. No indication of how to fix (reinitialize?)
4. Cannot distinguish between "never initialized" vs "closed after init"

**Recommended Fix:**
```typescript
// Create custom error class
export class VectorStoreNotInitializedError extends Error {
  constructor(
    public readonly operation: string,
    public readonly store: string,
    public readonly details?: {
      wasInitialized?: boolean;
      isClosed?: boolean;
      lastOperation?: string;
    }
  ) {
    super(`Vector store '${store}' not initialized for operation: ${operation}`);
    this.name = 'VectorStoreNotInitializedError';
  }
}

// Usage
async search(query: string): Promise<SearchResult[]> {
  if (!this.pool) {
    throw new VectorStoreNotInitializedError('search', 'pgvector', {
      wasInitialized: this.wasEverInitialized,
      isClosed: this.closed,
      lastOperation: this.lastOperation
    });
  }
  // ... implementation
}
```

**Additional Context to Capture:**
```typescript
class PgVectorStore {
  private wasEverInitialized = false;
  private closed = false;
  private lastOperation?: string;
  private initializationError?: Error;

  async initialize(): Promise<void> {
    try {
      // ... initialization
      this.wasEverInitialized = true;
    } catch (error) {
      this.initializationError = error as Error;
      throw error;
    }
  }

  private checkInitialized(operation: string): void {
    this.lastOperation = operation;

    if (!this.pool) {
      throw new VectorStoreNotInitializedError(operation, 'pgvector', {
        wasInitialized: this.wasEverInitialized,
        isClosed: this.closed,
        initError: this.initializationError?.message
      });
    }
  }
}
```

---

#### B. Embedding Service (4 instances)

**File:** `src/services/embedding.service.ts`

**Instances:**

1. **Line 166: Empty text validation**
   ```typescript
   if (!text || text.trim().length === 0) {
     throw new Error('Text cannot be empty');
   }
   ```

   **Issues:**
   - No context about where empty text came from
   - No indication of what tried to embed it
   - Cannot track source of invalid input

   **Fix:**
   ```typescript
   export class InvalidEmbeddingInputError extends ValidationError {
     constructor(
       message: string,
       public readonly input: {
         text?: string;
         index?: number;
         source?: string;
       }
     ) {
       super(message, 'INVALID_EMBEDDING_INPUT');
       this.name = 'InvalidEmbeddingInputError';
     }
   }

   // Usage
   if (!text || text.trim().length === 0) {
     throw new InvalidEmbeddingInputError(
       'Text cannot be empty',
       { text: text?.slice(0, 50), source: 'embed' }
     );
   }
   ```

2. **Lines 297, 330: OpenAI API errors**
   ```typescript
   throw new Error(`OpenAI API error: ${response.status} - ${error}`);
   ```

   **Issues:**
   - Loses original error object
   - No retry information
   - No request context

   **Fix:**
   ```typescript
   export class EmbeddingProviderError extends Error {
     constructor(
       public readonly provider: string,
       public readonly status: number,
       public readonly originalError: unknown,
       public readonly context: {
         requestId?: string;
         retryCount?: number;
         texts?: string[];
       }
     ) {
       super(`${provider} API error: ${status}`);
       this.name = 'EmbeddingProviderError';
     }

     get isRetryable(): boolean {
       return this.status === 429 || this.status >= 500;
     }
   }

   // Usage
   throw new EmbeddingProviderError(
     'OpenAI',
     response.status,
     error,
     {
       requestId: response.headers.get('x-request-id'),
       retryCount: attempt,
       texts: texts.map(t => t.slice(0, 50))
     }
   );
   ```

3. **Line 306: Missing embedding**
   ```typescript
   throw new Error('No embedding returned from OpenAI API');
   ```

   **Fix:**
   ```typescript
   throw new EmbeddingProviderError(
     'OpenAI',
     200,
     new Error('Empty response'),
     { requestId, texts }
   );
   ```

4. **Line 348: Vector dimension mismatch**
   ```typescript
   throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
   ```

   **Fix:**
   ```typescript
   export class VectorDimensionError extends Error {
     constructor(
       public readonly expected: number,
       public readonly actual: number,
       public readonly operation: string
     ) {
       super(
         `Vector dimension mismatch in ${operation}: expected ${expected}, got ${actual}`
       );
       this.name = 'VectorDimensionError';
     }
   }

   // Usage
   throw new VectorDimensionError(a.length, b.length, 'similarity');
   ```

---

#### C. Auth Service (1 instance)

**File:** `src/services/auth.service.ts`

**Instance:**

**Line 95: API key creation failure**
```typescript
throw new Error('Failed to create API key');
```

**Issues:**
- No original error context
- No indication of why creation failed
- Cannot distinguish between validation, database, or other errors

**Recommended Fix:**
```typescript
export class APIKeyCreationError extends Error {
  constructor(
    public readonly reason: 'validation' | 'database' | 'duplicate' | 'unknown',
    public readonly originalError?: unknown,
    public readonly context?: {
      userId?: string;
      name?: string;
    }
  ) {
    super(`Failed to create API key: ${reason}`);
    this.name = 'APIKeyCreationError';
  }
}

// Usage in auth.service.ts
async createAPIKey(
  userId: string,
  name: string,
  scopes: string[]
): Promise<APIKey> {
  try {
    // Validation
    if (!userId || !name) {
      throw new APIKeyCreationError('validation', null, { userId, name });
    }

    // Database operation
    const key = await db.insert(apiKeys).values({
      userId,
      name,
      scopes,
      keyHash: this.hashKey(generatedKey)
    });

    return key;
  } catch (error) {
    // Determine reason
    if (error instanceof ValidationError) {
      throw new APIKeyCreationError('validation', error, { userId, name });
    }

    if (isDatabaseError(error) && error.code === '23505') { // Duplicate
      throw new APIKeyCreationError('duplicate', error, { userId, name });
    }

    if (isDatabaseError(error)) {
      throw new APIKeyCreationError('database', error, { userId, name });
    }

    throw new APIKeyCreationError('unknown', error, { userId, name });
  }
}
```

---

#### D. Extraction Service (1 instance)

**File:** `src/services/extraction.service.ts`

**Line 67:**
```typescript
throw new Error(`Unsupported content type: ${type}`);
```

**Recommended Fix:**
```typescript
export class UnsupportedContentTypeError extends ValidationError {
  constructor(
    public readonly contentType: string,
    public readonly supportedTypes: string[]
  ) {
    super(
      `Unsupported content type: ${contentType}. Supported: ${supportedTypes.join(', ')}`,
      'UNSUPPORTED_CONTENT_TYPE'
    );
    this.name = 'UnsupportedContentTypeError';
  }
}

// Usage
throw new UnsupportedContentTypeError(
  type,
  this.getSupportedContentTypes()
);
```

---

#### E. Pipeline Service (3 instances)

**File:** `src/services/pipeline.service.ts`

**Instances:**

1. **Lines 222, 348: Document not found**
   ```typescript
   throw new Error(`Document not found: ${docId}`);
   ```

   **Fix:**
   ```typescript
   export class DocumentNotFoundError extends Error {
     constructor(
       public readonly documentId: string,
       public readonly operation: string
     ) {
       super(`Document not found: ${documentId} (operation: ${operation})`);
       this.name = 'DocumentNotFoundError';
     }
   }

   // Usage
   throw new DocumentNotFoundError(docId, 'processDocument');
   ```

2. **Line 463: Chunking failed**
   ```typescript
   throw new Error(`Chunking failed: ${error.message}`);
   ```

   **Fix:**
   ```typescript
   export class PipelineStageError extends Error {
     constructor(
       public readonly stage: 'extraction' | 'chunking' | 'embedding' | 'indexing',
       public readonly documentId: string,
       public readonly originalError: Error
     ) {
       super(`Pipeline stage '${stage}' failed for document ${documentId}: ${originalError.message}`);
       this.name = 'PipelineStageError';
       this.cause = originalError;
     }
   }

   // Usage
   try {
     chunks = await this.chunkingService.chunk(content);
   } catch (error) {
     throw new PipelineStageError('chunking', docId, error as Error);
   }
   ```

---

#### F. MCP Server (4 instances)

**File:** `src/mcp/index.ts`

**Instances:**

1. **Line 424: Content required**
   ```typescript
   throw new Error('Content required for ingest action');
   ```

2. **Line 448: Facts required**
   ```typescript
   throw new Error('Facts required for update action');
   ```

3. **Line 502: Unknown action**
   ```typescript
   throw new Error(`Unknown action: ${input.action}`);
   ```

4. **Line 818: API key not found**
   ```typescript
   throw new Error(`API key ${input.id} not found`);
   ```

**Recommended Fix:**
```typescript
export class MCPActionError extends Error {
  constructor(
    public readonly action: string,
    public readonly reason: 'missing_field' | 'invalid_input' | 'not_found' | 'unknown_action',
    public readonly details?: Record<string, unknown>
  ) {
    super(`MCP action '${action}' failed: ${reason}`);
    this.name = 'MCPActionError';
  }
}

// Usage
case 'ingest': {
  if (!input.content) {
    throw new MCPActionError('ingest', 'missing_field', {
      field: 'content',
      received: input
    });
  }
  // ... rest
}

default:
  throw new MCPActionError(
    input.action,
    'unknown_action',
    { availableActions: ['ingest', 'update', 'query', 'manage'] }
  );
```

---

## 2. Silent Catch Blocks

### Instances

#### A. Vector Store Loader

**File:** `src/services/vectorstore/index.ts`
**Lines:** 106-109

```typescript
try {
  const { PgVectorStore } = await import('./pgvector.js');
  return PgVectorStore;
} catch (error) {
  logger.warn('pgvector not available, falling back to memory store', { error });
  return InMemoryVectorStore;
}
```

**Issue:**
- Silent fallback might hide configuration problems
- In production with `provider: 'pgvector'` config, should fail loudly
- No metrics tracking fallback usage

**Recommended Fix:**
```typescript
try {
  const { PgVectorStore } = await import('./pgvector.js');
  return PgVectorStore;
} catch (error) {
  const isPgVectorConfigured = config.provider === 'pgvector';

  if (isPgVectorConfigured && process.env.NODE_ENV === 'production') {
    logger.error('pgvector configured but not available in production', {
      error,
      config: config.provider
    });
    throw new ConfigurationError(
      'pgvector module unavailable',
      { configuredProvider: 'pgvector', error }
    );
  } else {
    logger.info('pgvector not available, using memory store fallback', {
      error,
      isProduction: process.env.NODE_ENV === 'production'
    });
    metrics.vectorStoreFallbacks.inc({ from: 'pgvector', to: 'memory' });
    return InMemoryVectorStore;
  }
}
```

---

## 3. Recommended Error Hierarchy

### Base Error Classes

```typescript
// src/utils/errors/base.ts

/**
 * Base error class for all application errors
 */
export abstract class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      ...(this.cause && { cause: this.cause })
    };
  }
}

/**
 * Validation errors (400)
 */
export class ValidationError extends AppError {
  constructor(message: string, code: string = 'VALIDATION_ERROR') {
    super(message, code, 400);
  }
}

/**
 * Not found errors (404)
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier: string) {
    super(
      `${resource} not found: ${identifier}`,
      'NOT_FOUND',
      404
    );
  }
}

/**
 * Configuration errors (500, but non-retryable)
 */
export class ConfigurationError extends AppError {
  constructor(message: string, public readonly details?: unknown) {
    super(message, 'CONFIGURATION_ERROR', 500, false);
  }
}

/**
 * External service errors (502/503, retryable)
 */
export class ExternalServiceError extends AppError {
  constructor(
    public readonly service: string,
    message: string,
    public readonly isRetryable: boolean = true
  ) {
    super(
      `External service '${service}' error: ${message}`,
      'EXTERNAL_SERVICE_ERROR',
      isRetryable ? 503 : 502
    );
  }
}

/**
 * Database errors (503, retryable)
 */
export class DatabaseError extends AppError {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly isRetryable: boolean = true
  ) {
    super(
      `Database error during ${operation}: ${message}`,
      'DATABASE_ERROR',
      503,
      isRetryable
    );
  }
}
```

### Specific Error Classes

```typescript
// src/utils/errors/vectorstore.ts
export class VectorStoreNotInitializedError extends AppError {
  constructor(operation: string, store: string, details?: unknown) {
    super(
      `Vector store '${store}' not initialized for operation: ${operation}`,
      'VECTOR_STORE_NOT_INITIALIZED',
      500,
      false // Not operational - needs reinitialization
    );
    this.details = details;
  }
}

export class VectorDimensionError extends ValidationError {
  constructor(expected: number, actual: number, operation: string) {
    super(
      `Vector dimension mismatch in ${operation}: expected ${expected}, got ${actual}`,
      'VECTOR_DIMENSION_MISMATCH'
    );
  }
}

// src/utils/errors/embedding.ts
export class InvalidEmbeddingInputError extends ValidationError {
  constructor(message: string, public readonly input: unknown) {
    super(message, 'INVALID_EMBEDDING_INPUT');
  }
}

export class EmbeddingProviderError extends ExternalServiceError {
  constructor(
    provider: string,
    public readonly status: number,
    message: string,
    public readonly requestId?: string
  ) {
    super(provider, message, status === 429 || status >= 500);
  }
}

// src/utils/errors/pipeline.ts
export class DocumentNotFoundError extends NotFoundError {
  constructor(documentId: string, public readonly operation: string) {
    super('Document', documentId);
  }
}

export class PipelineStageError extends AppError {
  constructor(
    public readonly stage: string,
    public readonly documentId: string,
    public readonly originalError: Error
  ) {
    super(
      `Pipeline stage '${stage}' failed for document ${documentId}`,
      `PIPELINE_${stage.toUpperCase()}_ERROR`,
      500
    );
    this.cause = originalError;
  }
}

// src/utils/errors/mcp.ts
export class MCPActionError extends ValidationError {
  constructor(
    public readonly action: string,
    public readonly reason: string,
    public readonly details?: unknown
  ) {
    super(
      `MCP action '${action}' failed: ${reason}`,
      `MCP_${reason.toUpperCase()}`
    );
  }
}
```

---

## 4. Error Handling Middleware

### API Error Handler

```typescript
// src/api/middleware/errorHandler.ts

import { Context } from 'hono';
import { AppError } from '../../utils/errors/base.js';
import { logger } from '../../utils/logger.js';

export async function errorHandler(err: Error, c: Context) {
  // Log the error
  logger.error('Request error', {
    error: err,
    path: c.req.path,
    method: c.req.method,
    auth: c.get('auth'),
    stack: err.stack
  });

  // Handle known application errors
  if (err instanceof AppError) {
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(process.env.NODE_ENV === 'development' && {
            stack: err.stack,
            details: err
          })
        },
        status: err.statusCode
      },
      err.statusCode
    );
  }

  // Handle Zod validation errors
  if (err.name === 'ZodError') {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: err.issues
        },
        status: 400
      },
      400
    );
  }

  // Handle unknown errors (log but don't expose details)
  logger.error('Unexpected error', {
    error: err,
    stack: err.stack
  });

  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        ...(process.env.NODE_ENV === 'development' && {
          originalMessage: err.message,
          stack: err.stack
        })
      },
      status: 500
    },
    500
  );
}
```

---

## 5. Implementation Checklist

### Week 1: Foundation
- [ ] Create error class hierarchy (`src/utils/errors/`)
- [ ] Implement base error classes
- [ ] Create specific error classes for each domain
- [ ] Update error handler middleware

### Week 2: Service Updates
- [ ] Update PgVector store error handling (12 instances)
- [ ] Update embedding service (4 instances)
- [ ] Update auth service (1 instance)
- [ ] Update extraction service (1 instance)
- [ ] Update pipeline service (3 instances)

### Week 3: MCP & Workers
- [ ] Update MCP server error handling (4 instances)
- [ ] Update worker error handling
- [ ] Update remaining services

### Week 4: Testing & Monitoring
- [ ] Add error handling tests
- [ ] Set up error monitoring/alerting
- [ ] Document error codes
- [ ] Create error handling guide

---

## 6. Error Monitoring

### Metrics to Track

```typescript
// Prometheus metrics
const errorsByCode = new Counter({
  name: 'app_errors_total',
  help: 'Total errors by error code',
  labelNames: ['code', 'service']
});

const errorsByType = new Counter({
  name: 'app_errors_by_type',
  help: 'Total errors by type',
  labelNames: ['type', 'operational']
});

// Usage in error handler
if (err instanceof AppError) {
  errorsByCode.inc({
    code: err.code,
    service: getServiceName(c.req.path)
  });

  errorsByType.inc({
    type: err.name,
    operational: err.isOperational.toString()
  });
}
```

### Alerts

```yaml
# Prometheus alert rules
groups:
  - name: errors
    rules:
      - alert: HighErrorRate
        expr: rate(app_errors_total[5m]) > 10
        annotations:
          summary: High error rate detected

      - alert: NonOperationalErrors
        expr: rate(app_errors_by_type{operational="false"}[5m]) > 1
        annotations:
          summary: Non-operational errors detected (config issues)
```

---

## Conclusion

**Total Issues:** 59 generic errors + 8 silent catches = 67 error handling gaps

**Effort:** 4-6 hours for error classes + 3-4 hours for service updates = 7-10 hours total

**Priority:** HIGH - Critical for production debugging and monitoring
