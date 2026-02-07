# JSDoc Template and Style Guide
## Phase 2 Worker Documentation Standards

---

## Overview

This document provides standardized JSDoc templates for Phase 2 workers to ensure consistent, high-quality documentation across all public APIs.

**Standards**:
- All exports require JSDoc comments
- All parameters documented
- All return types documented
- All error cases documented
- Algorithm explanations included

---

## Template 1: Worker Job Data Interface

### Usage
Use this for job data interfaces that define input to worker jobs.

### Template
```typescript
/**
 * Job data structure for {WORKER_NAME} worker
 *
 * This interface defines the input to the {WORKER_NAME} worker's processor
 * function. Each field is carefully validated before processing.
 *
 * **Flow Context**:
 * {DESCRIPTION OF WHERE THIS DATA COMES FROM}
 *
 * **Validation Rules**:
 * - {FIELD1}: {VALIDATION RULE}
 * - {FIELD2}: {VALIDATION RULE}
 *
 * @typedef {Object} {WorkerName}JobData
 * @property {string} documentId - Unique identifier for the document
 * @property {string} containerTag - User/container identifier for scoping
 * @property {string} [optionalField] - Optional field description
 *
 * @example
 * ```typescript
 * const jobData: ExtractionJobData = {
 *   documentId: 'doc-abc123',
 *   containerTag: 'user-xyz789',
 *   sourceUrl: 'https://example.com/article'
 * };
 * ```
 */
export interface ExtractionJobData {
  documentId: string;
  sourceUrl?: string;
  sourceType?: 'text' | 'url' | 'file';
  filePath?: string;
  containerTag: string;
}
```

### Real Example (Extraction Worker)
```typescript
/**
 * Job data structure for extraction worker
 *
 * Defines input parameters for the document extraction job.
 * The extraction worker fetches content from various sources
 * (URLs, files, or direct text) and prepares it for chunking.
 *
 * **Flow Context**:
 * - Input: User uploads or links document
 * - This: Extraction job created with source reference
 * - Output: Extracted text content stored in database
 *
 * **Validation Rules**:
 * - documentId: Must exist in documents table
 * - containerTag: Non-empty string
 * - sourceType: Auto-detected if not provided
 *
 * @typedef {Object} ExtractionJobData
 * @property {string} documentId - Document database ID
 * @property {string} [sourceUrl] - URL to fetch content from
 * @property {'text'|'url'|'file'} [sourceType] - Content source type
 * @property {string} [filePath] - File path for type detection
 * @property {string} containerTag - User/container identifier
 *
 * @example
 * const job = await queue.add('extract', {
 *   documentId: 'doc-123',
 *   sourceUrl: 'https://example.com',
 *   sourceType: 'url',
 *   containerTag: 'user-456'
 * });
 */
export interface ExtractionJobData {
  documentId: string;
  sourceUrl?: string;
  sourceType?: 'text' | 'url' | 'file';
  filePath?: string;
  containerTag: string;
}
```

---

## Template 2: Worker Job Result Interface

### Usage
Use this for job result interfaces that define output from worker jobs.

### Template
```typescript
/**
 * Result structure returned by {WORKER_NAME} worker
 *
 * Contains metrics and results from successful job execution.
 * Used for progress tracking and result retrieval.
 *
 * **Metrics**:
 * - {METRIC1}: {DESCRIPTION}
 * - {METRIC2}: {DESCRIPTION}
 *
 * **Data Persistence**:
 * Results are stored in {DATABASE_TABLE} and {OPTIONAL_OTHER_STORAGE}
 *
 * @typedef {Object} {WorkerName}JobResult
 * @property {number} itemsProcessed - Count of items processed
 * @property {string[]} itemIds - IDs of processed items
 * @property {number} processingTimeMs - Total execution time
 *
 * @example
 * ```typescript
 * const result = await job.waitUntilFinished();
 * console.log(`Processed ${result.itemsProcessed} items in ${result.processingTimeMs}ms`);
 * ```
 */
export interface ExtractionJobResult {
  documentId: string;
  extractedContent: string;
  contentType: ContentType;
  metadata: Record<string, unknown>;
  processingTimeMs: number;
}
```

### Real Example (Embedding Worker)
```typescript
/**
 * Result returned by embedding worker
 *
 * Contains metrics about the embedding generation job including
 * the number of embeddings created, cost estimate, and processing time.
 *
 * **Metrics**:
 * - embeddingCount: Total embeddings generated
 * - costUsd: Estimated API cost
 * - batchesProcessed: Number of batches processed
 * - embeddingIds: IDs for result tracking
 *
 * **Persistence**:
 * Results stored in memory_embeddings table via PgVectorStore
 * Embeddings are automatically indexed with HNSW for similarity search
 *
 * @typedef {Object} EmbeddingJobResult
 * @property {number} embeddingCount - Total embeddings generated
 * @property {number} costUsd - Estimated API cost in USD
 * @property {number} batchesProcessed - Number of batches
 * @property {string[]} embeddingIds - Vector IDs in store
 * @property {number} processingTimeMs - Total execution time
 *
 * @example
 * const result = await job.waitUntilFinished();
 * console.log(`Generated ${result.embeddingCount} embeddings for $${result.costUsd.toFixed(4)}`);
 */
export interface EmbeddingJobResult {
  embeddingCount: number;
  costUsd: number;
  batchesProcessed: number;
  embeddingIds: string[];
  processingTimeMs: number;
}
```

---

## Template 3: Main Processing Function

### Usage
Use this for the main job processing function.

### Template
```typescript
/**
 * Process {WORKER_NAME} job
 *
 * **Processing Steps**:
 * 1. {STEP1}: {DESCRIPTION}
 * 2. {STEP2}: {DESCRIPTION}
 * 3. {STEP3}: {DESCRIPTION}
 * ... (up to 7-8 steps)
 *
 * **Progress Updates**:
 * - 0%: {MILESTONE}
 * - 25%: {MILESTONE}
 * - 50%: {MILESTONE}
 * - 75%: {MILESTONE}
 * - 100%: {MILESTONE}
 *
 * **Database Updates**:
 * Table | Operation | Condition
 * ------|-----------|----------
 * {TABLE1} | {OPERATION} | {WHEN}
 * {TABLE2} | {OPERATION} | {WHEN}
 *
 * **Error Handling**:
 * - {ERROR1}: {HANDLING}
 * - {ERROR2}: {HANDLING}
 * - Logs: All errors logged with context
 * - Throws: BullMQ retry logic handles retries
 *
 * **Performance**:
 * - Time Complexity: O(n) where n = {VARIABLE}
 * - Space Complexity: O(m) where m = {VARIABLE}
 * - Typical Duration: {TIME} for {TYPICAL_SIZE}
 * - Bottleneck: {WHAT_LIMITS_PERFORMANCE}
 *
 * **Queue Chaining**:
 * After successful completion, automatically enqueues {NEXT_WORKER}
 *
 * @param {Job<{WorkerName}JobData, {WorkerName}JobResult>} job - BullMQ job instance
 * @returns {Promise<{WorkerName}JobResult>} Job result with metrics
 * @throws {Error} On validation failure or storage error
 *
 * @example
 * ```typescript
 * const job = await queue.add('process', {
 *   documentId: 'doc-123',
 *   // ... other fields
 * });
 * const result = await job.waitUntilFinished();
 * ```
 */
export async function process{WorkerName}Job(
  job: Job<{WorkerName}JobData, {WorkerName}JobResult>
): Promise<{WorkerName}JobResult> {
  // Implementation
}
```

### Real Example (Extraction Worker)
```typescript
/**
 * Process document extraction job
 *
 * **Processing Steps**:
 * 1. Update processing status to 'processing'
 * 2. Fetch document from database (with validation)
 * 3. Detect content type (URL/file/text/PDF/markdown/code)
 * 4. Call appropriate extractor (TextExtractor, UrlExtractor, etc.)
 * 5. Save extracted content to documents table
 * 6. Chain to chunking queue with extracted content
 * 7. Mark processing queue job as completed
 * 8. Return result with metrics
 *
 * **Progress Updates**:
 * - 0%: Job received
 * - 25%: Content type detected
 * - 50%: Content extracted
 * - 75%: Saved to database
 * - 90%: Chained to chunking queue
 * - 100%: Job completed
 *
 * **Database Updates**:
 * Table | Operation | When
 * ------|-----------|------
 * processing_queue | SET status='processing' | On start
 * documents | SET content, contentType, metadata | After extraction
 * documents | SET status='processing' | After extraction
 * processing_queue | SET status='completed' | On success
 * processing_queue | SET status='failed', error | On error (retry)
 *
 * **Error Handling**:
 * - Document not found: Thrown immediately
 * - Extraction failure: Logged, status='failed', thrown for retry
 * - Database write failure: Logged, status='failed', thrown for retry
 * - Queue chaining failure: Logged but not thrown (job still succeeds)
 *
 * **Performance**:
 * - Time Complexity: O(n) where n = document size
 * - Space Complexity: O(n) for loaded document in memory
 * - Typical Duration: 1-5 seconds per document
 * - Bottleneck: Network I/O for URL extraction
 *
 * **Queue Chaining**:
 * After successful completion, automatically enqueues job in chunking queue
 *
 * @param {Job<ExtractionJobData, ExtractionJobResult>} job - BullMQ job
 * @returns {Promise<ExtractionJobResult>} Extraction result
 * @throws {Error} On document not found or extraction failure
 *
 * @example
 * const job = await queue.add('extract', {
 *   documentId: 'doc-123',
 *   sourceUrl: 'https://example.com/article',
 *   containerTag: 'user-456'
 * });
 * const result = await job.waitUntilFinished();
 * // { documentId, extractedContent, contentType, metadata, processingTimeMs }
 */
export async function processExtractionJob(
  job: Job<ExtractionJobData, ExtractionJobResult>
): Promise<ExtractionJobResult> {
  // Implementation
}
```

---

## Template 4: Worker Factory Function

### Usage
Use this for functions that create worker instances.

### Template
```typescript
/**
 * Create and initialize {WORKER_NAME} worker
 *
 * **Configuration**:
 * - Concurrency: {VALUE} (configurable via {ENV_VAR})
 * - Job Retention: Keep last 100 completed, 500 failed
 * - Auto-Cleanup: Completed after 24h, Failed after 7d
 * - Queue Chaining: Automatically routes to {NEXT_WORKER}
 *
 * **Worker Lifecycle**:
 * 1. Created with connection options
 * 2. Automatically starts processing jobs
 * 3. Emits events (completed, failed, error, active)
 * 4. Should be closed gracefully on shutdown
 *
 * **Events Emitted**:
 * - 'completed': Job finished successfully
 * - 'failed': Job exhausted retries
 * - 'error': Worker encountered fatal error
 * - 'active': Job started processing
 * - 'stalled': Job timeout detected
 *
 * **Resource Management**:
 * - Each worker: ~50MB memory
 * - Database connections: 1 per worker
 * - Redis connections: Shared via global instance
 *
 * **Graceful Shutdown**:
 * ```typescript
 * const worker = create{WorkerName}Worker();
 * process.on('SIGTERM', async () => {
 *   await worker.close();
 * });
 * ```
 *
 * @param {WorkerOptions} [options={}] - Optional configuration
 * @returns {Worker<{WorkerName}JobData, {WorkerName}JobResult>} Configured worker
 *
 * @example
 * ```typescript
 * const worker = create{WorkerName}Worker();
 * worker.on('completed', (job, result) => {
 *   console.log(`Job ${job.id} completed:`, result);
 * });
 * worker.on('failed', (job, error) => {
 *   console.error(`Job ${job?.id} failed:`, error);
 * });
 * ```
 */
export function create{WorkerName}Worker(
  options?: WorkerOptions
): Worker<{WorkerName}JobData, {WorkerName}JobResult> {
  // Implementation
}
```

### Real Example (Embedding Worker)
```typescript
/**
 * Create and initialize embedding worker
 *
 * **Configuration**:
 * - Concurrency: 2 (configurable via BULLMQ_CONCURRENCY_EMBEDDING)
 * - Job Retention: Keep last 100 completed, 500 failed
 * - Auto-Cleanup: Completed after 24h, Failed after 7d
 * - Rate Limiting: 3500 RPM (58 concurrent requests)
 * - Queue Chaining: Automatically routes to indexing queue
 *
 * **Worker Lifecycle**:
 * 1. Creates PgVectorStore instance for storage
 * 2. Initializes rate limiter (p-limit)
 * 3. Creates BullMQ Worker with process handler
 * 4. Registers event handlers for monitoring
 * 5. Automatically starts processing jobs
 *
 * **Events Emitted**:
 * - 'completed': Embeddings generated and stored
 * - 'failed': Generation failed after retries
 * - 'error': Unexpected worker error
 * - 'active': Job started embedding generation
 *
 * **Resource Management**:
 * - Memory: ~50MB per worker
 * - DB Pool: 1 PostgreSQL connection
 * - Redis: Shared connection
 * - Vector Store: In-memory HNSW index
 *
 * **Graceful Shutdown**:
 * ```typescript
 * const worker = new EmbeddingWorker();
 * await worker.initialize();
 * process.on('SIGTERM', async () => {
 *   await worker.close(); // Closes worker and vector store
 * });
 * ```
 *
 * @param {string} [queueName='embedding'] - Queue name
 * @param {string} [connectionString] - Database connection string
 * @returns {Promise<EmbeddingWorker>} Initialized worker instance
 *
 * @example
 * const worker = await createEmbeddingWorker();
 * worker.on('completed', (job) => {
 *   console.log(`Generated embeddings: ${job.result.embeddingCount}`);
 * });
 */
export async function createEmbeddingWorker(
  queueName?: string,
  connectionString?: string
): Promise<EmbeddingWorker> {
  // Implementation
}
```

---

## Template 5: Queue Factory Function

### Usage
Use this for functions that create queue instances.

### Template
```typescript
/**
 * Create queue for enqueueing {WORKER_NAME} jobs
 *
 * **Default Job Options**:
 * - Attempts: 3 (with exponential backoff)
 * - Backoff: 1s, 2s, 4s
 * - Priority: 0 (default, configurable per job)
 * - Removal: Auto-removed after completion/failure
 *
 * **Usage Pattern**:
 * ```typescript
 * const queue = create{WorkerName}Queue();
 * const job = await queue.add('process', jobData, { priority: 5 });
 * await queue.close();
 * ```
 *
 * **Job Priority Levels**:
 * - 1-3: Low priority (background jobs)
 * - 4-6: Medium priority (standard jobs)
 * - 7-10: High priority (urgent jobs)
 *
 * **Monitoring**:
 * ```typescript
 * const queue = create{WorkerName}Queue();
 * const metrics = await queue.getMetrics('completed');
 * ```
 *
 * @returns {Queue<{WorkerName}JobData, {WorkerName}JobResult>} Queue instance
 *
 * @example
 * ```typescript
 * const queue = create{WorkerName}Queue();
 *
 * // Add single job
 * const job = await queue.add('process', {
 *   documentId: 'doc-123',
 *   // ... other fields
 * }, { priority: 5 });
 *
 * // Add multiple jobs
 * const jobs = await queue.addBulk([
 *   { name: 'process', data: { ... } },
 *   { name: 'process', data: { ... } }
 * ]);
 *
 * // Monitor queue
 * const counts = await queue.getJobCounts();
 * console.log(`Waiting: ${counts.waiting}, Active: ${counts.active}`);
 *
 * // Cleanup
 * await queue.close();
 * ```
 */
export function create{WorkerName}Queue(): Queue<{WorkerName}JobData, {WorkerName}JobResult> {
  // Implementation
}
```

---

## Template 6: Algorithm Function (Chunking)

### Usage
Use this for functions that implement algorithms (like chunking strategies).

### Template
```typescript
/**
 * {STRATEGY_NAME} Chunking Strategy
 *
 * **Overview**:
 * {HIGH_LEVEL_DESCRIPTION OF WHAT THE STRATEGY DOES}
 *
 * **Algorithm**:
 * 1. {STEP1}: {DETAILED DESCRIPTION}
 * 2. {STEP2}: {DETAILED DESCRIPTION}
 * 3. {STEP3}: {DETAILED DESCRIPTION}
 * ... (up to 7-8 steps)
 *
 * **Advantages**:
 * - {ADVANTAGE1}: {WHY ITS GOOD}
 * - {ADVANTAGE2}: {WHY ITS GOOD}
 *
 * **Disadvantages**:
 * - {DISADVANTAGE1}: {WHY ITS BAD}
 * - {DISADVANTAGE2}: {WHY ITS BAD}
 *
 * **Performance**:
 * - Time: O(n*m) where n={VARIABLE1}, m={VARIABLE2}
 * - Space: O(k) where k={VARIABLE}
 * - Typical: {MILLISECONDS}ms for {TYPICAL_SIZE}
 *
 * **Appropriate For**:
 * - {USE_CASE1}
 * - {USE_CASE2}
 * - {NOT_APPROPRIATE}: {WHY}
 *
 * **Configuration**:
 * - Parameter1 ({UNIT}): Default={VALUE}, Range=[{MIN}, {MAX}]
 * - Parameter2 ({UNIT}): Default={VALUE}, Range=[{MIN}, {MAX}]
 *
 * **Future Improvements**:
 * - {IMPROVEMENT1}: Would require {EFFORT}
 * - {IMPROVEMENT2}: Blocked by {BLOCKER}
 *
 * @param {string} content - Content to chunk
 * @param {string} parentDocumentId - Parent document reference
 * @param {number} chunkSize - Max chunk size in tokens (default: 512)
 * @param {number} overlap - Overlap in tokens (default: 50)
 * @returns {Chunk[]} Array of chunks with metadata
 *
 * @example
 * const chunks = chunkMarkdown(content, 'doc-123', 512, 50);
 * console.log(`Generated ${chunks.length} chunks`);
 */
function chunk{StrategyName}(
  content: string,
  parentDocumentId: string,
  chunkSize: number,
  overlap: number
): Chunk[]
```

### Real Example (Markdown Chunking)
```typescript
/**
 * Markdown Chunking Strategy
 *
 * **Overview**:
 * Preserves markdown document structure by splitting on heading hierarchy
 * while maintaining semantic coherence within sections. Nested headings
 * (h2 under h1) are kept together.
 *
 * **Algorithm**:
 * 1. Split content into lines
 * 2. Identify heading lines (^#{1,6} pattern)
 * 3. Group content between headings as sections
 * 4. For each section:
 *    a. If within chunk size: create single chunk
 *    b. If too large: recursively apply semantic chunking
 * 5. Attach heading context to each chunk metadata
 * 6. Calculate token counts and offsets
 *
 * **Advantages**:
 * - Preserves document structure (navigation, hierarchy)
 * - Heading information available for filtering
 * - Can group related content better than semantic chunking
 * - Good for documentation and structured content
 *
 * **Disadvantages**:
 * - Requires valid markdown syntax
 * - Uneven section sizes create variable chunk sizes
 * - May create very large chunks if section is big
 * - Requires fallback to semantic chunking for large sections
 *
 * **Performance**:
 * - Time: O(n*log n) where n = lines
 * - Space: O(s) where s = section count
 * - Typical: 50ms for 100KB markdown
 *
 * **Appropriate For**:
 * - Documentation (README, guides, API docs)
 * - Markdown blogs
 * - Structured technical content
 * - NOT appropriate: PDFs, plain text, unstructured content
 *
 * **Configuration**:
 * - chunkSize (tokens): Default=512, Range=[256, 2048]
 * - overlap (tokens): Default=50, Range=[10, 256]
 *
 * **Future Improvements**:
 * - Handle markdown metadata/frontmatter
 * - Support list-based navigation
 * - Implement table-aware chunking
 *
 * @param {string} content - Markdown content
 * @param {string} parentDocumentId - Parent document reference
 * @param {number} chunkSize - Max chunk size in tokens
 * @param {number} overlap - Overlap in tokens
 * @returns {Chunk[]} Markdown-aware chunks with heading context
 *
 * @example
 * const markdown = `
 * # Main Topic
 * ## Subtopic
 * Some content here
 * ## Another Subtopic
 * More content
 * `;
 * const chunks = chunkMarkdown(markdown, 'doc-123', 512, 50);
 * console.log(chunks[0].metadata.heading); // "Subtopic"
 */
function chunkMarkdown(
  content: string,
  parentDocumentId: string,
  chunkSize: number,
  overlap: number
): Chunk[]
```

---

## Template 7: Configuration Object

### Usage
Use this for configuration exports.

### Template
```typescript
/**
 * {CONFIG_NAME} configuration
 *
 * **Purpose**:
 * {WHAT DOES THIS CONFIG DO}
 *
 * **Values**:
 * - {PROPERTY1}: {VALUE} ({UNIT}) - {DESCRIPTION}
 * - {PROPERTY2}: {VALUE} ({UNIT}) - {DESCRIPTION}
 *
 * **Impact**:
 * - Performance: {IMPACT}
 * - Memory: {IMPACT}
 * - Cost: {IMPACT}
 *
 * **Tuning Strategy**:
 * {HOW TO ADJUST FOR DIFFERENT SCENARIOS}
 *
 * **Constraints**:
 * - {CONSTRAINT1}: {WHY}
 * - {CONSTRAINT2}: {WHY}
 *
 * @type {Object}
 */
export const {configName} = {
  // Properties
};
```

### Real Example (Queue Configuration)
```typescript
/**
 * Concurrency configuration for processing queues
 *
 * **Purpose**:
 * Defines the number of concurrent workers per queue, balancing
 * throughput against resource usage and rate limits.
 *
 * **Values**:
 * - extraction: 5 (network I/O bound, safe to parallelize)
 * - chunking: 3 (CPU intensive, match to core count)
 * - embedding: 2 (API rate limited to 3500 RPM)
 * - indexing: 1 (database transactions, ensure consistency)
 *
 * **Impact**:
 * - Performance: Higher = faster throughput (up to limits)
 * - Memory: Higher = more connection pools and heap usage
 * - Cost: Extraction/Chunking higher cost with parallel, Embedding limited by API
 *
 * **Tuning Strategy**:
 * - Single machine: Use defaults
 * - High throughput: Increase extraction/chunking by 2x
 * - Cost optimization: Reduce extraction to 3, increase batch sizes
 * - Low-resource: Reduce all by 50%
 *
 * **Constraints**:
 * - Embedding: Max 2 due to 3500 RPM API limit
 * - Indexing: Keep at 1 for transaction consistency
 * - Total: Sum ≤ CPU count for best performance
 *
 * @type {Object}
 */
export const concurrencySettings = {
  extraction: parseInt(process.env.BULLMQ_CONCURRENCY_EXTRACTION || '5', 10),
  chunking: parseInt(process.env.BULLMQ_CONCURRENCY_CHUNKING || '3', 10),
  embedding: parseInt(process.env.BULLMQ_CONCURRENCY_EMBEDDING || '2', 10),
  indexing: parseInt(process.env.BULLMQ_CONCURRENCY_INDEXING || '1', 10),
};
```

---

## Best Practices Checklist

### Before Writing JSDoc

- [ ] Function/class already exists and works
- [ ] You understand the code flow
- [ ] You know the performance characteristics
- [ ] You understand error cases
- [ ] You know downstream consumers

### While Writing JSDoc

- [ ] Use complete sentences
- [ ] Explain the "why", not just the "what"
- [ ] Include performance characteristics (O-notation)
- [ ] Document all error cases
- [ ] Provide real usage examples
- [ ] Explain when to use vs when not to use
- [ ] List configuration options and impact
- [ ] Document any constraints or limitations

### After Writing JSDoc

- [ ] Run IDE to check for rendering issues
- [ ] Verify examples compile (if code examples)
- [ ] Check cross-references are correct
- [ ] Ensure consistency with other documentation
- [ ] Have peer review before merging

---

## Common Documentation Antipatterns

### ❌ Bad Examples

```typescript
// AVOID: Just repeats the code
/**
 * Get the user ID
 */
function getUserId() { ... }

// AVOID: Vague description
/**
 * Does the thing
 */
async function processJob(job: Job) { ... }

// AVOID: Missing error documentation
/**
 * Saves data to database
 */
async function saveData(data: Data): Promise<void> { ... }

// AVOID: No examples
/**
 * This worker processes embeddings
 */
export class EmbeddingWorker { ... }
```

### ✅ Good Examples

```typescript
// GOOD: Clear purpose and behavior
/**
 * Extract user ID from JWT token
 * @throws {Error} If token is invalid or expired
 * @returns {Promise<string>} The user ID
 */
function getUserId(token: string): Promise<string> { ... }

// GOOD: Explains what, why, and when
/**
 * Process embedding job by:
 * 1. Validating input chunks
 * 2. Batching for API efficiency
 * 3. Applying rate limiting
 * 4. Storing results in vector database
 *
 * Uses this strategy to balance cost and throughput.
 */
async function processJob(job: Job): Promise<Result> { ... }

// GOOD: Documents errors and recovery
/**
 * Save data to database with transaction safety
 * @throws {DatabaseError} On connection failure (will retry)
 * @throws {ValidationError} On invalid data (permanent failure)
 */
async function saveData(data: Data): Promise<void> { ... }

// GOOD: Includes usage examples
/**
 * This worker processes embeddings
 *
 * @example
 * const worker = await createEmbeddingWorker();
 * worker.on('completed', (job) => console.log('Done'));
 */
export class EmbeddingWorker { ... }
```

---

## Applying These Templates

### Step 1: Choose the Right Template
Match your code to one of the 7 template types above.

### Step 2: Copy the Template
Copy the appropriate template section.

### Step 3: Customize
Replace {PLACEHOLDERS} with actual information:
- {WORKER_NAME} → "Extraction", "Chunking", etc.
- {STEP1}, {STEP2}, etc. → Actual processing steps
- {VALUE} → Actual configuration values

### Step 4: Add Examples
Include at least one `@example` section with real code.

### Step 5: Validate
- [ ] IDE shows documentation on hover
- [ ] No placeholder text remains
- [ ] Examples are syntactically correct
- [ ] Cross-references are valid

---

## IDE Integration

### VSCode
JSDoc comments automatically appear in:
- Hover tooltips
- Autocomplete suggestions
- Go to definition

### IntelliJ IDEA
JSDoc comments appear in:
- Hover documentation (Ctrl+Q)
- Autocomplete suggestions
- Documentation popup (Ctrl+Shift+P)

### TypeScript
JSDoc comments used for:
- Type inference
- Documentation generation
- IDE hints

---

**Last Updated**: February 2, 2026
**Version**: 1.0
**Audience**: Phase 2 Developer Team
