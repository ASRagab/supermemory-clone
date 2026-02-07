/**
 * Vector Store Migration Utilities
 *
 * Utilities for migrating vector data between different vector store implementations.
 * Supports batch processing with progress tracking and error handling.
 */

import {
  MigrationProgress,
  BatchResult,
} from './types.js';
import { InMemoryVectorStore } from './memory.js';
import { PgVectorStore } from './pgvector.js';

/**
 * Migrate vectors from InMemoryVectorStore to PgVectorStore
 */
export async function migrateMemoryToPgVector(
  source: InMemoryVectorStore,
  target: PgVectorStore,
  options?: {
    batchSize?: number;
    onProgress?: (progress: MigrationProgress) => void;
  }
): Promise<BatchResult> {
  const batchSize = options?.batchSize ?? 100;

  // Get all entries from source
  const entries = await source.getAllEntries();
  const total = entries.length;

  if (total === 0) {
    return {
      successful: 0,
      failed: 0,
      errors: [],
    };
  }

  // Initialize result
  const result: BatchResult = {
    successful: 0,
    failed: 0,
    errors: [],
  };

  // Calculate batches
  const totalBatches = Math.ceil(total / batchSize);
  let currentBatch = 0;
  const startTime = Date.now();

  // Process in batches
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    currentBatch++;

    // Add batch to target
    const batchResult = await target.addBatch(batch, { overwrite: true });

    // Update result
    result.successful += batchResult.successful;
    result.failed += batchResult.failed;
    if (batchResult.errors && batchResult.errors.length > 0) {
      result.errors?.push(...batchResult.errors);
    }

    // Calculate progress
    const migrated = Math.min(i + batchSize, total);
    const percentage = (migrated / total) * 100;
    const elapsed = Date.now() - startTime;
    const estimatedTotal = (elapsed / migrated) * total;
    const estimatedTimeRemaining = (estimatedTotal - elapsed) / 1000;

    // Report progress
    if (options?.onProgress) {
      const progress: MigrationProgress = {
        total,
        migrated,
        percentage,
        currentBatch,
        totalBatches,
        estimatedTimeRemaining,
      };
      options.onProgress(progress);
    }
  }

  return result;
}

/**
 * Migrate all vectors from source to target with automatic type detection
 */
export async function migrateVectorStore(
  source: InMemoryVectorStore | PgVectorStore,
  target: InMemoryVectorStore | PgVectorStore,
  options?: {
    batchSize?: number;
    onProgress?: (progress: MigrationProgress) => void;
  }
): Promise<BatchResult> {
  // Detect migration type
  const isMemoryToMemory = source instanceof InMemoryVectorStore && target instanceof InMemoryVectorStore;
  const isMemoryToPg = source instanceof InMemoryVectorStore && target instanceof PgVectorStore;
  const isPgToPg = source instanceof PgVectorStore && target instanceof PgVectorStore;

  if (isMemoryToMemory || isPgToPg) {
    console.warn('Migrating between same store types. Consider using copy instead.');
  }

  // Perform migration
  if (isMemoryToPg) {
    return migrateMemoryToPgVector(source, target, options);
  }

  // Generic migration for other types
  return genericMigration(source, target, options);
}

/**
 * Generic migration implementation
 */
async function genericMigration(
  source: InMemoryVectorStore | PgVectorStore,
  target: InMemoryVectorStore | PgVectorStore,
  options?: {
    batchSize?: number;
    onProgress?: (progress: MigrationProgress) => void;
  }
): Promise<BatchResult> {
  const batchSize = options?.batchSize ?? 100;

  // Get all entries
  const entries = await source.getAllEntries();
  const total = entries.length;

  if (total === 0) {
    return {
      successful: 0,
      failed: 0,
      errors: [],
    };
  }

  // Initialize result
  const result: BatchResult = {
    successful: 0,
    failed: 0,
    errors: [],
  };

  // Calculate batches
  const totalBatches = Math.ceil(total / batchSize);
  let currentBatch = 0;
  const startTime = Date.now();

  // Process in batches
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    currentBatch++;

    // Add batch to target
    const batchResult = await target.addBatch(batch, { overwrite: true });

    // Update result
    result.successful += batchResult.successful;
    result.failed += batchResult.failed;
    if (batchResult.errors && batchResult.errors.length > 0) {
      result.errors?.push(...batchResult.errors);
    }

    // Calculate progress
    const migrated = Math.min(i + batchSize, total);
    const percentage = (migrated / total) * 100;
    const elapsed = Date.now() - startTime;
    const estimatedTotal = (elapsed / migrated) * total;
    const estimatedTimeRemaining = (estimatedTotal - elapsed) / 1000;

    // Report progress
    if (options?.onProgress) {
      const progress: MigrationProgress = {
        total,
        migrated,
        percentage,
        currentBatch,
        totalBatches,
        estimatedTimeRemaining,
      };
      options.onProgress(progress);
    }
  }

  return result;
}

/**
 * Verify migration by comparing vector counts and sample entries
 */
export async function verifyMigration(
  source: InMemoryVectorStore | PgVectorStore,
  target: InMemoryVectorStore | PgVectorStore,
  sampleSize = 10
): Promise<{
  success: boolean;
  issues: string[];
  sourceCount: number;
  targetCount: number;
  samplesMatch: number;
  samplesMismatch: number;
}> {
  const issues: string[] = [];
  let samplesMatch = 0;
  let samplesMismatch = 0;

  // Compare counts
  const sourceStats = await source.getStats();
  const targetStats = await target.getStats();
  const sourceCount = sourceStats.totalVectors;
  const targetCount = targetStats.totalVectors;

  if (sourceCount !== targetCount) {
    issues.push(
      `Vector count mismatch: source has ${sourceCount}, target has ${targetCount}`
    );
  }

  // Compare dimensions
  if (sourceStats.dimensions !== targetStats.dimensions) {
    issues.push(
      `Dimension mismatch: source has ${sourceStats.dimensions}, target has ${targetStats.dimensions}`
    );
  }

  // Sample verification
  const sourceEntries = await source.getAllEntries();
  const sampleIndices = new Set<number>();

  // Generate random sample indices
  while (sampleIndices.size < Math.min(sampleSize, sourceEntries.length)) {
    sampleIndices.add(Math.floor(Math.random() * sourceEntries.length));
  }

  // Compare samples
  for (const index of sampleIndices) {
    const sourceEntry = sourceEntries[index];
    if (!sourceEntry) continue;

    const targetEntry = await target.get(sourceEntry.id);

    if (!targetEntry) {
      issues.push(`Entry ${sourceEntry.id} not found in target`);
      samplesMismatch++;
      continue;
    }

    // Compare embeddings
    const embeddingsMatch = sourceEntry.embedding.every(
      (val, i) => Math.abs(val - (targetEntry.embedding[i] ?? 0)) < 0.0001
    );

    if (!embeddingsMatch) {
      issues.push(`Embedding mismatch for entry ${sourceEntry.id}`);
      samplesMismatch++;
      continue;
    }

    // Compare metadata
    const metadataMatch =
      JSON.stringify(sourceEntry.metadata) === JSON.stringify(targetEntry.metadata);

    if (!metadataMatch) {
      issues.push(`Metadata mismatch for entry ${sourceEntry.id}`);
      samplesMismatch++;
      continue;
    }

    samplesMatch++;
  }

  return {
    success: issues.length === 0,
    issues,
    sourceCount,
    targetCount,
    samplesMatch,
    samplesMismatch,
  };
}

/**
 * Create a progress reporter function
 */
export function createProgressReporter(
  onUpdate?: (message: string) => void
): (progress: MigrationProgress) => void {
  return (progress: MigrationProgress) => {
    const message = `Migration progress: ${progress.migrated}/${progress.total} (${progress.percentage.toFixed(1)}%) - Batch ${progress.currentBatch}/${progress.totalBatches}${progress.estimatedTimeRemaining ? ` - ETA: ${Math.round(progress.estimatedTimeRemaining)}s` : ''}`;

    if (onUpdate) {
      onUpdate(message);
    } else {
      console.log(message);
    }
  };
}
