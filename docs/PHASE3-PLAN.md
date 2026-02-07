# Phase 3: Search & Retrieval - Implementation Plan

**Status:** Ready to Start (after Phase 2B/2C)  
**Duration:** 2-3 weeks  
**Priority:** P0 (Critical Path)  
**Dependencies:** Phase 1 ✅, Phase 2A ✅, Phase 2B (security), Phase 2C (async pipeline)

---

## Current State Assessment

### Completed (Phase 1 & 2A)
✅ PostgreSQL + pgvector foundation  
✅ HNSW vector indexing (150x-12,500x faster)  
✅ Basic vector similarity search  
✅ Relationship detection system  
✅ Code quality improvements (-1,189 LOC)  
✅ Test coverage (99%+, 1,041 tests passing)

### In Progress (Phase 2B/2C)
⏳ Security hardening (2 weeks)  
⏳ Async processing pipeline (3-4 weeks)

### Not Started (Phase 3 Scope)
❌ Full-text keyword search  
❌ Hybrid search (vector + keyword fusion)  
❌ Query rewriting  
❌ Cross-encoder reranking  
❌ Advanced graph traversal

---

## Phase 3 Objectives

### Primary Goals

1. **Hybrid Search** - Combine vector similarity + keyword search with RRF fusion
2. **Query Enhancement** - LLM-powered query rewriting for improved recall
3. **Result Reranking** - Cross-encoder reranking for better relevance
4. **Graph Exploration** - Traverse relationship graph from vector entry points
5. **Performance** - Sub-150ms hybrid search, sub-300ms with reranking

### Success Metrics

| Metric | Target | Baseline |
|--------|--------|----------|
| **Full-text search latency** | <50ms | N/A (new) |
| **Hybrid search latency** | <150ms | ~100ms (vector only) |
| **With reranking** | <300ms | N/A (new) |
| **Recall improvement** | +20% | Baseline vector |
| **Precision improvement** | +15% | Baseline vector |
| **Graph traversal depth** | 2-3 hops | 1 hop |

---

## Phase 3 Implementation Tasks

### Task 14: Full-Text Keyword Search

**Duration:** 3-4 days  
**Effort:** Medium  
**Priority:** P0

**Objective:** Implement PostgreSQL full-text search with tsvector for keyword-based retrieval.

**Deliverables:**
- [ ] Add tsvector column to memories table
- [ ] Create GIN index on tsvector column
- [ ] Implement text search trigger for auto-update
- [ ] Create FullTextSearchService
- [ ] Add full-text search tests

**Schema Changes:**
```sql
-- Add tsvector column
ALTER TABLE memories ADD COLUMN search_vector tsvector;

-- Create GIN index (fast text search)
CREATE INDEX idx_memories_search_vector 
ON memories USING gin(search_vector);

-- Auto-update trigger
CREATE TRIGGER tsvector_update 
BEFORE INSERT OR UPDATE ON memories
FOR EACH ROW EXECUTE FUNCTION
tsvector_update_trigger(
  search_vector, 
  'pg_catalog.english', 
  content, 
  title
);
```

**Implementation:**
```typescript
// src/services/search/fulltext.service.ts
export class FullTextSearchService {
  async search(
    query: string,
    options: {
      limit?: number;
      containerTag?: string;
      minScore?: number;
    }
  ): Promise<SearchResult[]> {
    const { limit = 20, containerTag, minScore = 0.1 } = options;
    
    // Sanitize query
    const sanitized = this.sanitizeQuery(query);
    
    // PostgreSQL full-text search
    const sql = `
      SELECT 
        id,
        content,
        ts_rank(search_vector, query) as score
      FROM memories, 
           plainto_tsquery('english', $1) query
      WHERE search_vector @@ query
        ${containerTag ? 'AND container_tag = $2' : ''}
        AND ts_rank(search_vector, query) > $3
      ORDER BY score DESC
      LIMIT $4
    `;
    
    const params = containerTag 
      ? [sanitized, containerTag, minScore, limit]
      : [sanitized, minScore, limit];
    
    return this.db.query(sql, params);
  }
  
  private sanitizeQuery(query: string): string {
    // Remove special characters, preserve alphanumeric + spaces
    return query.replace(/[^\w\s]/g, ' ').trim();
  }
}
```

**Testing:**
- Keyword match tests
- Multi-word query tests
- Stop word handling
- Performance benchmarks (<50ms)

---

### Task 15: Hybrid Search with RRF Fusion

**Duration:** 4-5 days  
**Effort:** High  
**Priority:** P0

**Objective:** Combine vector similarity and full-text search using Reciprocal Rank Fusion (RRF).

**Deliverables:**
- [ ] Implement RRF fusion algorithm
- [ ] Create HybridSearchService
- [ ] Add configurable fusion weights
- [ ] Implement result deduplication
- [ ] Add hybrid search tests

**RRF Algorithm:**
```typescript
// Reciprocal Rank Fusion (RRF)
function fuseResults(
  vectorResults: SearchResult[],
  fulltextResults: SearchResult[],
  k: number = 60 // RRF constant
): SearchResult[] {
  const scores = new Map<string, number>();
  
  // Score from vector search
  vectorResults.forEach((result, rank) => {
    const rrfScore = 1 / (k + rank + 1);
    scores.set(result.id, (scores.get(result.id) || 0) + rrfScore);
  });
  
  // Score from full-text search
  fulltextResults.forEach((result, rank) => {
    const rrfScore = 1 / (k + rank + 1);
    scores.set(result.id, (scores.get(result.id) || 0) + rrfScore);
  });
  
  // Sort by combined score
  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
```

**Implementation:**
```typescript
// src/services/search/hybrid.service.ts
export class HybridSearchService {
  constructor(
    private vectorStore: PgVectorStore,
    private fullTextSearch: FullTextSearchService,
  ) {}
  
  async search(
    query: string,
    options: HybridSearchOptions
  ): Promise<SearchResult[]> {
    const {
      limit = 20,
      vectorWeight = 0.6,
      fulltextWeight = 0.4,
      rrfConstant = 60,
    } = options;
    
    // Run both searches in parallel
    const [vectorResults, fulltextResults] = await Promise.all([
      this.vectorStore.search(query, { limit: limit * 2 }),
      this.fullTextSearch.search(query, { limit: limit * 2 }),
    ]);
    
    // Apply RRF fusion
    const fusedResults = this.fuseWithRRF(
      vectorResults,
      fulltextResults,
      rrfConstant
    );
    
    // Apply weights
    fusedResults.forEach(result => {
      result.score = 
        result.vectorScore * vectorWeight + 
        result.fulltextScore * fulltextWeight;
    });
    
    // Deduplicate and limit
    return this.deduplicate(fusedResults).slice(0, limit);
  }
}
```

**Testing:**
- Vector-only queries (entities, concepts)
- Keyword-only queries (exact matches)
- Hybrid queries (mixed intent)
- Performance benchmarks (<150ms)
- Recall/precision improvements

---

### Task 16: Query Rewriting with LLM

**Duration:** 3-4 days  
**Effort:** Medium  
**Priority:** P1

**Objective:** Use LLM to expand and rewrite queries for improved recall.

**Deliverables:**
- [ ] Implement QueryRewritingService
- [ ] Generate query variants (synonyms, expansions)
- [ ] Extract keywords and entities
- [ ] Add caching for repeated queries
- [ ] Add query rewriting tests

**Implementation:**
```typescript
// src/services/search/query-rewriting.service.ts
export class QueryRewritingService {
  constructor(private llmProvider: LLMProvider) {}
  
  async rewriteQuery(query: string): Promise<QueryVariants> {
    const prompt = `
Given the search query: "${query}"

Generate:
1. 3-5 semantically similar variants (synonyms, rephrasing)
2. 5-10 relevant keywords (extracted concepts, entities)
3. Suggested filters (time range, content type)

Return JSON:
{
  "variants": ["variant1", "variant2", ...],
  "keywords": ["keyword1", "keyword2", ...],
  "filters": { "timeRange": "...", "type": "..." }
}
    `.trim();
    
    const response = await this.llmProvider.complete(prompt, {
      temperature: 0.3,
      maxTokens: 300,
    });
    
    return JSON.parse(response);
  }
  
  async expandedSearch(
    query: string,
    searchFn: (q: string) => Promise<SearchResult[]>
  ): Promise<SearchResult[]> {
    // Get query variants
    const variants = await this.rewriteQuery(query);
    
    // Search with all variants in parallel
    const allResults = await Promise.all([
      searchFn(query), // Original query
      ...variants.variants.map(v => searchFn(v)),
    ]);
    
    // Merge and deduplicate
    return this.mergeResults(allResults);
  }
}
```

**Testing:**
- Query expansion quality
- Synonym generation
- Entity extraction
- Cache hit rates
- Performance impact (<50ms overhead)

---

### Task 17: Cross-Encoder Reranking

**Duration:** 4-5 days  
**Effort:** High  
**Priority:** P1

**Objective:** Improve result relevance with cross-encoder neural reranking.

**Deliverables:**
- [ ] Integrate cross-encoder model (BGE-reranker or similar)
- [ ] Implement RerankingService
- [ ] Add batch reranking for efficiency
- [ ] Cache reranking scores
- [ ] Add reranking tests

**Model Options:**
- `BAAI/bge-reranker-v2-m3` (multilingual, 568M params)
- `cross-encoder/ms-marco-MiniLM-L-6-v2` (English, 23M params)
- `jina-ai/jina-reranker-v1-base-en` (English, 137M params)

**Implementation:**
```typescript
// src/services/search/reranking.service.ts
import { pipeline } from '@xenova/transformers';

export class RerankingService {
  private reranker: any;
  
  async initialize() {
    // Load cross-encoder model
    this.reranker = await pipeline(
      'text-classification',
      'cross-encoder/ms-marco-MiniLM-L-6-v2'
    );
  }
  
  async rerank(
    query: string,
    results: SearchResult[],
    topK: number = 20
  ): Promise<SearchResult[]> {
    // Prepare input pairs
    const pairs = results.map(r => [query, r.content]);
    
    // Batch score with cross-encoder
    const scores = await this.reranker(pairs, {
      batch_size: 32,
    });
    
    // Combine with original scores
    results.forEach((result, i) => {
      result.rerankScore = scores[i].score;
      result.finalScore = 
        result.score * 0.4 + 
        result.rerankScore * 0.6;
    });
    
    // Sort by final score
    return results
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, topK);
  }
}
```

**Testing:**
- Reranking accuracy (NDCG@10)
- Performance (<150ms for 100 results)
- Batch efficiency
- Model memory usage

---

### Task 18: Graph Traversal Search

**Duration:** 3-4 days  
**Effort:** Medium  
**Priority:** P2

**Objective:** Enable multi-hop relationship traversal from vector search entry points.

**Deliverables:**
- [ ] Implement GraphTraversalService
- [ ] Add recursive relationship following
- [ ] Implement cycle detection
- [ ] Add relevance scoring for paths
- [ ] Add graph traversal tests

**Implementation:**
```typescript
// src/services/search/graph-traversal.service.ts
export class GraphTraversalService {
  constructor(
    private vectorStore: PgVectorStore,
    private relationshipDetector: RelationshipDetector
  ) {}
  
  async traverseFromEntryPoints(
    entryPoints: Memory[],
    options: {
      maxDepth?: number;
      maxResults?: number;
      relationshipTypes?: RelationshipType[];
    }
  ): Promise<Memory[]> {
    const {
      maxDepth = 2,
      maxResults = 50,
      relationshipTypes,
    } = options;
    
    const visited = new Set<string>();
    const results: Memory[] = [];
    const queue: Array<{ memory: Memory; depth: number }> = 
      entryPoints.map(m => ({ memory: m, depth: 0 }));
    
    while (queue.length > 0 && results.length < maxResults) {
      const { memory, depth } = queue.shift()!;
      
      if (visited.has(memory.id) || depth > maxDepth) continue;
      
      visited.add(memory.id);
      results.push(memory);
      
      // Find related memories
      const related = await this.relationshipDetector.findRelated(
        memory.id,
        { types: relationshipTypes }
      );
      
      // Add to queue for traversal
      related.forEach(rel => {
        queue.push({ 
          memory: rel.targetMemory, 
          depth: depth + 1 
        });
      });
    }
    
    return results;
  }
}
```

**Testing:**
- Multi-hop traversal
- Cycle detection
- Relationship filtering
- Performance (depth 2-3)

---

## Complete Search Pipeline

### Unified Search Service

```typescript
// src/services/search/unified-search.service.ts
export class UnifiedSearchService {
  constructor(
    private hybridSearch: HybridSearchService,
    private queryRewriter: QueryRewritingService,
    private reranker: RerankingService,
    private graphTraversal: GraphTraversalService
  ) {}
  
  async search(
    query: string,
    options: SearchOptions
  ): Promise<SearchResponse> {
    const startTime = Date.now();
    
    // 1. Query rewriting (optional)
    let finalQuery = query;
    if (options.enableRewriting) {
      const variants = await this.queryRewriter.rewriteQuery(query);
      finalQuery = variants.variants[0] || query;
    }
    
    // 2. Hybrid search (vector + full-text)
    let results = await this.hybridSearch.search(finalQuery, {
      limit: options.limit * 2, // Get more for reranking
    });
    
    // 3. Cross-encoder reranking (optional)
    if (options.enableReranking) {
      results = await this.reranker.rerank(query, results, options.limit);
    }
    
    // 4. Graph traversal (optional)
    if (options.enableGraphTraversal) {
      const entryPoints = results.slice(0, 5);
      const graphResults = await this.graphTraversal.traverseFromEntryPoints(
        entryPoints,
        { maxDepth: 2 }
      );
      results = this.mergeWithGraphResults(results, graphResults);
    }
    
    return {
      results: results.slice(0, options.limit),
      metadata: {
        totalTime: Date.now() - startTime,
        rewritingEnabled: options.enableRewriting,
        rerankingEnabled: options.enableReranking,
        graphTraversalEnabled: options.enableGraphTraversal,
      },
    };
  }
}
```

---

## Testing Strategy

### Unit Tests

**Coverage targets:**
- Full-text search: 95%
- Hybrid fusion: 90%
- Query rewriting: 85%
- Reranking: 90%
- Graph traversal: 90%

### Integration Tests

**Search scenarios:**
1. Vector-only search (dense embeddings)
2. Keyword-only search (exact matches)
3. Hybrid search (combined)
4. Multi-hop graph traversal
5. Full pipeline (all features)

### Performance Tests

**Benchmarks:**
```typescript
describe('Search Performance', () => {
  test('full-text search <50ms', async () => {
    const start = Date.now();
    await fullTextSearch.search('machine learning');
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(50);
  });
  
  test('hybrid search <150ms', async () => {
    const start = Date.now();
    await hybridSearch.search('neural networks');
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(150);
  });
  
  test('with reranking <300ms', async () => {
    const start = Date.now();
    const results = await hybridSearch.search('deep learning');
    await reranker.rerank('deep learning', results);
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(300);
  });
});
```

### Accuracy Tests

**Metrics:**
- Precision@K (K=5,10,20)
- Recall@K
- NDCG@K (Normalized Discounted Cumulative Gain)
- MRR (Mean Reciprocal Rank)

---

## Implementation Schedule

### Week 1: Foundation (Days 1-5)

**Days 1-2:** Full-text search
- Schema changes (tsvector column)
- GIN index creation
- FullTextSearchService implementation
- Basic tests

**Days 3-5:** Hybrid search
- RRF fusion algorithm
- HybridSearchService implementation
- Weight tuning
- Performance tests

### Week 2: Enhancement (Days 6-10)

**Days 6-7:** Query rewriting
- LLM integration
- Query variant generation
- Caching layer
- Tests

**Days 8-10:** Reranking
- Cross-encoder model integration
- Batch reranking
- Score fusion
- Accuracy tests

### Week 3: Polish & Graph (Days 11-14)

**Days 11-12:** Graph traversal
- GraphTraversalService
- Multi-hop traversal
- Cycle detection
- Tests

**Days 13-14:** Integration & testing
- UnifiedSearchService
- End-to-end tests
- Performance tuning
- Documentation

---

## Success Criteria

### Performance Targets

| Operation | Target | Stretch Goal |
|-----------|--------|--------------|
| Full-text search | <50ms | <30ms |
| Vector search | <100ms | <75ms |
| Hybrid search | <150ms | <100ms |
| With reranking | <300ms | <200ms |
| Graph traversal (2 hops) | <200ms | <150ms |

### Quality Targets

| Metric | Target | Baseline |
|--------|--------|----------|
| Precision@10 | >70% | ~55% (vector only) |
| Recall@10 | >80% | ~65% (vector only) |
| NDCG@10 | >0.75 | ~0.60 |
| Test coverage | >90% | N/A |

---

## Dependencies & Prerequisites

### Before Phase 3 Starts

**Phase 2B (Security) must complete:**
- ✅ Input validation framework
- ✅ Rate limiting infrastructure
- ✅ Authentication system

**Phase 2C (Async Pipeline) must complete:**
- ✅ BullMQ integration
- ✅ Extraction workers
- ✅ Embedding workers
- ✅ Indexing workers

### External Dependencies

**Required packages:**
- `@xenova/transformers` - Cross-encoder models
- `pg_trgm` PostgreSQL extension - Trigram similarity
- Optional: `sentence-transformers` for alternative embedding models

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Cross-encoder performance | Medium | High | Use smaller model (MiniLM), optimize batching |
| Full-text search accuracy | Low | Medium | Tune text search configuration, add custom dictionaries |
| RRF fusion quality | Low | Medium | A/B test different k values, tune weights |
| Graph traversal cycles | Low | Low | Implement visited set, limit depth |
| Memory usage (models) | Medium | Medium | Use quantized models, implement lazy loading |

---

## Post-Phase 3 Deliverables

### Documentation
- [ ] Search API documentation
- [ ] RRF fusion algorithm explanation
- [ ] Query rewriting guide
- [ ] Reranking model selection guide
- [ ] Graph traversal examples

### Metrics Dashboard
- [ ] Search performance metrics
- [ ] Accuracy metrics (P/R/NDCG)
- [ ] Query distribution analysis
- [ ] Reranking impact analysis

### Production Readiness
- [ ] Load testing (1000 req/s)
- [ ] Cache warming strategy
- [ ] Model serving optimization
- [ ] Monitoring alerts

---

## Next Phases

**Phase 4: Memory Management** (2-3 weeks)
- Memory versioning
- Conflict resolution
- Deduplication
- Expiration policies

**Phase 5: API Implementation** (3-4 weeks)
- REST API endpoints
- WebSocket support
- Rate limiting
- API documentation

---

**Created:** February 3, 2026  
**Status:** Ready to start after Phase 2B/2C  
**Estimated Completion:** 2-3 weeks from start  
**Next Review:** After Phase 2C completion
