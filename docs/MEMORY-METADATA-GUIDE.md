# Memory Metadata Guide

**Version**: 1.0
**Date**: February 4, 2026

---

## Overview

Memory objects now include comprehensive metadata tracking the entire processing pipeline. This guide explains the metadata fields and their usage.

---

## Metadata Fields

### Core Fields

```typescript
interface MemoryMetadata {
  // Confidence and extraction
  confidence: number;                          // 0-1 score
  extractedFrom: string;                       // Source text snippet
  keywords: string[];                          // Extracted keywords
  entities: Entity[];                          // Named entities

  // Processing pipeline tracking (NEW)
  extractionMethod: 'regex' | 'llm';           // How extracted
  classificationMethod: 'heuristic' | 'llm';   // How classified
  relationshipMethod?: 'heuristic' | 'embedding'; // How relationships detected

  // LLM-specific fields
  llmProvider?: string;                        // e.g., 'openai'
  tokensUsed?: number;                         // Token count
}
```

---

## Field Descriptions

### extractionMethod

**Type**: `'regex' | 'llm'`
**Always Present**: Yes
**Purpose**: Tracks how the memory was extracted from source text

**Values**:
- `'regex'`: Pattern-based extraction (local-only mode)
- `'llm'`: LLM-based extraction (when LLM provider configured)

**Example**:
```typescript
// Local-only mode
{
  extractionMethod: 'regex',
  // No llmProvider or tokensUsed
}

// LLM-enabled mode
{
  extractionMethod: 'llm',
  llmProvider: 'openai',
  tokensUsed: 150
}
```

### classificationMethod

**Type**: `'heuristic' | 'llm'`
**Always Present**: Yes
**Purpose**: Tracks how the memory type was classified

**Values**:
- `'heuristic'`: Pattern-based classification (local-only mode)
- `'llm'`: LLM-based classification (when LLM provider configured)

**Example**:
```typescript
// Heuristic classification
{
  classificationMethod: 'heuristic',
  type: 'preference' // Detected via keywords
}

// LLM classification
{
  classificationMethod: 'llm',
  type: 'preference', // LLM analyzed content
  llmProvider: 'openai'
}
```

### relationshipMethod

**Type**: `'heuristic' | 'embedding'`
**Always Present**: Only when relationships detected
**Purpose**: Tracks how relationships were detected

**Values**:
- `'heuristic'`: Pattern-based detection (text similarity, update patterns)
- `'embedding'`: Vector similarity-based detection (when embeddings enabled)

**Example**:
```typescript
// Pattern-based relationship detection
{
  relationshipMethod: 'heuristic'
  // Relationships detected via update/extension patterns
}

// Embedding-based relationship detection
{
  relationshipMethod: 'embedding'
  // Relationships detected via cosine similarity
}
```

---

## Usage Patterns

### 1. Local-Only Mode (Default)

```typescript
const result = await service.processAndStoreMemories(
  'Paris is the capital of France.'
);

console.log(result.memories[0].metadata);
// {
//   extractionMethod: 'regex',
//   classificationMethod: 'heuristic',
//   confidence: 0.8,
//   keywords: ['paris', 'capital', 'france'],
//   entities: [],
//   extractedFrom: 'Paris is the capital of France.'
// }
```

### 2. LLM-Enabled Mode

```typescript
process.env.MEMORY_ENABLE_LLM = 'true';
process.env.OPENAI_API_KEY = 'sk-...';

const result = await service.processAndStoreMemories(
  'I prefer dark mode for coding.'
);

console.log(result.memories[0].metadata);
// {
//   extractionMethod: 'llm',
//   classificationMethod: 'llm',
//   llmProvider: 'openai',
//   tokensUsed: 120,
//   confidence: 0.95,
//   keywords: ['dark', 'mode', 'coding'],
//   entities: [],
//   extractedFrom: 'I prefer dark mode for coding.'
// }
```

### 3. With Relationship Detection

```typescript
const result = await service.processAndStoreMemories(
  'Update: The API now uses version 2.0.',
  { detectRelationships: true }
);

console.log(result.memories[0].metadata);
// {
//   extractionMethod: 'regex',
//   classificationMethod: 'heuristic',
//   relationshipMethod: 'heuristic', // Added when relationships detected
//   confidence: 0.8,
//   keywords: ['update', 'api', 'version'],
//   entities: [],
//   extractedFrom: 'Update: The API now uses version 2.0.'
// }
```

### 4. Embedding-Based Relationships

```typescript
process.env.MEMORY_ENABLE_EMBEDDINGS = 'true';

const result = await service.processAndStoreMemories(
  'React helps build user interfaces.',
  { detectRelationships: true }
);

console.log(result.memories[0].metadata);
// {
//   extractionMethod: 'regex',
//   classificationMethod: 'heuristic',
//   relationshipMethod: 'embedding', // Vector similarity used
//   confidence: 0.85,
//   keywords: ['react', 'build', 'user', 'interfaces'],
//   entities: [],
//   extractedFrom: 'React helps build user interfaces.'
// }
```

---

## Querying by Metadata

### 1. Find LLM-Extracted Memories

```typescript
const allMemories = await repository.getAllMemories();
const llmMemories = allMemories.filter(
  m => m.metadata.extractionMethod === 'llm'
);
```

### 2. Find High-Confidence Heuristic Classifications

```typescript
const allMemories = await repository.getAllMemories();
const highConfidenceHeuristic = allMemories.filter(
  m => m.metadata.classificationMethod === 'heuristic' &&
       m.metadata.confidence > 0.8
);
```

### 3. Find Embedding-Detected Relationships

```typescript
const allMemories = await repository.getAllMemories();
const embeddingRelationships = allMemories.filter(
  m => m.metadata.relationshipMethod === 'embedding'
);
```

### 4. Calculate LLM Token Usage

```typescript
const allMemories = await repository.getAllMemories();
const totalTokens = allMemories.reduce(
  (sum, m) => sum + (m.metadata.tokensUsed || 0),
  0
);
console.log(`Total LLM tokens used: ${totalTokens}`);
```

---

## Analytics & Monitoring

### 1. Method Distribution

```typescript
function getMethodDistribution(memories: Memory[]) {
  const stats = {
    extraction: { regex: 0, llm: 0 },
    classification: { heuristic: 0, llm: 0 },
    relationships: { heuristic: 0, embedding: 0, none: 0 }
  };

  for (const memory of memories) {
    stats.extraction[memory.metadata.extractionMethod]++;
    stats.classification[memory.metadata.classificationMethod]++;

    const relMethod = memory.metadata.relationshipMethod;
    if (relMethod) {
      stats.relationships[relMethod]++;
    } else {
      stats.relationships.none++;
    }
  }

  return stats;
}
```

### 2. Cost Analysis

```typescript
function analyzeLLMCost(memories: Memory[]) {
  const llmMemories = memories.filter(
    m => m.metadata.extractionMethod === 'llm'
  );

  const totalTokens = llmMemories.reduce(
    (sum, m) => sum + (m.metadata.tokensUsed || 0),
    0
  );

  // Assuming GPT-4o-mini pricing: $0.15 per 1M input tokens
  const estimatedCost = (totalTokens / 1_000_000) * 0.15;

  return {
    memoryCount: llmMemories.length,
    totalTokens,
    estimatedCost,
    avgTokensPerMemory: totalTokens / llmMemories.length
  };
}
```

### 3. Confidence Comparison

```typescript
function compareConfidenceByMethod(memories: Memory[]) {
  const heuristic = memories
    .filter(m => m.metadata.classificationMethod === 'heuristic')
    .map(m => m.metadata.confidence);

  const llm = memories
    .filter(m => m.metadata.classificationMethod === 'llm')
    .map(m => m.metadata.confidence);

  return {
    heuristic: {
      count: heuristic.length,
      avg: heuristic.reduce((a, b) => a + b, 0) / heuristic.length,
      min: Math.min(...heuristic),
      max: Math.max(...heuristic)
    },
    llm: {
      count: llm.length,
      avg: llm.reduce((a, b) => a + b, 0) / llm.length,
      min: Math.min(...llm),
      max: Math.max(...llm)
    }
  };
}
```

---

## Best Practices

### 1. Always Check Method Before Analysis

```typescript
// ❌ Don't assume all memories use same method
const avgConfidence = memories.reduce((sum, m) => sum + m.confidence, 0) / memories.length;

// ✅ Segment by method for meaningful comparison
const heuristicConfidence = memories
  .filter(m => m.metadata.classificationMethod === 'heuristic')
  .reduce((sum, m) => sum + m.confidence, 0) / heuristicCount;
```

### 2. Track LLM Costs

```typescript
// ✅ Monitor token usage regularly
const cost = analyzeLLMCost(memories);
if (cost.estimatedCost > 10) {
  logger.warn('LLM cost exceeds threshold', cost);
}
```

### 3. Use Metadata for Debugging

```typescript
// ✅ When debugging classification issues
const memory = await service.getMemory(memoryId);
console.log('Classification method:', memory.metadata.classificationMethod);
console.log('Confidence:', memory.metadata.confidence);
console.log('LLM provider:', memory.metadata.llmProvider);
```

### 4. Optimize Based on Metrics

```typescript
// ✅ Identify which method performs better
const comparison = compareConfidenceByMethod(memories);
if (comparison.heuristic.avg > comparison.llm.avg) {
  logger.info('Heuristic classification performing well, consider cost savings');
}
```

---

## Migration Guide

### Before (No Metadata Tracking)

```typescript
{
  id: '123',
  content: 'Paris is the capital',
  type: 'fact',
  confidence: 0.8,
  metadata: {
    confidence: 0.8,
    keywords: ['paris', 'capital']
  }
}
```

### After (With Metadata Tracking)

```typescript
{
  id: '123',
  content: 'Paris is the capital',
  type: 'fact',
  confidence: 0.8,
  metadata: {
    confidence: 0.8,
    keywords: ['paris', 'capital'],
    extractionMethod: 'regex',        // NEW
    classificationMethod: 'heuristic' // NEW
  }
}
```

**Impact**: Fully backward compatible - new fields don't affect existing functionality.

---

## Troubleshooting

### Issue: relationshipMethod is undefined

**Cause**: Relationships not detected for this memory
**Solution**: This is expected - field only present when relationships exist

```typescript
// ✅ Check before accessing
if (memory.metadata.relationshipMethod) {
  console.log('Relationship method:', memory.metadata.relationshipMethod);
}
```

### Issue: tokensUsed is undefined

**Cause**: Memory not extracted with LLM
**Solution**: Only present for LLM-extracted memories

```typescript
// ✅ Check extraction method first
if (memory.metadata.extractionMethod === 'llm') {
  console.log('Tokens:', memory.metadata.tokensUsed);
}
```

### Issue: Different methods showing same confidence

**Cause**: Confidence calculation may be normalized
**Solution**: Compare distributions, not individual values

```typescript
// ✅ Use statistical comparison
const stats = compareConfidenceByMethod(memories);
console.log('Heuristic avg:', stats.heuristic.avg);
console.log('LLM avg:', stats.llm.avg);
```

---

## Future Enhancements

Planned metadata additions:
- `processingDuration`: Time taken to process
- `embeddingModel`: Model used for embeddings
- `relationshipCount`: Number of relationships detected
- `similarityScores`: Distribution of similarity scores
- `validationErrors`: Any validation issues encountered

---

## Summary

The metadata tracking system provides:
- ✅ Full pipeline observability
- ✅ Cost tracking and optimization
- ✅ Performance analysis
- ✅ Quality metrics comparison
- ✅ Debugging capabilities
- ✅ Zero breaking changes

Use metadata fields to monitor, optimize, and debug your memory processing pipeline.
