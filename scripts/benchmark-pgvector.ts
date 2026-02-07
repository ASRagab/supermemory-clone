#!/usr/bin/env tsx
/**
 * PgVectorStore Performance Benchmark
 *
 * Measures insert and search performance with various dataset sizes
 */

import { createPgVectorStore } from '../src/services/vectorstore/pgvector.js';
import { VectorEntry } from '../src/services/vectorstore/types.js';

const POSTGRES_URL = process.env.TEST_POSTGRES_URL ?? 'postgresql://supermemory:supermemory_secret@localhost:5432/supermemory';
const DIMENSIONS = 1536;

interface BenchmarkResult {
  operation: string;
  itemCount: number;
  totalTimeMs: number;
  avgTimePerItemMs: number;
  opsPerSecond: number;
}

function formatResults(results: BenchmarkResult[]) {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║          PgVectorStore Performance Benchmark Results              ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  for (const result of results) {
    console.log(`Operation: ${result.operation}`);
    console.log(`  Items: ${result.itemCount}`);
    console.log(`  Total Time: ${result.totalTimeMs.toFixed(2)}ms`);
    console.log(`  Avg Time/Item: ${result.avgTimePerItemMs.toFixed(4)}ms`);
    console.log(`  Ops/Second: ${result.opsPerSecond.toFixed(2)}`);
    console.log('');
  }
}

async function benchmarkInsert(store: any, count: number): Promise<BenchmarkResult> {
  const entries: VectorEntry[] = Array.from({ length: count }, (_, i) => ({
    id: `bench-insert-${i}`,
    embedding: new Array(DIMENSIONS).fill(0).map(() => Math.random()),
    metadata: { index: i, benchmark: 'insert' },
  }));

  const start = performance.now();
  await store.addBatch(entries);
  const totalTime = performance.now() - start;

  return {
    operation: 'Batch Insert',
    itemCount: count,
    totalTimeMs: totalTime,
    avgTimePerItemMs: totalTime / count,
    opsPerSecond: (count / totalTime) * 1000,
  };
}

async function benchmarkSearch(store: any, vectorCount: number, searchCount: number): Promise<BenchmarkResult> {
  const queryVector = new Array(DIMENSIONS).fill(0.5);
  const start = performance.now();

  for (let i = 0; i < searchCount; i++) {
    await store.search(queryVector, { limit: 10 });
  }

  const totalTime = performance.now() - start;

  return {
    operation: `Search (${vectorCount} vectors)`,
    itemCount: searchCount,
    totalTimeMs: totalTime,
    avgTimePerItemMs: totalTime / searchCount,
    opsPerSecond: (searchCount / totalTime) * 1000,
  };
}

async function main() {
  console.log('Starting PgVectorStore performance benchmarks...\n');

  const store = createPgVectorStore(POSTGRES_URL, DIMENSIONS, {
    tableName: 'benchmark_vectors',
    hnswConfig: {
      M: 16,
      efConstruction: 64,
    },
  });

  await store.initialize();
  await store.clear();

  const results: BenchmarkResult[] = [];

  // Benchmark 1: Insert 1,000 vectors
  console.log('Running benchmark: Insert 1,000 vectors...');
  results.push(await benchmarkInsert(store, 1000));

  // Benchmark 2: Search with 1,000 vectors
  console.log('Running benchmark: Search (1,000 vectors)...');
  results.push(await benchmarkSearch(store, 1000, 100));

  // Benchmark 3: Insert 10,000 vectors
  console.log('Running benchmark: Insert 10,000 vectors...');
  await store.clear();
  results.push(await benchmarkInsert(store, 10000));

  // Benchmark 4: Search with 10,000 vectors
  console.log('Running benchmark: Search (10,000 vectors)...');
  results.push(await benchmarkSearch(store, 10000, 100));

  // Clean up
  await store.clear();
  await store.close();

  formatResults(results);

  // Check performance targets
  console.log('Performance Target Validation:');
  console.log('  Insert < 10ms per item:', results[0]!.avgTimePerItemMs < 10 ? '✓ PASS' : '✗ FAIL');
  console.log('  Search < 100ms (10K vectors):', results[3]!.avgTimePerItemMs < 100 ? '✓ PASS' : '✗ FAIL');
  console.log('  Batch insert < 500ms (100 items):', results[0]!.totalTimeMs < 500 ? '✓ PASS' : '✗ FAIL');
}

main().catch(console.error);
