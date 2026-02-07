#!/usr/bin/env tsx
/**
 * Add Extraction Job
 *
 * Example script to add a job to the extraction queue.
 * Run with: npx tsx scripts/add-extraction-job.ts
 */

import { createExtractionQueue } from '../src/workers/extraction.worker.js';
import { getDatabase } from '../src/db/index.js';
import { documents, processingQueue } from '../src/db/schema/index.js';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || './data/supermemory.db';
const db = getDatabase(DATABASE_URL);

// Redis connection
const connection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null,
});

async function main() {
  console.log('[AddJob] Creating test document...');

  // Create test document
  const documentId = uuidv4();
  const containerTag = 'test-user';

  await db.insert(documents).values({
    id: documentId,
    content: `# Test Document

This is a test document for the extraction worker.

## Features

- Text extraction
- URL extraction
- PDF extraction
- Markdown extraction
- Code extraction

## Example Code

\`\`\`javascript
function hello() {
  console.log('Hello, World!');
}
\`\`\`

Visit [our website](https://example.com) for more information.
`,
    contentType: 'text/plain',
    status: 'pending',
    containerTag,
    metadata: {
      source: 'test-script',
      createdBy: 'add-extraction-job.ts',
    },
  });

  console.log(`[AddJob] Document created: ${documentId}`);

  // Create processing queue entry
  await db.insert(processingQueue).values({
    documentId,
    stage: 'extraction',
    status: 'pending',
    priority: 5,
  });

  console.log('[AddJob] Processing queue entry created');

  // Add job to extraction queue
  const queue = createExtractionQueue(connection);

  const job = await queue.add(
    'extract',
    {
      documentId,
      sourceType: 'text',
      containerTag,
    },
    {
      priority: 5,
      jobId: `extraction-${documentId}`,
    }
  );

  console.log(`[AddJob] Job added to queue: ${job.id}`);
  console.log('[AddJob] Waiting for job to complete...');

  // Wait for completion (with timeout)
  try {
    const result = await job.waitUntilFinished(queue.events, 60000); // 60 second timeout
    console.log('[AddJob] Job completed successfully!');
    console.log(`[AddJob] Extracted ${result.extractedContent.length} characters`);
    console.log(`[AddJob] Content type: ${result.contentType}`);
    console.log(`[AddJob] Processing time: ${result.processingTimeMs}ms`);
  } catch (error) {
    console.error('[AddJob] Job failed or timed out:', error);
  }

  // Cleanup
  await queue.close();
  await connection.quit();

  console.log('[AddJob] Done!');
  process.exit(0);
}

main().catch((error) => {
  console.error('[AddJob] Error:', error);
  process.exit(1);
});
