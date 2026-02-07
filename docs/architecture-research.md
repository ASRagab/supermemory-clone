# Architecture Research: Supermemory.ai Clone

This document synthesizes research findings for building a supermemory.ai-style memory infrastructure with vector search, knowledge graph relationships, smart chunking, and hybrid retrieval.

---

## Table of Contents

1. [Vector Database Patterns](#1-vector-database-patterns)
2. [Knowledge Graph Memory](#2-knowledge-graph-memory)
3. [Smart Chunking Strategies](#3-smart-chunking-strategies)
4. [Processing Pipeline](#4-processing-pipeline)
5. [Hybrid Search Architecture](#5-hybrid-search-architecture)
6. [Technology Recommendations](#6-technology-recommendations)
7. [References](#7-references)

---

## 1. Vector Database Patterns

### 1.1 Overview

Vector databases store high-dimensional embeddings and enable similarity search. For a TypeScript/Node.js stack, three primary options exist:

| Database | Best For | Performance | Concurrency |
|----------|----------|-------------|-------------|
| **pgvector** | Production, multi-user | HNSW/IVFFlat indexing | High (PostgreSQL) |
| **sqlite-vec** | Embedded, local-first | Cosine similarity | Limited (file-level locks) |
| **In-memory (AgentDB)** | High-performance, caching | Sub-100us HNSW | Single process |

### 1.2 pgvector (PostgreSQL)

pgvector transforms PostgreSQL into a vector database with HNSW (Hierarchical Navigable Small World) indexing.

**Advantages:**
- HNSW indexing: O(log n) search complexity
- High concurrency with PostgreSQL connection pooling
- Supports cosine similarity, euclidean distance, dot product
- Scales to 50-100M+ vectors with proper indexing

**Node.js Integration:**
```typescript
import { Pool } from 'pg';
import pgvector from 'pgvector/pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Enable pgvector extension
await pool.query('CREATE EXTENSION IF NOT EXISTS vector');

// Create table with vector column
await pool.query(`
  CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    embedding vector(1536),  -- OpenAI text-embedding-3-small
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`);

// Create HNSW index for fast similarity search
await pool.query(`
  CREATE INDEX IF NOT EXISTS memories_embedding_idx
  ON memories USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
`);

// Similarity search
async function searchSimilar(
  embedding: number[],
  limit: number = 10,
  threshold: number = 0.7
): Promise<Memory[]> {
  const result = await pool.query(
    `SELECT *, 1 - (embedding <=> $1::vector) as similarity
     FROM memories
     WHERE 1 - (embedding <=> $1::vector) > $2
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [pgvector.toSql(embedding), threshold, limit]
  );
  return result.rows;
}
```

### 1.3 sqlite-vec (SQLite Extension)

sqlite-vec is ideal for embedded applications, local-first apps, or browser-based AI via WASM.

**Advantages:**
- Zero network latency (embedded)
- WASM support for browser/edge
- Familiar SQL interface
- Good for datasets up to ~10K vectors

**Node.js Integration:**
```typescript
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

const db = new Database(':memory:');
sqliteVec.load(db);

// Create virtual table for vectors
db.exec(`
  CREATE VIRTUAL TABLE vec_memories USING vec0(
    embedding float[1536]
  )
`);

// Insert with vector
const insert = db.prepare(
  'INSERT INTO vec_memories(rowid, embedding) VALUES (?, ?)'
);
insert.run(1, new Float32Array(embedding).buffer);

// Similarity search
const search = db.prepare(`
  SELECT rowid, distance
  FROM vec_memories
  WHERE embedding MATCH ?
  ORDER BY distance
  LIMIT ?
`);
const results = search.all(new Float32Array(queryEmbedding).buffer, 10);
```

### 1.4 AgentDB (High-Performance Option)

AgentDB provides 150x-12,500x faster operations with HNSW indexing and quantization.

**Advantages:**
- Sub-100us search latency
- Binary quantization: 32x memory reduction
- Built-in caching (1000 pattern cache)
- Native TypeScript support

**Integration:**
```typescript
import { createAgentDBAdapter, computeEmbedding } from 'agentic-flow/reasoningbank';

const adapter = await createAgentDBAdapter({
  dbPath: '.agentdb/memories.db',
  enableReasoning: true,
  quantizationType: 'binary',  // 32x memory reduction
  cacheSize: 1000,
});

// Store with embedding
await adapter.insertPattern({
  id: '',
  type: 'memory',
  domain: 'user-content',
  pattern_data: JSON.stringify({
    embedding: await computeEmbedding(content),
    text: content,
    metadata: { source, timestamp: Date.now() }
  }),
  confidence: 1.0,
  usage_count: 0,
  success_count: 0,
  created_at: Date.now(),
  last_used: Date.now(),
});

// Semantic search with MMR for diversity
const results = await adapter.retrieveWithReasoning(queryEmbedding, {
  domain: 'user-content',
  k: 10,
  useMMR: true,              // Maximal Marginal Relevance
  synthesizeContext: true,   // Generate rich context
});
```

### 1.5 Quantization Strategies

| Type | Memory Reduction | Use Case |
|------|------------------|----------|
| None | 1x | Maximum precision |
| Scalar | 4x | Balanced trade-off |
| Binary | 32x | Large-scale, lower precision acceptable |
| Product | 8-16x | Compromise between size and accuracy |

---

## 2. Knowledge Graph Memory

### 2.1 Core Relationship Types

Supermemory uses three semantic relationships to track how information evolves:

```typescript
interface MemoryRelationship {
  type: 'updates' | 'extends' | 'derives';
  sourceId: string;   // New memory
  targetId: string;   // Existing memory
  confidence: number; // 0-1 relationship strength
  metadata?: Record<string, unknown>;
}
```

#### 2.1.1 Updates Relationship (State Mutation)

New information contradicts or corrects old information. Track `isLatest` flag.

```typescript
interface UpdatesRelationship {
  type: 'updates';
  sourceId: string;      // New fact
  targetId: string;      // Old fact being replaced
  isLatest: boolean;     // Mark source as authoritative
  supersededAt: Date;    // When target was superseded
  reason?: string;       // Why the update occurred
}

// Example: User changes their preference
const oldMemory = { id: 'm1', fact: 'User prefers dark mode' };
const newMemory = { id: 'm2', fact: 'User prefers light mode' };
const relationship: UpdatesRelationship = {
  type: 'updates',
  sourceId: 'm2',
  targetId: 'm1',
  isLatest: true,
  supersededAt: new Date(),
  reason: 'User explicitly changed preference'
};
```

**Query Strategy:**
```sql
-- Get latest version of a fact chain
WITH RECURSIVE fact_chain AS (
  SELECT m.*, r.target_id as supersedes
  FROM memories m
  LEFT JOIN relationships r ON r.source_id = m.id AND r.type = 'updates'
  WHERE m.id = $1

  UNION ALL

  SELECT m.*, r.target_id
  FROM memories m
  JOIN relationships r ON r.source_id = m.id AND r.type = 'updates'
  JOIN fact_chain fc ON fc.supersedes = m.id
)
SELECT * FROM fact_chain WHERE is_latest = true;
```

#### 2.1.2 Extends Relationship (Refinement)

New information enriches existing without replacing. Builds depth.

```typescript
interface ExtendsRelationship {
  type: 'extends';
  sourceId: string;      // New enrichment
  targetId: string;      // Original memory
  aspect?: string;       // What aspect is extended
  additive: true;        // Always additive, never replacing
}

// Example: Adding detail to a known fact
const originalMemory = { id: 'm1', fact: 'User works at Acme Corp' };
const extension = { id: 'm3', fact: 'User is a senior engineer at Acme Corp' };
const relationship: ExtendsRelationship = {
  type: 'extends',
  sourceId: 'm3',
  targetId: 'm1',
  aspect: 'job_title',
  additive: true
};
```

**Query Strategy:**
```sql
-- Get memory with all extensions
SELECT
  m.content as base_content,
  json_agg(e.content) as extensions
FROM memories m
LEFT JOIN relationships r ON r.target_id = m.id AND r.type = 'extends'
LEFT JOIN memories e ON e.id = r.source_id
WHERE m.id = $1
GROUP BY m.id;
```

#### 2.1.3 Derives Relationship (Inference)

Inferred facts from combining multiple distinct memories.

```typescript
interface DerivesRelationship {
  type: 'derives';
  sourceId: string;       // Inferred fact
  targetIds: string[];    // Source memories used for inference
  derivationLogic: string; // How the inference was made
  confidence: number;     // Inference confidence (typically lower)
}

// Example: Inferring from multiple facts
const fact1 = { id: 'm1', fact: 'User mentioned they commute 2 hours daily' };
const fact2 = { id: 'm2', fact: 'User works at downtown office' };
const inference = {
  id: 'm4',
  fact: 'User likely lives in suburbs or another city',
  derived: true
};
const relationship: DerivesRelationship = {
  type: 'derives',
  sourceId: 'm4',
  targetIds: ['m1', 'm2'],
  derivationLogic: 'Long commute + downtown office suggests non-urban residence',
  confidence: 0.75
};
```

### 2.2 Graph Storage Options

| Option | Best For | TypeScript Support |
|--------|----------|-------------------|
| **Neo4j** | Complex traversals, large graphs | `neo4j-driver` |
| **PostgreSQL + JSONB** | Simpler graphs, unified storage | Native with pg |
| **In-memory graph** | Small graphs, fast access | Custom implementation |

**PostgreSQL Schema for Graph:**
```sql
CREATE TABLE relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL CHECK (type IN ('updates', 'extends', 'derives')),
  source_id UUID REFERENCES memories(id) ON DELETE CASCADE,
  target_id UUID REFERENCES memories(id) ON DELETE CASCADE,
  target_ids UUID[],  -- For 'derives' with multiple sources
  confidence FLOAT DEFAULT 1.0,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT valid_derives CHECK (
    type != 'derives' OR target_ids IS NOT NULL
  )
);

CREATE INDEX relationships_source_idx ON relationships(source_id);
CREATE INDEX relationships_target_idx ON relationships(target_id);
CREATE INDEX relationships_type_idx ON relationships(type);
```

### 2.3 Graph Traversal for Retrieval

```typescript
interface GraphQuery {
  startNodeId: string;
  relationshipTypes: ('updates' | 'extends' | 'derives')[];
  maxDepth: number;
  direction: 'outgoing' | 'incoming' | 'both';
  includeSuperseded: boolean;
}

async function traverseGraph(query: GraphQuery): Promise<Memory[]> {
  const { startNodeId, relationshipTypes, maxDepth, direction, includeSuperseded } = query;

  const result = await pool.query(`
    WITH RECURSIVE graph_traversal AS (
      SELECT
        m.id, m.content, m.embedding, m.is_latest,
        0 as depth,
        ARRAY[m.id] as path
      FROM memories m
      WHERE m.id = $1

      UNION ALL

      SELECT
        m.id, m.content, m.embedding, m.is_latest,
        gt.depth + 1,
        gt.path || m.id
      FROM graph_traversal gt
      JOIN relationships r ON
        CASE
          WHEN $4 = 'outgoing' THEN r.source_id = gt.id
          WHEN $4 = 'incoming' THEN r.target_id = gt.id
          ELSE r.source_id = gt.id OR r.target_id = gt.id
        END
      JOIN memories m ON m.id = CASE
        WHEN $4 = 'outgoing' THEN r.target_id
        WHEN $4 = 'incoming' THEN r.source_id
        ELSE CASE WHEN r.source_id = gt.id THEN r.target_id ELSE r.source_id END
      END
      WHERE
        gt.depth < $3
        AND NOT m.id = ANY(gt.path)
        AND r.type = ANY($2::text[])
    )
    SELECT DISTINCT ON (id) * FROM graph_traversal
    WHERE is_latest = true OR $5 = true
    ORDER BY id, depth
  `, [startNodeId, relationshipTypes, maxDepth, direction, includeSuperseded]);

  return result.rows;
}
```

---

## 3. Smart Chunking Strategies

### 3.1 Overview

Chunking is the #1 failure point in RAG systems. Different content types require different strategies.

### 3.2 Semantic Sectioning for Documents

Split documents at semantic boundaries (headers, paragraphs, sections).

```typescript
interface DocumentChunk {
  content: string;
  metadata: {
    headingHierarchy: string[];  // ['Chapter 1', 'Section 1.1']
    startOffset: number;
    endOffset: number;
    chunkIndex: number;
    totalChunks: number;
  };
}

function chunkDocument(markdown: string, maxChunkSize: number = 1500): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const lines = markdown.split('\n');

  let currentChunk = '';
  let headingStack: string[] = [];
  let chunkIndex = 0;
  let startOffset = 0;

  for (const line of lines) {
    // Detect heading level
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const heading = headingMatch[2];

      // Flush current chunk at heading boundary
      if (currentChunk.trim()) {
        chunks.push({
          content: currentChunk.trim(),
          metadata: {
            headingHierarchy: [...headingStack],
            startOffset,
            endOffset: startOffset + currentChunk.length,
            chunkIndex: chunkIndex++,
            totalChunks: 0  // Updated at end
          }
        });
        startOffset += currentChunk.length;
        currentChunk = '';
      }

      // Update heading stack
      headingStack = headingStack.slice(0, level - 1);
      headingStack[level - 1] = heading;
    }

    // Check chunk size
    if (currentChunk.length + line.length > maxChunkSize && currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        metadata: {
          headingHierarchy: [...headingStack],
          startOffset,
          endOffset: startOffset + currentChunk.length,
          chunkIndex: chunkIndex++,
          totalChunks: 0
        }
      });
      startOffset += currentChunk.length;
      currentChunk = '';
    }

    currentChunk += line + '\n';
  }

  // Final chunk
  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      metadata: {
        headingHierarchy: [...headingStack],
        startOffset,
        endOffset: startOffset + currentChunk.length,
        chunkIndex: chunkIndex++,
        totalChunks: 0
      }
    });
  }

  // Update total chunks
  chunks.forEach(c => c.metadata.totalChunks = chunks.length);

  return chunks;
}
```

### 3.3 AST-Aware Chunking for Code

Use supermemory's [code-chunk](https://github.com/supermemoryai/code-chunk) library for semantic code splitting.

**Supported Languages:** TypeScript, JavaScript, Python, Rust, Go, Java

```typescript
import { chunk, chunkBatch, createChunker } from '@supermemory/code-chunk';

// Single file chunking
const chunks = await chunk('src/service.ts', sourceCode, {
  maxChunkSize: 1500,      // Bytes
  contextMode: 'full',      // Include scope chain, imports, siblings
  siblingDetail: 'signatures',
  overlayLines: 10          // Context overlap
});

// Each chunk includes rich context:
// chunks[0] = {
//   text: 'async getUser(id: string): Promise<User> { ... }',
//   contextualizedText: '// Scope: UserService.getUser\n// Imports: { Database }\n// Siblings: createUser, deleteUser\n\nasync getUser...',
//   startLine: 45,
//   endLine: 62,
//   entities: [{ name: 'getUser', type: 'method', signature: 'async getUser(id: string): Promise<User>' }]
// }

// Batch processing for directories
const fileChunks = await chunkBatch([
  { filepath: 'src/api.ts', content: apiSource },
  { filepath: 'src/db.ts', content: dbSource }
], {
  concurrency: 10,
  onProgress: ({ completed, total }) => console.log(`${completed}/${total}`)
});
```

**Why AST-Aware Chunking Matters:**
- Functions and classes stay intact (never split mid-expression)
- Context prepended improves embedding quality
- Scope chain helps embeddings understand relationships

### 3.4 Heading Hierarchy for Markdown

```typescript
interface MarkdownSection {
  heading: string;
  level: number;
  content: string;
  children: MarkdownSection[];
  path: string[];  // Full heading path
}

function parseMarkdownHierarchy(markdown: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  const stack: { section: MarkdownSection; level: number }[] = [];

  const lines = markdown.split('\n');
  let currentContent = '';

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      // Save accumulated content to last section
      if (stack.length > 0 && currentContent.trim()) {
        stack[stack.length - 1].section.content = currentContent.trim();
      }

      const level = headingMatch[1].length;
      const heading = headingMatch[2];

      // Pop stack until we find parent level
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      const path = stack.map(s => s.section.heading);
      path.push(heading);

      const newSection: MarkdownSection = {
        heading,
        level,
        content: '',
        children: [],
        path
      };

      if (stack.length === 0) {
        sections.push(newSection);
      } else {
        stack[stack.length - 1].section.children.push(newSection);
      }

      stack.push({ section: newSection, level });
      currentContent = '';
    } else {
      currentContent += line + '\n';
    }
  }

  // Final content
  if (stack.length > 0 && currentContent.trim()) {
    stack[stack.length - 1].section.content = currentContent.trim();
  }

  return sections;
}

// Flatten for chunking with context
function flattenWithContext(sections: MarkdownSection[]): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];

  function traverse(section: MarkdownSection) {
    if (section.content) {
      chunks.push({
        content: section.content,
        metadata: {
          headingHierarchy: section.path,
          heading: section.heading,
          level: section.level
        }
      });
    }
    section.children.forEach(traverse);
  }

  sections.forEach(traverse);
  return chunks;
}
```

### 3.5 Semantic Chunking (Embedding-Based)

Split based on embedding similarity between sentences.

```typescript
async function semanticChunk(
  text: string,
  embedder: (text: string) => Promise<number[]>,
  similarityThreshold: number = 0.75
): Promise<string[]> {
  // Split into sentences
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  // Embed all sentences
  const embeddings = await Promise.all(sentences.map(s => embedder(s.trim())));

  const chunks: string[] = [];
  let currentChunk = sentences[0];

  for (let i = 1; i < sentences.length; i++) {
    const similarity = cosineSimilarity(embeddings[i - 1], embeddings[i]);

    if (similarity < similarityThreshold) {
      // Semantic break detected - start new chunk
      chunks.push(currentChunk.trim());
      currentChunk = sentences[i];
    } else {
      currentChunk += ' ' + sentences[i];
    }
  }

  chunks.push(currentChunk.trim());
  return chunks;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

---

## 4. Processing Pipeline

### 4.1 Pipeline States

```typescript
type ProcessingStatus =
  | 'queued'      // Job added, waiting to start
  | 'extracting'  // Pulling content from source
  | 'chunking'    // Breaking into semantic pieces
  | 'embedding'   // Generating vector embeddings
  | 'indexing'    // Adding to vector DB and graph
  | 'done'        // Complete
  | 'failed';     // Error occurred

interface ProcessingJob {
  id: string;
  status: ProcessingStatus;
  sourceType: 'url' | 'file' | 'text' | 'api';
  sourceUrl?: string;
  content?: string;
  chunks?: Chunk[];
  embeddings?: number[][];
  memoryIds?: string[];
  error?: string;
  progress: number;  // 0-100
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}
```

### 4.2 Async Job Queue with BullMQ

BullMQ provides Redis-backed job queues with priorities, retries, and rate limiting.

```typescript
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL);

// Define job queues
const extractionQueue = new Queue('extraction', { connection });
const chunkingQueue = new Queue('chunking', { connection });
const embeddingQueue = new Queue('embedding', { connection });
const indexingQueue = new Queue('indexing', { connection });

// Extraction worker
const extractionWorker = new Worker('extraction', async (job: Job) => {
  const { sourceType, sourceUrl, content } = job.data;

  await job.updateProgress(10);

  let extractedContent: string;
  switch (sourceType) {
    case 'url':
      extractedContent = await fetchAndExtract(sourceUrl);
      break;
    case 'file':
      extractedContent = await readFile(sourceUrl);
      break;
    default:
      extractedContent = content;
  }

  await job.updateProgress(100);

  // Chain to chunking
  await chunkingQueue.add('chunk', {
    jobId: job.data.jobId,
    content: extractedContent,
    contentType: detectContentType(extractedContent)
  });

  return { extractedContent };
}, { connection, concurrency: 5 });

// Chunking worker
const chunkingWorker = new Worker('chunking', async (job: Job) => {
  const { content, contentType, jobId } = job.data;

  await job.updateProgress(10);

  let chunks: Chunk[];
  switch (contentType) {
    case 'markdown':
      chunks = chunkDocument(content);
      break;
    case 'code':
      chunks = await chunk(job.data.filepath || 'content.ts', content);
      break;
    default:
      chunks = semanticChunk(content, embedder);
  }

  await job.updateProgress(100);

  // Chain to embedding
  await embeddingQueue.add('embed', {
    jobId,
    chunks
  });

  return { chunkCount: chunks.length };
}, { connection, concurrency: 3 });

// Embedding worker
const embeddingWorker = new Worker('embedding', async (job: Job) => {
  const { chunks, jobId } = job.data;

  const batchSize = 100;
  const embeddings: number[][] = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map(c => c.contextualizedText || c.content);

    const batchEmbeddings = await embedBatch(texts);
    embeddings.push(...batchEmbeddings);

    await job.updateProgress((i + batchSize) / chunks.length * 100);
  }

  // Chain to indexing
  await indexingQueue.add('index', {
    jobId,
    chunks,
    embeddings
  });

  return { embeddingCount: embeddings.length };
}, { connection, concurrency: 2 });

// Indexing worker
const indexingWorker = new Worker('indexing', async (job: Job) => {
  const { chunks, embeddings, jobId } = job.data;

  const memoryIds: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const memoryId = await insertMemory({
      content: chunks[i].content,
      embedding: embeddings[i],
      metadata: chunks[i].metadata
    });

    memoryIds.push(memoryId);
    await job.updateProgress((i + 1) / chunks.length * 100);
  }

  // Update job status
  await updateJobStatus(jobId, 'done', { memoryIds });

  return { memoryIds };
}, { connection, concurrency: 1 });

// Job submission
async function submitProcessingJob(
  sourceType: string,
  sourceUrl?: string,
  content?: string
): Promise<string> {
  const jobId = generateUUID();

  await createJob(jobId, { status: 'queued', sourceType, sourceUrl });

  await extractionQueue.add('extract', {
    jobId,
    sourceType,
    sourceUrl,
    content
  }, {
    priority: 1,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 }
  });

  return jobId;
}
```

### 4.3 Flow Processing (Parent-Child Jobs)

```typescript
import { FlowProducer } from 'bullmq';

const flowProducer = new FlowProducer({ connection });

async function submitProcessingFlow(sourceUrl: string): Promise<string> {
  const jobId = generateUUID();

  // Define flow with dependencies
  const flow = await flowProducer.add({
    name: 'complete-processing',
    queueName: 'orchestration',
    data: { jobId },
    children: [
      {
        name: 'index',
        queueName: 'indexing',
        data: { jobId },
        children: [
          {
            name: 'embed',
            queueName: 'embedding',
            data: { jobId },
            children: [
              {
                name: 'chunk',
                queueName: 'chunking',
                data: { jobId },
                children: [
                  {
                    name: 'extract',
                    queueName: 'extraction',
                    data: { jobId, sourceUrl }
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  });

  return jobId;
}
```

---

## 5. Hybrid Search Architecture

### 5.1 Overview

Combine vector similarity search with BM25 keyword search and graph traversal for maximum recall and precision.

```
Query -> [Query Rewriting] -> [Parallel Search]
                                    |
                    +---------------+---------------+
                    |               |               |
              [Vector Search] [BM25 Search] [Graph Traversal]
                    |               |               |
                    +-------+-------+-------+-------+
                            |
                    [Reciprocal Rank Fusion]
                            |
                    [Cross-Encoder Reranking]
                            |
                      [Top-K Results]
```

### 5.2 Query Rewriting

Use LLM to generate multiple query variants for better recall.

```typescript
interface RewrittenQueries {
  original: string;
  variants: string[];
  keywords: string[];
}

async function rewriteQuery(query: string): Promise<RewrittenQueries> {
  const response = await llm.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a query rewriting assistant. Given a user query, generate:
1. 3-5 semantically similar query variants
2. Key search terms/keywords

Respond in JSON: { "variants": [...], "keywords": [...] }`
      },
      {
        role: 'user',
        content: query
      }
    ],
    response_format: { type: 'json_object' }
  });

  const result = JSON.parse(response.choices[0].message.content);
  return {
    original: query,
    variants: result.variants,
    keywords: result.keywords
  };
}
```

### 5.3 Parallel Search Execution

```typescript
interface SearchResult {
  memoryId: string;
  content: string;
  score: number;
  source: 'vector' | 'bm25' | 'graph';
  metadata: Record<string, unknown>;
}

async function hybridSearch(
  query: string,
  options: {
    vectorWeight: number;    // 0-1
    bm25Weight: number;      // 0-1
    graphWeight: number;     // 0-1
    topK: number;
    includeGraph: boolean;
    rerank: boolean;
  }
): Promise<SearchResult[]> {
  // Step 1: Query rewriting
  const { variants, keywords } = await rewriteQuery(query);

  // Step 2: Generate embedding
  const queryEmbedding = await embed(query);
  const variantEmbeddings = await Promise.all(variants.map(embed));

  // Step 3: Parallel search
  const [vectorResults, bm25Results, graphResults] = await Promise.all([
    // Vector search with query and variants
    searchVector(queryEmbedding, variantEmbeddings, options.topK * 2),

    // BM25 keyword search
    searchBM25(keywords, options.topK * 2),

    // Graph traversal from top vector matches
    options.includeGraph
      ? searchGraph(queryEmbedding, options.topK)
      : Promise.resolve([])
  ]);

  // Step 4: Reciprocal Rank Fusion
  const fusedResults = reciprocalRankFusion([
    { results: vectorResults, weight: options.vectorWeight },
    { results: bm25Results, weight: options.bm25Weight },
    { results: graphResults, weight: options.graphWeight }
  ]);

  // Step 5: Cross-encoder reranking (optional)
  if (options.rerank) {
    return await crossEncoderRerank(query, fusedResults, options.topK);
  }

  return fusedResults.slice(0, options.topK);
}

// Vector search with multiple embeddings
async function searchVector(
  primaryEmbedding: number[],
  variantEmbeddings: number[][],
  limit: number
): Promise<SearchResult[]> {
  const allEmbeddings = [primaryEmbedding, ...variantEmbeddings];

  const results = await Promise.all(
    allEmbeddings.map(embedding =>
      pool.query(
        `SELECT id, content, metadata,
                1 - (embedding <=> $1::vector) as score
         FROM memories
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        [pgvector.toSql(embedding), limit]
      )
    )
  );

  // Deduplicate and merge scores
  const merged = new Map<string, SearchResult>();
  results.flat().forEach((row, idx) => {
    row.rows.forEach(r => {
      const existing = merged.get(r.id);
      if (!existing || r.score > existing.score) {
        merged.set(r.id, {
          memoryId: r.id,
          content: r.content,
          score: r.score,
          source: 'vector',
          metadata: r.metadata
        });
      }
    });
  });

  return Array.from(merged.values());
}
```

### 5.4 Reciprocal Rank Fusion

```typescript
interface RankedList {
  results: SearchResult[];
  weight: number;
}

function reciprocalRankFusion(
  rankedLists: RankedList[],
  k: number = 60  // RRF constant
): SearchResult[] {
  const scoreMap = new Map<string, { result: SearchResult; score: number }>();

  for (const { results, weight } of rankedLists) {
    results.forEach((result, rank) => {
      const rrfScore = weight / (k + rank + 1);

      const existing = scoreMap.get(result.memoryId);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scoreMap.set(result.memoryId, { result, score: rrfScore });
      }
    });
  }

  // Sort by fused score
  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .map(({ result, score }) => ({ ...result, score }));
}
```

### 5.5 Cross-Encoder Reranking

```typescript
import { pipeline } from '@xenova/transformers';

let reranker: any = null;

async function initReranker() {
  if (!reranker) {
    reranker = await pipeline(
      'text-classification',
      'cross-encoder/ms-marco-MiniLM-L-6-v2'
    );
  }
  return reranker;
}

async function crossEncoderRerank(
  query: string,
  candidates: SearchResult[],
  topK: number
): Promise<SearchResult[]> {
  const model = await initReranker();

  // Create query-document pairs
  const pairs = candidates.map(c => ({ text: query, text_pair: c.content }));

  // Score all pairs
  const scores = await model(pairs);

  // Combine with original results
  const reranked = candidates.map((result, i) => ({
    ...result,
    score: scores[i].score  // Cross-encoder score
  }));

  // Sort by reranker score
  return reranked
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
```

### 5.6 Graph-Enhanced Retrieval

```typescript
async function searchGraph(
  queryEmbedding: number[],
  limit: number
): Promise<SearchResult[]> {
  // Step 1: Find entry points via vector search
  const entryPoints = await pool.query(
    `SELECT id FROM memories
     ORDER BY embedding <=> $1::vector
     LIMIT 3`,
    [pgvector.toSql(queryEmbedding)]
  );

  // Step 2: Traverse from entry points
  const graphResults: SearchResult[] = [];

  for (const entry of entryPoints.rows) {
    const traversed = await traverseGraph({
      startNodeId: entry.id,
      relationshipTypes: ['extends', 'derives'],
      maxDepth: 2,
      direction: 'both',
      includeSuperseded: false
    });

    traversed.forEach(memory => {
      const similarity = cosineSimilarity(queryEmbedding, memory.embedding);
      graphResults.push({
        memoryId: memory.id,
        content: memory.content,
        score: similarity,
        source: 'graph',
        metadata: memory.metadata
      });
    });
  }

  // Deduplicate and sort
  const unique = new Map<string, SearchResult>();
  graphResults.forEach(r => {
    const existing = unique.get(r.memoryId);
    if (!existing || r.score > existing.score) {
      unique.set(r.memoryId, r);
    }
  });

  return Array.from(unique.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
```

---

## 6. Technology Recommendations

### 6.1 Recommended Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Runtime** | Node.js 20+ | LTS, native TypeScript support |
| **Language** | TypeScript 5.x | Type safety, better DX |
| **Database** | PostgreSQL 16 + pgvector | Production-ready, HNSW indexing |
| **ORM** | Drizzle ORM | Type-safe, performant, SQLite/PG support |
| **Job Queue** | BullMQ + Redis | Reliable, flow support, priorities |
| **Vector Store** | pgvector (prod) / sqlite-vec (dev) | Flexibility for scale |
| **Embeddings** | OpenAI text-embedding-3-small | 1536 dims, cost-effective, high quality |
| **Reranking** | cross-encoder/ms-marco-MiniLM | Local, fast, production-tested |
| **Chunking** | @supermemory/code-chunk | AST-aware for code |
| **Graph** | PostgreSQL JSONB + CTEs | Unified storage, no extra DB |

### 6.2 Package Recommendations

```json
{
  "dependencies": {
    "pg": "^8.11.0",
    "pgvector": "^0.1.8",
    "drizzle-orm": "^0.30.0",
    "bullmq": "^5.0.0",
    "ioredis": "^5.3.0",
    "better-sqlite3": "^9.4.0",
    "@supermemory/code-chunk": "^1.0.0",
    "@xenova/transformers": "^2.17.0",
    "openai": "^4.0.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.20.0",
    "typescript": "^5.4.0"
  }
}
```

### 6.3 Embedding Model Comparison

| Model | Dimensions | Cost/1K tokens | MTEB Score | Recommendation |
|-------|------------|----------------|------------|----------------|
| text-embedding-3-small | 1536 (native) | $0.00002 | 62.3% | Default choice |
| text-embedding-3-large | 3072 (native) | $0.00013 | 64.6% | Higher accuracy needs |
| text-embedding-ada-002 | 1536 | $0.0001 | 61.0% | Legacy, 5x more expensive |

**Recommendation:** Use `text-embedding-3-small` with 1536 dimensions for the best cost/performance balance.

### 6.4 Development vs Production

| Concern | Development | Production |
|---------|-------------|------------|
| Vector DB | sqlite-vec (in-memory) | pgvector (PostgreSQL) |
| Job Queue | In-process queue | BullMQ + Redis cluster |
| Caching | LRU in-memory | Redis |
| Embeddings | Batch processing | Rate-limited async |

### 6.5 Scaling Considerations

1. **Vector Index Tuning:**
   - HNSW `m` parameter: 16 (default) to 64 (more accurate, slower build)
   - `ef_construction`: 64-200 (higher = better recall, slower indexing)
   - `ef_search`: 40-200 at query time

2. **Partitioning Strategy:**
   - Partition by user/tenant for multi-tenant
   - Partition by time for time-series data

3. **Connection Pooling:**
   - Use `pg-pool` with min 10, max 100 connections
   - Separate pools for read replicas

4. **Caching Layers:**
   - L1: In-memory LRU for hot queries
   - L2: Redis for cross-instance sharing
   - L3: CDN for public content

---

## 7. References

### Primary Sources

- [Supermemory.ai](https://supermemory.ai/) - Universal Memory API
- [Supermemory Research](https://supermemory.ai/research) - Benchmark data
- [code-chunk](https://github.com/supermemoryai/code-chunk) - AST-aware chunking

### Vector Databases

- [pgvector](https://github.com/pgvector/pgvector-node) - PostgreSQL vector extension
- [sqlite-vec](https://github.com/asg017/sqlite-vec) - SQLite vector extension
- [Vector Database Comparison](https://www.firecrawl.dev/blog/best-vector-databases-2025)

### Chunking Strategies

- [Pinecone Chunking Guide](https://www.pinecone.io/learn/chunking-strategies/)
- [Semantic Chunking TypeScript](https://github.com/tsensei/Semantic-Chunking-Typescript)
- [IBM RAG Chunking](https://developer.ibm.com/articles/awb-enhancing-rag-performance-chunking-strategies/)

### Hybrid Search & Reranking

- [VectorHub: Hybrid Search & Reranking](https://superlinked.com/vectorhub/articles/optimizing-rag-with-hybrid-search-reranking)
- [Pinecone Rerankers Guide](https://www.pinecone.io/learn/series/rag/rerankers/)
- [Redis RAG at Scale](https://redis.io/blog/rag-at-scale/)

### Query Rewriting

- [DMQR-RAG Paper](https://openreview.net/forum?id=lz936bYmb3)
- [Query Rewriting Revolution](https://ragaboutit.com/the-query-rewriting-revolution-how-smart-prompt-engineering-is-eliminating-rag-retrieval-failures/)

### Job Queues

- [BullMQ Documentation](https://docs.bullmq.io/)
- [BullMQ Flows](https://docs.bullmq.io/guide/flows)

### Embedding Models

- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [text-embedding-3 Comparison](https://medium.com/@lilianli1922/embedding-model-comparison-text-embedding-ada-002-vs-a618116575a6)

---

## Appendix: Quick Start Checklist

- [ ] Set up PostgreSQL with pgvector extension
- [ ] Configure Redis for BullMQ
- [ ] Initialize Drizzle ORM with schemas
- [ ] Set up OpenAI API for embeddings
- [ ] Implement chunking service (code-chunk + document chunker)
- [ ] Create BullMQ processing pipeline
- [ ] Implement hybrid search with RRF
- [ ] Add cross-encoder reranking
- [ ] Implement knowledge graph relationships
- [ ] Add query rewriting layer
