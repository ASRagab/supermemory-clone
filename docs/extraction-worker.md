# Extraction Worker Documentation

## Overview

The Extraction Worker is a BullMQ-based background worker that processes documents from the extraction queue, extracts content using appropriate extractors, and chains to the chunking queue for further processing.

## Architecture

### Flow Diagram

```
┌─────────────────┐
│  Job Received   │ (0%)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Fetch Document  │
│  from Database  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Detect Content  │ (25%)
│      Type       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Call Extractor  │ (50%)
│ (Text/URL/PDF/  │
│  Markdown/Code) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Save Content   │ (75%)
│  to Database    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Chain to      │ (90%)
│ Chunking Queue  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Mark Complete   │ (100%)
└─────────────────┘
```

## Features

### Content Types Supported

1. **Text** - Plain text content
2. **URL** - Web pages (fetched and parsed)
3. **PDF** - PDF documents
4. **Markdown** - Markdown files with frontmatter
5. **Code** - Source code files (JS, TS, Python, Java, etc.)

### Progress Tracking

The worker updates job progress at key milestones:

- **0%** - Job received
- **25%** - Content type detected
- **50%** - Content extracted
- **75%** - Saved to database
- **90%** - Chained to chunking queue
- **100%** - Complete

### Error Handling

#### Retry Logic

- **Max Attempts**: 3
- **Backoff Strategy**: Exponential
- **Base Delay**: 2 seconds (2s, 4s, 8s)

#### Failure Handling

1. Update `processing_queue` table with error details
2. Update `documents` table status to 'failed'
3. After max retries, mark as 'failed' (dead letter queue)

### Database Updates

#### Processing Queue

```typescript
// On start
{
  status: 'processing',
  startedAt: new Date(),
  workerId: job.id
}

// On success
{
  status: 'completed',
  completedAt: new Date()
}

// On error
{
  status: 'retry' | 'failed',
  error: errorMessage,
  errorCode: 'EXTRACTION_FAILED',
  attempts: attemptNumber
}
```

#### Documents Table

```typescript
// On success
{
  content: extractedContent,
  contentType: detectedType,
  metadata: { ...existing, ...extracted },
  status: 'processing',
  updatedAt: new Date()
}

// On error
{
  status: 'failed',
  updatedAt: new Date()
}
```

## Usage

### Starting the Worker

```typescript
import { createExtractionWorker } from './src/workers/extraction.worker.js';
import IORedis from 'ioredis';

const connection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});

const worker = createExtractionWorker(connection);

// Graceful shutdown
process.on('SIGTERM', async () => {
  await worker.close();
  await connection.quit();
});
```

### Enqueueing Jobs

```typescript
import { createExtractionQueue } from './src/workers/extraction.worker.js';

const queue = createExtractionQueue(connection);

// Add text extraction job
await queue.add('extract', {
  documentId: 'doc-123',
  sourceType: 'text',
  containerTag: 'user-456',
});

// Add URL extraction job
await queue.add('extract', {
  documentId: 'doc-124',
  sourceUrl: 'https://example.com/article',
  sourceType: 'url',
  containerTag: 'user-456',
});

// Add file extraction job
await queue.add('extract', {
  documentId: 'doc-125',
  sourceType: 'file',
  filePath: '/tmp/uploads/document.pdf',
  containerTag: 'user-456',
}, {
  priority: 5, // Higher priority
});
```

### Monitoring Jobs

```typescript
// Get job status
const job = await queue.getJob('job-id');
const state = await job.getState();
const progress = job.progress;

console.log(`Job state: ${state}, Progress: ${progress}%`);

// Wait for completion
const result = await job.waitUntilFinished();
console.log(`Extracted ${result.extractedContent.length} characters`);
```

## Configuration

### Environment Variables

```env
# Redis connection
REDIS_URL=redis://localhost:6379

# Worker concurrency (default: 5)
BULLMQ_CONCURRENCY_EXTRACTION=5
```

### Worker Options

- **Concurrency**: 5 jobs in parallel (configurable via env)
- **Rate Limiting**: 10 jobs per second
- **Remove On Complete**: Keep last 100 completed jobs
- **Remove On Fail**: Keep last 500 failed jobs

### Job Options

- **Attempts**: 3 retries
- **Backoff**: Exponential (2s, 4s, 8s)
- **Priority**: 0-10 (higher = more important)
- **Remove On Complete**: Auto-remove after completion
- **Remove On Fail**: Keep failed jobs for debugging

## Content Type Detection

### Detection Strategy

1. **Explicit Source Type**: Use provided `sourceType` if available
2. **File Extension**: Detect from `filePath` extension
3. **URL Pattern**: Check if content is a valid URL
4. **Content Patterns**: Analyze content for markdown/code patterns
5. **Default**: Fall back to 'text'

### Detection Examples

```typescript
// URL detection
'https://example.com' → 'url'

// File extension
'document.pdf' → 'pdf'
'notes.md' → 'markdown'
'script.js' → 'code'

// Content pattern
'# Heading\n\n**bold**' → 'markdown'
'function hello() {}' → 'code'
'Plain text' → 'text'
```

## Extractor Integration

### Available Extractors

- **TextExtractor**: Cleans and normalizes text
- **UrlExtractor**: Fetches and parses HTML
- **PdfExtractor**: Extracts text from PDF files
- **MarkdownExtractor**: Parses markdown with frontmatter
- **CodeExtractor**: AST-aware code parsing

### Extraction Result

```typescript
interface ExtractionResult {
  content: string;           // Cleaned extracted content
  contentType: ContentType;  // Detected content type
  metadata: {
    title?: string;
    author?: string;
    description?: string;
    wordCount?: number;
    charCount?: number;
    [key: string]: unknown;
  };
  rawContent?: string;       // Original raw content
}
```

## Queue Chaining

After successful extraction, the worker automatically chains to the chunking queue:

```typescript
await chunkingQueue.add('chunk', {
  documentId: doc.id,
  content: extractedContent,
  contentType: detectedType,
  containerTag: containerTag,
}, {
  priority: job.opts.priority || 0,
});
```

## Error Codes

| Code | Description |
|------|-------------|
| `EXTRACTION_FAILED` | General extraction failure |
| `DOCUMENT_NOT_FOUND` | Document ID not found in database |
| `EXTRACTOR_ERROR` | Specific extractor failed |
| `NETWORK_ERROR` | URL fetch failed |
| `PARSE_ERROR` | Content parsing failed |

## Performance

### Benchmarks

- **Text Extraction**: ~50ms average
- **URL Extraction**: ~200-500ms (network dependent)
- **PDF Extraction**: ~100-300ms (size dependent)
- **Markdown Extraction**: ~75ms average
- **Code Extraction**: ~100ms average

### Optimization Tips

1. **Increase Concurrency**: Adjust `BULLMQ_CONCURRENCY_EXTRACTION` for more parallel jobs
2. **Priority Queuing**: Use priority for important documents
3. **Batch Processing**: Group similar content types together
4. **Connection Pooling**: Reuse Redis connections

## Testing

### Running Tests

```bash
npm run test -- tests/workers/extraction.worker.test.ts
```

### Test Coverage

The test suite covers:

- Content type detection for all types
- Progress tracking through all stages
- Database updates (documents and processing_queue)
- Error handling and retry logic
- Dead letter queue after max retries
- Queue chaining to chunking
- Worker and queue creation
- Performance benchmarks

### Mock Setup

Tests use mock Redis connections and database to avoid external dependencies:

```typescript
const mockConnection = {
  host: 'localhost',
  port: 6379,
};
```

## Monitoring

### Worker Events

```typescript
worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed:`, err);
});

worker.on('error', (err) => {
  console.error('Worker error:', err);
});

worker.on('active', (job) => {
  console.log(`Processing job ${job.id}`);
});
```

### Metrics

Monitor these key metrics:

- **Job throughput**: Jobs processed per minute
- **Success rate**: Completed / Total jobs
- **Average processing time**: Per content type
- **Retry rate**: Jobs requiring retries
- **Error rate**: Jobs failing after max retries

## Troubleshooting

### Common Issues

#### Jobs Stuck in Processing

**Cause**: Worker crashed or connection lost

**Solution**:
```typescript
// Check for stale jobs
const staleJobs = await queue.getJobs(['active']);
for (const job of staleJobs) {
  const timeSinceUpdate = Date.now() - job.timestamp;
  if (timeSinceUpdate > 300000) { // 5 minutes
    await job.retry();
  }
}
```

#### High Memory Usage

**Cause**: Too many completed jobs in memory

**Solution**:
```typescript
// Reduce retention
worker.opts.removeOnComplete = { count: 50 };
worker.opts.removeOnFail = { count: 100 };
```

#### Slow URL Extraction

**Cause**: Network latency or large pages

**Solution**:
```typescript
// Increase timeout
const extractionOptions = {
  timeout: 60000, // 60 seconds
};
```

## Future Enhancements

- [ ] Support for more file types (DOCX, RTF, EPUB)
- [ ] Parallel extractor execution for multi-format documents
- [ ] Caching layer for frequently extracted URLs
- [ ] Streaming extraction for very large files
- [ ] Webhook notifications on completion
- [ ] GraphQL subscription for real-time updates

## Related Documentation

- [Extractors](./extractors.md)
- [Chunking Worker](./chunking-worker.md)
- [Processing Pipeline](./processing-pipeline.md)
- [BullMQ Documentation](https://docs.bullmq.io/)

---

**Last Updated**: 2026-02-02
**Task**: TASK-007
**Status**: Complete
