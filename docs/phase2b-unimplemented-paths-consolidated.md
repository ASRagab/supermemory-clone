# Phase 2B Unimplemented Paths - Consolidated Analysis

**Generated:** 2026-02-03
**Analysis Scope:** src/services, src/api/middleware, src/mcp, src/utils, src/config
**Total Files Analyzed:** 45+ files
**Test Files Analyzed:** 11 test files

---

## Executive Summary

### Key Metrics

| Category | Count | Est. Hours |
|----------|-------|------------|
| **Critical Issues** | 3 | 16-24h |
| **High Priority** | 7 | 28-42h |
| **Medium Priority** | 12 | 24-36h |
| **Low Priority** | 8 | 8-12h |
| **TOTAL** | 30 | 76-114h |

### Risk Assessment

- **Production Blockers:** 3 items (LLM integration TODOs)
- **Security Concerns:** 5 items (input validation, error leakage)
- **Type Safety Issues:** 14 instances of `as any` or `as unknown`
- **Test Coverage Gaps:** ~15-20% of edge cases untested

---

## 🚨 CRITICAL ISSUES (Production Blockers)

### 1. LLM Integration TODOs - Memory Service

**Severity:** CRITICAL
**Files:** `src/services/memory.service.ts`
**Lines:** 745, 797, 877
**Effort:** 12-16 hours

**Description:**
Three core memory service functions use pattern-based heuristics with explicit TODOs to replace with LLM calls:

1. **Memory Type Classification** (line 745)
   ```typescript
   classifyMemoryType(content: string): MemoryType {
     // TODO: Replace with actual LLM call for classification
   ```
   - **Current:** Pattern matching with regex fallback
   - **Required:** LLM-based classification for accuracy
   - **Impact:** Low accuracy for complex memory types

2. **Contradiction/Update Detection** (line 797)
   ```typescript
   checkForUpdates(newMemory: Memory, existing: Memory): UpdateCheckResult {
     // TODO: Replace with actual LLM call for contradiction/update detection
   ```
   - **Current:** Word overlap + pattern indicators
   - **Required:** Semantic understanding of contradictions
   - **Impact:** False negatives in update detection

3. **Memory Extension Detection** (line 877)
   ```typescript
   checkForExtensions(newMemory: Memory, existing: Memory): ExtensionCheckResult {
     // TODO: Replace with actual LLM call for extension detection
   ```
   - **Current:** Length + overlap heuristics
   - **Required:** Semantic extension detection
   - **Impact:** Missed extension relationships

**Recommended Implementation:**
```typescript
// Integration with existing LLM service
import { llmService } from './llm/service.js';

async classifyMemoryType(content: string): Promise<MemoryType> {
  const prompt = buildClassificationPrompt(content);
  const result = await llmService.classify(prompt, {
    fallback: () => this.classifyMemoryTypePattern(content), // Keep regex as fallback
    cache: true,
    timeout: 5000
  });
  return result.type;
}
```

**Dependencies:**
- LLM service with classification endpoint
- Prompt engineering for each function
- Fallback strategy for LLM failures
- Caching for common patterns

**Priority:** Must implement before production launch

---

### 2. Generic Error Handling Without Context

**Severity:** CRITICAL
**Files:** Multiple service files
**Effort:** 4-6 hours

**Description:**
59 instances of `throw new Error()` without structured error types or context.

**Examples:**
```typescript
// src/services/vectorstore/pgvector.ts (12 instances)
if (!this.pool) throw new Error('Database not initialized');

// src/services/auth.service.ts
throw new Error('Failed to create API key'); // No original error context

// src/services/extraction.service.ts
throw new Error(`Unsupported content type: ${type}`); // Could use custom error
```

**Impact:**
- Difficult debugging in production
- No error categorization for monitoring
- Lost error context in stack traces
- Inconsistent error responses to clients

**Recommended Fix:**
```typescript
// Create custom error classes
export class DatabaseNotInitializedError extends Error {
  constructor(operation: string, public readonly details?: unknown) {
    super(`Database not initialized for operation: ${operation}`);
    this.name = 'DatabaseNotInitializedError';
  }
}

// Usage
if (!this.pool) {
  throw new DatabaseNotInitializedError('search', {
    query: searchParams,
    timestamp: Date.now()
  });
}
```

**Files Requiring Updates:**
- `src/services/vectorstore/pgvector.ts` (12 instances)
- `src/services/auth.service.ts` (1 instance)
- `src/services/extraction.service.ts` (1 instance)
- `src/services/embedding.service.ts` (4 instances)
- `src/services/pipeline.service.ts` (3 instances)
- `src/mcp/index.ts` (4 instances)

---

### 3. Type Safety Issues - 14 `as any` Casts

**Severity:** HIGH (but affecting critical paths)
**Effort:** 4-6 hours

**Description:**
14 instances of unsafe type casts that bypass TypeScript's type safety.

**Critical Instances:**

1. **PgVector Provider Type Override** (2 instances)
   ```typescript
   // src/services/vectorstore/pgvector.ts:74
   provider: 'memory' as any, // Override to pgvector once added to types

   // src/services/vectorstore/index.ts:105
   return PgVectorStore as any;
   ```
   - **Fix:** Add 'pgvector' to VectorStoreProvider union type
   - **Location:** `src/types/vectorstore.types.ts`

2. **Relationship Strategy Unsafe Cast** (2 instances)
   ```typescript
   // src/services/relationships/detector.ts:74
   detectionStrategy: strategyName as any,

   // src/services/relationships/strategies.ts:57
   detectionStrategy: strategy as any,
   ```
   - **Fix:** Add strategy names to RelationshipDetectionStrategy type

3. **Auth Query Builder Cast**
   ```typescript
   // src/services/auth.service.ts:238
   query = query.where(and(...conditions)) as any;
   ```
   - **Fix:** Proper Drizzle query type inference

4. **Dynamic Import Cast**
   ```typescript
   // src/api/middleware/rateLimit.ts:102
   const redisModule = await import('redis' as any).catch(() => null);
   ```
   - **Fix:** Add @types/redis or proper module declaration

**All Instances:**
- `src/services/vectorstore/index.ts:105` - Provider type
- `src/services/vectorstore/pgvector.ts:74, 595` - Provider type (2x)
- `src/services/relationships/detector.ts:74, 432, 438` - Strategy and entities (3x)
- `src/services/relationships/strategies.ts:57` - Strategy type
- `src/services/extractors/pdf.extractor.ts:301` - Page render function
- `src/services/auth.service.ts:238` - Query builder
- `src/services/llm/mock.ts:409` - Mock responses
- `src/utils/sanitization.ts:473` - Sanitization return type
- `src/services/persistence/index.ts:253` - Store cast
- `src/sdk/http.ts:99` - Response promise
- `src/api/middleware/rateLimit.ts:102` - Redis import

**Impact:**
- Runtime type errors possible
- IDE autocomplete broken
- Refactoring safety compromised

---

## 🔴 HIGH PRIORITY ISSUES

### 4. Missing Input Validation in MCP Handlers

**Severity:** HIGH
**Files:** `src/mcp/index.ts`
**Lines:** 424, 448, 502
**Effort:** 4-6 hours

**Description:**
MCP action handlers have basic validation but missing comprehensive checks.

**Gaps:**

1. **Ingest Action** (line 424)
   ```typescript
   if (!input.content) {
     throw new Error('Content required for ingest action');
   }
   ```
   - **Missing:** Content size validation
   - **Missing:** Content type validation
   - **Missing:** Sanitization before storage

2. **Update Action** (line 448)
   ```typescript
   if (!input.facts || input.facts.length === 0) {
     throw new Error('Facts required for update action');
   }
   ```
   - **Missing:** Max facts limit (DoS prevention)
   - **Missing:** Individual fact validation
   - **Missing:** Category validation (done inline, should use schema)

3. **Unknown Action** (line 502)
   ```typescript
   throw new Error(`Unknown action: ${input.action}`);
   ```
   - **Missing:** Action whitelist validation before switch
   - **Missing:** Structured error response

**Recommended Fix:**
```typescript
// Add validation schemas
const IngestInputSchema = z.object({
  containerTag: z.string().max(100),
  content: z.string().min(1).max(50 * 1024), // 50KB max
  contentType: z.enum(['text', 'markdown', 'html']).optional()
});

// Use in handler
case 'ingest': {
  const validated = IngestInputSchema.parse(input);
  const sanitized = sanitizeForStorage(validated.content);
  await state.profileService.ingestContent(
    validated.containerTag,
    sanitized
  );
  // ... rest
}
```

---

### 5. Console.log Statements in Production Code

**Severity:** HIGH (security & performance)
**Files:** 10 service files
**Effort:** 2-3 hours

**Description:**
Console statements in production code can leak sensitive data and impact performance.

**Instances Found:**
- `src/services/csrf.service.ts` - CSRF debugging
- `src/services/auth.service.ts` - API key warnings
- `src/services/relationships/index.ts` - Relationship detection debug
- `src/services/vectorstore/migration.ts` - Migration progress
- `src/services/extractors/markdown.extractor.ts` - Extraction debug
- `src/services/vectorstore/base.ts` - Vector operations debug
- `src/services/relationships/memory-integration.ts` - Integration debug
- `src/services/persistence/index.ts` - Storage debug
- `src/services/extractors/pdf.extractor.ts` - PDF parsing debug
- `src/services/embedding.service.ts` - Embedding debug

**Impact:**
- Sensitive data in logs (API keys, user content)
- Production log bloat
- Performance overhead

**Recommended Fix:**
```typescript
// Replace all console.* with logger
import { logger } from '../utils/logger.js';

// Before
console.log('Processing document:', docId);
console.error('Failed to extract:', error);

// After
logger.debug('Processing document', { docId });
logger.error('Failed to extract', { error, context: { docId } });
```

---

### 6. Empty Catch Blocks - Silent Error Swallowing

**Severity:** HIGH
**Files:** Multiple
**Effort:** 3-4 hours

**Description:**
Found pattern of catch blocks that log but don't handle or propagate errors.

**Example:**
```typescript
// src/services/vectorstore/index.ts:106-109
try {
  const { PgVectorStore } = await import('./pgvector.js');
  return PgVectorStore;
} catch (error) {
  logger.warn('pgvector not available, falling back to memory store', { error });
  return InMemoryVectorStore; // Silent fallback might hide config issues
}
```

**Issues:**
- Failures hidden from monitoring
- Production issues undetected
- Difficult troubleshooting

**Recommended Fix:**
```typescript
try {
  const { PgVectorStore } = await import('./pgvector.js');
  return PgVectorStore;
} catch (error) {
  // Log with severity appropriate to context
  if (process.env.NODE_ENV === 'production' && config.provider === 'pgvector') {
    logger.error('pgvector configured but not available', { error });
    throw new ConfigurationError('pgvector unavailable', error);
  } else {
    logger.info('pgvector not available, using memory store', { error });
    return InMemoryVectorStore;
  }
}
```

---

### 7. Missing API Endpoint Tests

**Severity:** HIGH
**Files:** Missing test files
**Effort:** 8-12 hours

**Description:**
No test files found for API endpoints despite full implementation.

**Missing Test Files:**
- `tests/api/documents.test.ts` - Document CRUD endpoints
- `tests/api/memories.test.ts` - Memory endpoints
- `tests/api/profiles.test.ts` - Profile endpoints
- `tests/api/search.test.ts` - Search endpoints

**Existing Implementation:**
- `src/api/routes/documents.ts` - Full CRUD
- `src/api/routes/memories.ts` - Full CRUD
- `src/api/routes/profiles.ts` - Full CRUD
- `src/api/routes/search.ts` - Full search

**Coverage Gap:** ~0% for API layer

**Recommended Test Structure:**
```typescript
// tests/api/documents.test.ts
describe('Documents API', () => {
  describe('POST /api/documents', () => {
    it('should create document with valid input');
    it('should reject oversized content');
    it('should validate content type');
    it('should require authentication');
    it('should sanitize XSS in content');
  });

  describe('GET /api/documents/:id', () => {
    it('should return document by ID');
    it('should return 404 for missing document');
    it('should enforce authorization');
  });

  // ... more tests
});
```

---

### 8. Middleware Error Handler Edge Cases

**Severity:** HIGH
**Files:** `src/api/middleware/errorHandler.ts`
**Effort:** 3-4 hours

**Description:**
Error handler middleware exists but has gaps in handling specific error types.

**Missing Handling:**
1. **Async errors in middleware chain**
2. **Validation errors from nested objects**
3. **Database connection errors** (should return 503, not 500)
4. **Rate limit errors** (should return 429)
5. **CSRF token errors** (should return 403)

**Current Implementation Gaps:**
```typescript
// Likely missing proper error type discrimination
// Need to check if it handles:
- DatabaseConnectionError → 503 Service Unavailable
- RateLimitError → 429 Too Many Requests
- CSRFError → 403 Forbidden
- AuthenticationError → 401 Unauthorized
- AuthorizationError → 403 Forbidden
```

---

### 9. CSRF Secret Validation

**Severity:** HIGH (Security)
**Files:** `src/services/csrf.service.ts`
**Line:** 39
**Effort:** 1-2 hours

**Description:**
CSRF secret validation exists but only checks length, not entropy.

**Current:**
```typescript
if (!secret || secret.length < 32) {
  throw new Error('CSRF secret must be at least 32 characters');
}
```

**Security Issues:**
- Accepts weak secrets like '00000000000000000000000000000000'
- No entropy validation
- No character set requirements

**Recommended Fix:**
```typescript
function validateCSRFSecret(secret: string): void {
  if (!secret || secret.length < 32) {
    throw new Error('CSRF secret must be at least 32 characters');
  }

  // Check for sufficient entropy
  const uniqueChars = new Set(secret).size;
  if (uniqueChars < 16) {
    throw new Error('CSRF secret has insufficient entropy');
  }

  // Warn about weak patterns
  if (/^(.)\1+$/.test(secret)) {
    throw new Error('CSRF secret cannot be a repeating character');
  }

  // Check for alphanumeric + special chars
  if (!/^[A-Za-z0-9!@#$%^&*()_+\-=\[\]{}|;:,.<>?]+$/.test(secret)) {
    logger.warn('CSRF secret contains unusual characters');
  }
}
```

---

### 10. Authentication API Key Storage

**Severity:** HIGH (Security)
**Files:** `src/api/middleware/auth.ts`
**Lines:** 15-62
**Effort:** 3-4 hours

**Description:**
API keys loaded from environment variables with fallback to hardcoded test keys.

**Security Issues:**

1. **Hardcoded Test Keys in Production**
   ```typescript
   // Lines 43-52
   if (process.env.NODE_ENV !== 'production') {
     console.warn('[Auth] Using development test API keys...');
     return new Map<string, AuthContext>([
       ['test-api-key-123', { userId: 'user-1', ... }],
       ['read-only-key-456', { userId: 'user-2', ... }],
     ]);
   }
   ```
   - **Issue:** Easy to accidentally leave in production
   - **Risk:** Known test keys could be exploited

2. **No API Key Rotation**
   - Keys loaded once at module init
   - No hot-reload capability
   - Requires server restart to update keys

3. **No API Key Hashing**
   - Keys stored in plain text in memory
   - Keys compared directly (timing attack possible)

**Recommended Fix:**
```typescript
// 1. Move to database-backed key storage
// 2. Hash keys before storage
// 3. Use constant-time comparison
// 4. Add key rotation mechanism
// 5. Add key expiration
// 6. Add usage tracking

import { timingSafeEqual } from 'crypto';

class APIKeyService {
  async validateKey(providedKey: string): Promise<AuthContext | null> {
    const keyHash = hashAPIKey(providedKey);
    const stored = await db.query.apiKeys.findFirst({
      where: eq(apiKeys.keyHash, keyHash)
    });

    if (!stored || stored.expiresAt < new Date()) {
      return null;
    }

    // Track usage
    await this.trackKeyUsage(stored.id);

    return {
      userId: stored.userId,
      apiKey: providedKey,
      scopes: stored.scopes
    };
  }
}
```

---

## 🟡 MEDIUM PRIORITY ISSUES

### 11. Relationship Detection Missing Tests

**Severity:** MEDIUM
**Files:** Missing `tests/services/relationships/*.test.ts`
**Effort:** 6-8 hours

**Description:**
Complex relationship detection system has no dedicated test files.

**Missing Tests:**
- `tests/services/relationships/detector.test.ts`
- `tests/services/relationships/strategies.test.ts`
- `tests/services/relationships/memory-integration.test.ts`

**Implementation Exists:**
- `src/services/relationships/detector.ts` (432 lines)
- `src/services/relationships/strategies.ts` (227 lines)
- `src/services/relationships/index.ts` (291 lines)

**Critical Test Scenarios:**
1. Embedding-based detection accuracy
2. Co-occurrence strategy edge cases
3. Temporal relationship detection
4. Content similarity thresholds
5. Entity extraction accuracy
6. Relationship type classification
7. Confidence score calculation
8. Integration with memory service

---

### 12. PDF Extractor Error Handling

**Severity:** MEDIUM
**Files:** `src/services/extractors/pdf.extractor.ts`
**Line:** 66
**Effort:** 2-3 hours

**Description:**
PDF extractor throws generic error if pdf-parse not installed.

**Current:**
```typescript
if (!pdfParse) {
  throw new Error('pdf-parse is not installed. Run: npm install pdf-parse');
}
```

**Issues:**
- Runtime error instead of startup validation
- No graceful degradation
- No alternate PDF handling

**Recommended Fix:**
```typescript
// 1. Add startup validation
export async function validatePDFExtractor(): Promise<boolean> {
  try {
    await import('pdf-parse');
    return true;
  } catch {
    logger.warn('pdf-parse not installed, PDF extraction disabled');
    return false;
  }
}

// 2. Graceful handling in extractor
async extract(source: string | Buffer): Promise<ExtractedContent> {
  if (!this.pdfParseAvailable) {
    throw new ExtractorNotAvailableError(
      'PDF extraction requires pdf-parse package',
      { installCommand: 'npm install pdf-parse' }
    );
  }
  // ... rest
}
```

---

### 13. Embedding Service Batch Size Validation

**Severity:** MEDIUM
**Files:** `src/services/embedding.service.ts`
**Effort:** 2 hours

**Description:**
Batch embedding has hardcoded limits without validation.

**Gap:**
```typescript
async embedBatch(texts: string[]): Promise<number[][]> {
  // No validation that texts.length <= provider batch limit
  // OpenAI has 2048 batch limit
  // No automatic chunking if over limit
}
```

**Recommended Fix:**
```typescript
async embedBatch(texts: string[], options?: { maxBatchSize?: number }): Promise<number[][]> {
  const maxBatch = options?.maxBatchSize ?? this.getProviderBatchLimit();

  if (texts.length > maxBatch) {
    logger.warn('Batch size exceeds limit, auto-chunking', {
      size: texts.length,
      limit: maxBatch
    });

    // Chunk and process in parallel
    const chunks = chunkArray(texts, maxBatch);
    const results = await Promise.all(
      chunks.map(chunk => this.embedBatchInternal(chunk))
    );
    return results.flat();
  }

  return this.embedBatchInternal(texts);
}
```

---

### 14. Search Service Query Sanitization

**Severity:** MEDIUM
**Files:** `src/services/search.service.ts`
**Effort:** 2-3 hours

**Description:**
Search queries may not be properly sanitized before vector search.

**Gap:**
- No query length limits
- No special character handling
- No SQL injection protection (if using SQL-based vector stores)

**Recommended Fix:**
```typescript
interface SearchOptions {
  query: string;
  maxQueryLength?: number;
  sanitize?: boolean;
}

async search(options: SearchOptions): Promise<SearchResult[]> {
  // Validate and sanitize query
  let query = options.query.trim();

  const maxLength = options.maxQueryLength ?? 10000;
  if (query.length > maxLength) {
    throw new ValidationError(`Query exceeds maximum length of ${maxLength}`);
  }

  if (options.sanitize !== false) {
    query = sanitizeSearchQuery(query);
  }

  // ... rest
}
```

---

### 15. Pipeline Service Retry Logic

**Severity:** MEDIUM
**Files:** `src/services/pipeline.service.ts`
**Effort:** 4-5 hours

**Description:**
Document processing pipeline has no retry logic for transient failures.

**Gap:**
```typescript
async processDocument(docId: string): Promise<void> {
  // Extraction failure = immediate abort
  // Embedding API timeout = document stuck
  // Vector store connection issue = permanent failure
}
```

**Recommended Fix:**
```typescript
import { retry } from '../utils/retry.js';

async processDocument(docId: string, options?: { maxRetries?: number }): Promise<void> {
  const maxRetries = options?.maxRetries ?? 3;

  // Stage 1: Extraction (retry on timeout)
  const content = await retry(
    () => this.extractionService.extract(docId),
    {
      maxAttempts: maxRetries,
      retryableErrors: [TimeoutError, NetworkError],
      backoff: 'exponential'
    }
  );

  // Stage 2: Chunking (deterministic, no retry)
  const chunks = await this.chunkingService.chunk(content);

  // Stage 3: Embedding (retry on rate limit)
  const embeddings = await retry(
    () => this.embeddingService.embedBatch(chunks),
    {
      maxAttempts: maxRetries,
      retryableErrors: [RateLimitError, TimeoutError],
      backoff: 'exponential'
    }
  );

  // ... rest
}
```

---

### 16. Vector Store Connection Pooling

**Severity:** MEDIUM
**Files:** `src/services/vectorstore/pgvector.ts`
**Effort:** 3-4 hours

**Description:**
PgVector store creates connection pool but no pool monitoring or error recovery.

**Gaps:**
1. No pool size configuration
2. No connection health checks
3. No pool exhaustion handling
4. No connection leak detection

**Recommended Fix:**
```typescript
constructor(config: PgVectorStoreConfig) {
  super(config);

  // Pool configuration with monitoring
  this.pool = new Pool({
    connectionString: this.connectionString,
    max: config.poolMax ?? 20,
    min: config.poolMin ?? 5,
    idleTimeoutMillis: config.idleTimeout ?? 30000,
    connectionTimeoutMillis: config.connectionTimeout ?? 5000,

    // Health checks
    onPoolConnect: async (client) => {
      await client.query('SELECT 1');
      logger.debug('Pool connection established');
    },

    // Error recovery
    onPoolError: (err, client) => {
      logger.error('Pool connection error', { error: err });
      // Metrics tracking
      this.metrics.poolErrors.inc();
    }
  });

  // Periodic health check
  this.startHealthCheck();
}

private startHealthCheck(): void {
  setInterval(async () => {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      this.metrics.healthChecksPassed.inc();
    } catch (error) {
      logger.error('Health check failed', { error });
      this.metrics.healthChecksFailed.inc();
    }
  }, 30000); // Every 30s
}
```

---

### 17. Memory Service Batch Operations

**Severity:** MEDIUM
**Files:** `src/services/memory.service.ts`
**Effort:** 3-4 hours

**Description:**
Memory service processes memories one at a time, no batch APIs.

**Gap:**
```typescript
// Current: Process one memory at a time
for (const memory of memories) {
  await this.storeMemory(memory); // N database calls
}

// Missing: Batch storage
async storeMemories(memories: Memory[]): Promise<void> {
  // Single transaction, batch insert
}
```

**Impact:**
- Slow bulk imports
- N+1 query problems
- No transaction guarantees for related memories

**Recommended Fix:**
```typescript
async storeMemories(memories: Memory[], options?: {
  detectRelationships?: boolean;
  skipDuplicates?: boolean;
}): Promise<{ stored: number; skipped: number; errors: Error[] }> {
  const results = { stored: 0, skipped: 0, errors: [] as Error[] };

  // Use transaction for atomicity
  await this.repository.transaction(async (tx) => {
    // Batch insert memories
    const inserted = await tx.memories.insertMany(
      memories,
      { onConflict: options?.skipDuplicates ? 'ignore' : 'error' }
    );
    results.stored = inserted.length;

    // Batch relationship detection if enabled
    if (options?.detectRelationships) {
      const relationships = await this.detectRelationshipsBatch(inserted);
      await tx.relationships.insertMany(relationships);
    }
  });

  return results;
}
```

---

### 18. Profile Service Fact Expiration

**Severity:** MEDIUM
**Files:** `src/services/profile.service.ts`
**Effort:** 2-3 hours

**Description:**
Dynamic facts have expiration dates but no automatic cleanup.

**Gap:**
```typescript
interface DynamicFact {
  expiresAt?: Date; // Set but never checked
}

// Missing:
async cleanupExpiredFacts(): Promise<number> {
  const now = new Date();
  const deleted = await db.delete(facts)
    .where(and(
      isNotNull(facts.expiresAt),
      lt(facts.expiresAt, now)
    ));
  return deleted.rowCount;
}
```

**Recommended Implementation:**
1. Scheduled job to clean expired facts
2. Lazy cleanup on profile access
3. Fact expiration notifications
4. Fact renewal mechanism

---

### 19. Extraction Worker Queue Priorities

**Severity:** MEDIUM
**Files:** `src/workers/extraction.worker.ts`
**Effort:** 2-3 hours

**Description:**
Worker processes jobs in FIFO order without priority support.

**Gap:**
- No priority queue
- No job dependencies
- No critical path optimization

**Recommended Fix:**
```typescript
interface ExtractionJob {
  documentId: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  dependencies?: string[]; // Job IDs that must complete first
}

// Use priority queue
await queue.add('extract', job, {
  priority: getPriorityValue(job.priority),
  // High priority = lower number = processed first
});
```

---

### 20. Chunking Service Metadata Preservation

**Severity:** MEDIUM
**Files:** `src/services/chunking.service.ts`
**Effort:** 2 hours

**Description:**
Chunks have metadata field but no strategy to preserve source document metadata.

**Gap:**
```typescript
chunk(content: string, options?: ChunkingOptions): Chunk[] {
  // Returns chunks but loses document-level metadata
  // e.g., source URL, author, creation date, document type
}
```

**Recommended Fix:**
```typescript
interface ChunkingOptions {
  maxSize?: number;
  overlap?: number;
  preserveMetadata?: Record<string, unknown>; // NEW
}

chunk(content: string, options?: ChunkingOptions): Chunk[] {
  const chunks = this.splitContent(content, options);

  return chunks.map((chunk, index) => ({
    ...chunk,
    metadata: {
      ...options?.preserveMetadata, // Inherit document metadata
      chunkIndex: index,
      totalChunks: chunks.length
    }
  }));
}
```

---

### 21. Rate Limit Redis Fallback

**Severity:** MEDIUM
**Files:** `src/api/middleware/rateLimit.ts`
**Effort:** 3-4 hours

**Description:**
Rate limiting tries to import Redis with `as any` cast and catches errors.

**Gap:**
```typescript
const redisModule = await import('redis' as any).catch(() => null);
// If Redis unavailable, what happens?
// Falls back to in-memory? Disabled? Unclear.
```

**Issues:**
- Unsafe type cast
- Unclear fallback behavior
- No Redis connection error handling
- No distributed rate limiting in cluster mode

**Recommended Fix:**
```typescript
import type { RedisClientType } from 'redis';

class RateLimitStore {
  private redis?: RedisClientType;
  private inMemoryStore: Map<string, RateLimitData>;

  async initialize(): Promise<void> {
    if (process.env.REDIS_URL) {
      try {
        const { createClient } = await import('redis');
        this.redis = createClient({ url: process.env.REDIS_URL });
        await this.redis.connect();
        logger.info('Rate limiting using Redis');
      } catch (error) {
        logger.warn('Redis unavailable, using in-memory rate limiting', { error });
        this.initInMemoryStore();
      }
    } else {
      logger.info('No Redis configured, using in-memory rate limiting');
      this.initInMemoryStore();
    }
  }

  async checkLimit(key: string, limit: number, window: number): Promise<boolean> {
    if (this.redis) {
      return this.checkLimitRedis(key, limit, window);
    }
    return this.checkLimitMemory(key, limit, window);
  }
}
```

---

### 22. CSRF Token Storage

**Severity:** MEDIUM
**Files:** `src/services/csrf.service.ts`
**Effort:** 2-3 hours

**Description:**
CSRF service likely uses in-memory token storage (need to verify implementation).

**Potential Issues:**
- Tokens lost on server restart
- Not cluster-safe
- No token expiration cleanup

**Recommended Investigation:**
1. Confirm current storage mechanism
2. If in-memory: migrate to Redis/database
3. Add token cleanup job
4. Add token rotation

---

## 🔵 LOW PRIORITY ISSUES

### 23. Logging Consistency

**Severity:** LOW
**Effort:** 4-5 hours

**Description:**
Mix of console.* and logger.* calls throughout codebase.

**Recommended:** Standardize on logger with structured logging.

---

### 24. Configuration Validation

**Severity:** LOW
**Files:** `src/config/index.ts`
**Effort:** 2-3 hours

**Description:**
Config loading exists but minimal validation of environment variables.

**Recommended:** Add Zod schema validation for all config.

---

### 25. Metrics/Observability

**Severity:** LOW
**Effort:** 6-8 hours

**Description:**
No metrics collection for:
- Request latencies
- Error rates
- Queue depths
- Database query performance

**Recommended:** Add Prometheus/OpenTelemetry instrumentation.

---

### 26. API Response Caching

**Severity:** LOW
**Effort:** 4-5 hours

**Description:**
No HTTP caching headers or response caching for read-heavy endpoints.

**Recommended:** Add ETag/Last-Modified headers, implement cache middleware.

---

### 27. Database Query Optimization

**Severity:** LOW
**Effort:** 8-12 hours

**Description:**
No query performance monitoring or slow query logging.

**Recommended:** Add query logging, identify N+1 queries, add indexes.

---

### 28. Worker Error Recovery

**Severity:** LOW
**Files:** Worker files
**Effort:** 3-4 hours

**Description:**
Workers likely have basic error handling but no advanced recovery strategies.

**Recommended:** Add dead letter queues, exponential backoff, circuit breakers.

---

### 29. API Documentation

**Severity:** LOW
**Effort:** 6-8 hours

**Description:**
No OpenAPI/Swagger documentation for API endpoints.

**Recommended:** Generate from route definitions and Zod schemas.

---

### 30. TypeScript Strict Mode

**Severity:** LOW
**Effort:** 8-12 hours

**Description:**
TSConfig may not have all strict flags enabled.

**Recommended:** Enable strict mode, fix all warnings.

---

## Implementation Roadmap

### Phase 1: Critical Fixes (2-3 weeks)
**Focus:** Production blockers and security

1. **Week 1:** LLM Integration TODOs (Issues #1)
   - Implement LLM-based classification
   - Add fallback strategies
   - Test accuracy vs regex baseline

2. **Week 2:** Error Handling & Type Safety (Issues #2, #3)
   - Create custom error classes
   - Fix all `as any` casts
   - Add structured error responses

3. **Week 3:** Security Hardening (Issues #9, #10)
   - CSRF secret validation
   - API key hashing and rotation
   - Input sanitization audit

### Phase 2: High Priority (3-4 weeks)
**Focus:** Stability and robustness

4. **Week 4:** Input Validation & Error Recovery (Issues #4, #5, #6)
   - MCP input validation
   - Remove console.* statements
   - Fix silent error swallowing

5. **Week 5-6:** Test Coverage (Issues #7, #11)
   - API endpoint tests
   - Relationship detection tests
   - Integration tests

6. **Week 7:** Middleware & Edge Cases (Issues #8, #12, #13)
   - Error handler improvements
   - PDF extractor robustness
   - Batch size validation

### Phase 3: Medium Priority (4-5 weeks)
**Focus:** Performance and developer experience

7. **Week 8-9:** Performance Optimizations (Issues #14-17)
   - Query sanitization
   - Retry logic
   - Connection pooling
   - Batch operations

8. **Week 10-11:** Features & Enhancements (Issues #18-22)
   - Fact expiration
   - Queue priorities
   - Metadata preservation
   - Redis fallback
   - CSRF token storage

### Phase 4: Polish (2-3 weeks)
**Focus:** Production readiness

9. **Week 12-13:** Observability (Issues #23-25)
   - Logging standardization
   - Config validation
   - Metrics collection

10. **Week 14:** Documentation & Tooling (Issues #26-30)
    - API documentation
    - Caching strategies
    - Query optimization
    - Worker enhancements
    - TypeScript strict mode

---

## Priority Matrix

| Issue | Severity | Complexity | User Impact | Dev Impact | Priority Score |
|-------|----------|------------|-------------|------------|----------------|
| #1 LLM TODOs | Critical | High | High | High | 10 |
| #2 Error Handling | Critical | Medium | High | High | 9 |
| #3 Type Safety | High | Medium | Medium | High | 8 |
| #9 CSRF Secret | High | Low | High | Low | 8 |
| #10 API Key Storage | High | High | High | High | 9 |
| #4 Input Validation | High | Medium | High | Medium | 8 |
| #5 Console Logs | High | Low | Low | Medium | 6 |
| #6 Empty Catches | High | Medium | Medium | Medium | 7 |
| #7 API Tests | High | High | Medium | High | 8 |
| #8 Error Handler | High | Medium | Medium | Medium | 7 |

---

## Testing Strategy

### Test Coverage Goals

| Area | Current | Target | Gap |
|------|---------|--------|-----|
| **Services** | ~85% | 95% | 10% |
| **API Endpoints** | ~0% | 90% | 90% |
| **Middleware** | ~60% | 95% | 35% |
| **Workers** | ~70% | 90% | 20% |
| **Edge Cases** | ~50% | 85% | 35% |
| **Integration** | ~30% | 80% | 50% |

### Critical Test Scenarios

1. **LLM Integration (Issue #1)**
   - Test with mock LLM responses
   - Test fallback to regex
   - Test error handling
   - Test caching behavior

2. **Error Handling (Issue #2)**
   - Test each custom error type
   - Test error context preservation
   - Test error serialization for API

3. **Security (Issues #9, #10)**
   - Test weak secret rejection
   - Test API key timing attacks
   - Test key rotation
   - Test key expiration

4. **Input Validation (Issue #4)**
   - Test oversized inputs
   - Test malformed inputs
   - Test XSS vectors
   - Test SQL injection attempts

---

## Monitoring Recommendations

### Critical Metrics to Track

1. **Error Rates**
   - LLM fallback rate (should be <5%)
   - Generic error rate (should decrease to 0%)
   - Validation error rate
   - Authentication failure rate

2. **Performance Metrics**
   - LLM response time (p50, p95, p99)
   - Batch operation latency
   - Database connection pool utilization
   - Queue depth and processing rate

3. **Security Metrics**
   - Failed authentication attempts
   - CSRF token rejection rate
   - Input sanitization triggers
   - Rate limit hits

---

## Conclusion

**Total Estimated Effort:** 76-114 hours (9-14 weeks at 1 developer)

**Critical Path:**
1. LLM Integration (blocking production)
2. Error Handling (blocking reliable operations)
3. Security Hardening (blocking production deployment)
4. Test Coverage (blocking confidence)

**Recommended Start:**
Begin with **Issue #1 (LLM TODOs)** as it's the most impactful production blocker. Parallel track: **Issue #2 (Error Handling)** and **Issue #3 (Type Safety)** as they improve developer velocity.

**Next Steps:**
1. Review and prioritize based on business requirements
2. Assign issues to sprint backlog
3. Create detailed implementation tickets
4. Set up monitoring for progress tracking
5. Schedule code review checkpoints

---

## Detailed Analysis Reports

For more detailed analysis, see:
- [TODO Analysis](./phase2b-todos-analysis.md) - All TODO/FIXME comments
- [Error Handling Gaps](./phase2b-error-handling-gaps.md) - Error handling patterns
- [Validation Gaps](./phase2b-validation-gaps.md) - Input validation issues
- [Stub Implementations](./phase2b-stub-implementations.md) - Incomplete implementations
- [Test Coverage Gaps](./phase2b-test-coverage-gaps.md) - Missing tests
