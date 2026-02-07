# Phase 2B - TODO Analysis

**Generated:** 2026-02-03
**Scope:** All TODO, FIXME, XXX, HACK comments in codebase

---

## Summary

| Category | Count | Severity |
|----------|-------|----------|
| **TODO Comments** | 3 | Critical |
| **FIXME Comments** | 0 | - |
| **XXX Comments** | 0 | - |
| **HACK Comments** | 0 | - |
| **TOTAL** | 3 | - |

---

## Critical TODOs (Production Blockers)

### 1. Memory Type Classification - LLM Integration

**File:** `src/services/memory.service.ts`
**Line:** 745
**Severity:** CRITICAL
**Effort:** 4-6 hours

**Comment:**
```typescript
// TODO: Replace with actual LLM call for classification
// Example LLM prompt:
// ```
// Classify the following content into one of these categories:
// - 'fact': Objective information or statement of truth
// - 'event': Event or experience that happened at a specific time
// - 'preference': Personal preference, like, or dislike
// - 'skill': Ability or capability
// - 'relationship': Interpersonal connection
// - 'context': Current situation or state
// - 'note': General note or reminder
//
// Content: ${content}
//
// Return only the category name.
// ```
```

**Current Implementation:**
Pattern-based classification using regex matching against `MEMORY_TYPE_PATTERNS`.

**Why This Matters:**
- Pattern matching has low accuracy for complex or ambiguous content
- LLM classification would improve memory organization
- Better classification enables more relevant search results

**Recommended Implementation:**
```typescript
async classifyMemoryType(content: string): Promise<MemoryType> {
  try {
    // Try LLM classification first
    const llmResult = await this.llmService.classifyMemory(content, {
      timeout: 5000,
      cache: true,
      fallbackOnError: false
    });

    return llmResult.type;
  } catch (error) {
    // Fallback to pattern-based classification
    logger.warn('LLM classification failed, using pattern fallback', {
      error,
      content: content.slice(0, 100)
    });

    return this.classifyMemoryTypePattern(content);
  }
}

// Rename existing method
private classifyMemoryTypePattern(content: string): MemoryType {
  // Existing pattern-based logic
  const scores: Record<MemoryType, number> = { ... };
  // ... rest of current implementation
}
```

**Dependencies:**
- LLM service with classification endpoint
- Prompt template for classification
- Error handling and fallback strategy
- Caching to avoid repeated LLM calls for similar content

**Priority:** HIGH - Required before production launch

---

### 2. Contradiction Detection - LLM Integration

**File:** `src/services/memory.service.ts`
**Line:** 797
**Severity:** CRITICAL
**Effort:** 4-6 hours

**Comment:**
```typescript
// TODO: Replace with actual LLM call for contradiction/update detection
// Example LLM prompt:
// ```
// Compare these two statements and determine if the NEW statement
// updates or contradicts the OLD statement (making it outdated):
//
// OLD: ${existing.content}
// NEW: ${newMemory.content}
//
// Return JSON: { isUpdate: boolean, confidence: 0-1, reason: string }
// ```
```

**Current Implementation:**
Word overlap calculation + pattern matching for update/contradiction indicators.

**Why This Matters:**
- Heuristic approach produces false positives and negatives
- Cannot detect semantic contradictions without keyword overlap
- Critical for maintaining memory consistency
- Affects memory graph integrity

**Example Failure Cases:**
```typescript
// Would MISS this contradiction (no common words):
existing: "The project deadline is March 1st"
new: "We have until the end of Q1 to finish"

// Would FALSE POSITIVE (high overlap, not contradiction):
existing: "John works at Google in California"
new: "John works at Google in the San Francisco office"
```

**Recommended Implementation:**
```typescript
async checkForUpdates(
  newMemory: Memory,
  existing: Memory
): Promise<UpdateCheckResult> {
  try {
    const llmResult = await this.llmService.detectContradiction({
      oldContent: existing.content,
      newContent: newMemory.content,
      timeout: 5000,
      cache: true
    });

    return {
      isUpdate: llmResult.isUpdate || llmResult.isContradiction,
      isContradiction: llmResult.isContradiction,
      supersedes: llmResult.supersedes,
      confidence: llmResult.confidence,
      reason: llmResult.reason
    };
  } catch (error) {
    logger.warn('LLM update detection failed, using pattern fallback', {
      error,
      newId: newMemory.id,
      existingId: existing.id
    });

    return this.checkForUpdatesPattern(newMemory, existing);
  }
}

private checkForUpdatesPattern(
  newMemory: Memory,
  existing: Memory
): UpdateCheckResult {
  // Existing pattern-based logic
  // ... current implementation
}
```

**LLM Prompt Template:**
```typescript
const CONTRADICTION_PROMPT = `
You are a semantic comparison system. Compare two statements and determine their relationship.

OLD STATEMENT: {{oldContent}}
NEW STATEMENT: {{newContent}}

Analyze if the NEW statement:
1. Contradicts the OLD (makes it factually incorrect)
2. Updates the OLD (provides newer information)
3. Supersedes the OLD (makes it obsolete)

Respond with JSON:
{
  "isContradiction": boolean,
  "isUpdate": boolean,
  "supersedes": boolean,
  "confidence": number (0.0-1.0),
  "reason": string (brief explanation)
}

Return only valid JSON, no markdown.
`;
```

**Priority:** HIGH - Required for memory consistency

---

### 3. Memory Extension Detection - LLM Integration

**File:** `src/services/memory.service.ts`
**Line:** 877
**Severity:** CRITICAL
**Effort:** 4-6 hours

**Comment:**
```typescript
// TODO: Replace with actual LLM call for extension detection
// Example LLM prompt:
// ```
// Compare these two statements and determine if the NEW statement
// extends or adds detail to the OLD statement (without contradicting):
//
// OLD: ${existing.content}
// NEW: ${newMemory.content}
//
// Return JSON: { isExtension: boolean, confidence: 0-1, reason: string }
// ```
```

**Current Implementation:**
Length comparison + word overlap + pattern matching for extension indicators.

**Why This Matters:**
- Enables building richer memory graphs
- Important for progressive memory enrichment
- Affects memory consolidation and summarization
- Heuristic fails for semantic extensions

**Example Failure Cases:**
```typescript
// Would MISS this extension (different wording):
existing: "John is a software engineer"
new: "John specializes in distributed systems and has 5 years of experience"

// Would FALSE POSITIVE (overlap but not extension):
existing: "The meeting is at 2 PM in the conference room"
new: "Don't forget the meeting at 2 PM"
```

**Recommended Implementation:**
```typescript
async checkForExtensions(
  newMemory: Memory,
  existing: Memory
): Promise<ExtensionCheckResult> {
  try {
    const llmResult = await this.llmService.detectExtension({
      originalContent: existing.content,
      newContent: newMemory.content,
      timeout: 5000,
      cache: true
    });

    return {
      isExtension: llmResult.isExtension,
      confidence: llmResult.confidence,
      reason: llmResult.reason,
      addedDetails: llmResult.addedDetails || []
    };
  } catch (error) {
    logger.warn('LLM extension detection failed, using pattern fallback', {
      error,
      newId: newMemory.id,
      existingId: existing.id
    });

    return this.checkForExtensionsPattern(newMemory, existing);
  }
}

private checkForExtensionsPattern(
  newMemory: Memory,
  existing: Memory
): ExtensionCheckResult {
  // Existing pattern-based logic
  // ... current implementation
}
```

**LLM Prompt Template:**
```typescript
const EXTENSION_PROMPT = `
You are a semantic analysis system. Determine if a NEW statement adds information to an ORIGINAL statement.

ORIGINAL: {{originalContent}}
NEW: {{newContent}}

Analyze if the NEW statement:
1. Adds details to the ORIGINAL (extends without contradicting)
2. Provides examples or clarifications
3. Adds context or background information

An extension should:
- Be about the same topic
- Add new information not in the ORIGINAL
- NOT contradict the ORIGINAL
- NOT merely rephrase

Respond with JSON:
{
  "isExtension": boolean,
  "confidence": number (0.0-1.0),
  "reason": string,
  "addedDetails": string[] (list of new information added)
}

Return only valid JSON, no markdown.
`;
```

**Priority:** HIGH - Required for memory graph quality

---

## Non-Code TODOs (Documentation/Comments)

### Reference TODOs in Documentation

**File:** `src/services/memory.service.ts`
**Lines:** Various

**Context:**
These are example patterns in JSDoc comments, not action items:
- Line 164: `@example "- Todo item" - matches list marker` (JSDoc example)
- Line 167-168: Pattern matching for "todo:" prefix (actual code, not TODO)

**Action:** None required - these are not TODO markers

---

## Implementation Strategy

### Phase 1: Setup (Week 1)

1. **Create LLM Service Interface**
   ```typescript
   // src/services/llm/classification.service.ts
   export interface LLMClassificationService {
     classifyMemory(content: string, options?: ClassificationOptions): Promise<ClassificationResult>;
     detectContradiction(params: ContradictionParams): Promise<ContradictionResult>;
     detectExtension(params: ExtensionParams): Promise<ExtensionResult>;
   }
   ```

2. **Implement Prompt Templates**
   - Classification prompt
   - Contradiction detection prompt
   - Extension detection prompt

3. **Add Caching Layer**
   - Cache LLM responses by content hash
   - TTL: 24 hours for classifications
   - In-memory cache with Redis backup

### Phase 2: Integration (Week 2)

4. **Implement Each Method with Fallback**
   - Wrap LLM calls with error handling
   - Keep pattern-based logic as fallback
   - Log fallback usage for monitoring

5. **Add Configuration**
   ```typescript
   interface LLMIntegrationConfig {
     enabled: boolean;              // Feature flag
     fallbackOnError: boolean;      // Use patterns if LLM fails
     timeout: number;               // Default: 5000ms
     cacheEnabled: boolean;         // Default: true
     cacheTTL: number;              // Default: 86400 (24h)
   }
   ```

6. **Metrics and Monitoring**
   - LLM success/failure rate
   - Fallback usage rate
   - Response time percentiles
   - Cache hit rate

### Phase 3: Testing (Week 3)

7. **Unit Tests**
   - Mock LLM responses
   - Test fallback behavior
   - Test error handling
   - Test caching

8. **Integration Tests**
   - Real LLM calls in test environment
   - Compare LLM vs pattern accuracy
   - Test edge cases

9. **A/B Testing**
   - Run both LLM and pattern in parallel
   - Compare results
   - Measure accuracy improvement
   - Measure latency impact

### Phase 4: Deployment (Week 4)

10. **Gradual Rollout**
    - Start with 10% of requests
    - Monitor error rates
    - Increase to 50%, then 100%
    - Keep fallback enabled

11. **Performance Tuning**
    - Optimize prompt templates
    - Tune cache settings
    - Adjust timeout values
    - Consider batch processing

---

## Success Criteria

1. **Accuracy Improvement**
   - Memory classification accuracy: >90% (vs ~70% with patterns)
   - Contradiction detection precision: >85%
   - Extension detection recall: >80%

2. **Performance**
   - LLM response time: <500ms p95
   - Fallback rate: <5%
   - Cache hit rate: >60%

3. **Reliability**
   - System still works if LLM unavailable
   - No degradation in user experience
   - Graceful error handling

---

## Cost Analysis

### LLM API Costs

Assumptions:
- 1000 classifications/day
- Average prompt: ~100 tokens
- Average response: ~50 tokens
- Cost: $0.001 per 1K tokens (example)

**Daily Cost:**
```
1000 requests × 150 tokens/request × $0.001 / 1000 tokens = $0.15/day
Monthly: $4.50
```

**With Caching (60% hit rate):**
```
400 LLM calls × 150 tokens × $0.001 / 1000 = $0.06/day
Monthly: $1.80
```

**ROI:**
- Improved accuracy → Better user experience
- Better memory organization → More relevant search results
- Reduced manual corrections → Support cost savings

---

## Risks and Mitigation

### Risk 1: LLM Latency
- **Mitigation:** Async processing, caching, timeouts
- **Fallback:** Pattern-based classification

### Risk 2: LLM Costs
- **Mitigation:** Aggressive caching, batch processing
- **Fallback:** Rate limiting, feature flag

### Risk 3: LLM Availability
- **Mitigation:** Multiple provider support, fallback logic
- **Fallback:** Pattern-based always available

### Risk 4: Quality Degradation
- **Mitigation:** A/B testing, monitoring, gradual rollout
- **Fallback:** Rollback to patterns if quality drops

---

## Conclusion

**Total TODOs:** 3 critical LLM integration points

**Recommended Approach:**
1. Start with memory type classification (simplest)
2. Add contradiction detection (most impactful)
3. Finish with extension detection (completes the suite)

**Timeline:** 3-4 weeks for complete implementation

**Priority:** HIGH - These are production blockers for intelligent memory management
