#!/usr/bin/env tsx
/**
 * Extraction Worker Runner
 *
 * Starts the extraction worker to process documents from the queue.
 * Run with: npx tsx scripts/run-extraction-worker.ts
 */

import { createExtractionWorker } from '../src/workers/extraction.worker.js';
import IORedis from 'ioredis';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Redis connection
const connection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

console.log('[ExtractionWorker] Starting worker...');
console.log(`[ExtractionWorker] Redis: ${connection.options.host}:${connection.options.port}`);
console.log(
  `[ExtractionWorker] Concurrency: ${process.env.BULLMQ_CONCURRENCY_EXTRACTION || 5}`
);

// Create and start worker
const worker = createExtractionWorker(connection);

// Handle shutdown
const shutdown = async () => {
  console.log('\n[ExtractionWorker] Shutting down gracefully...');
  await worker.close();
  await connection.quit();
  console.log('[ExtractionWorker] Shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('[ExtractionWorker] Worker started successfully. Waiting for jobs...');
console.log('[ExtractionWorker] Press Ctrl+C to stop');
