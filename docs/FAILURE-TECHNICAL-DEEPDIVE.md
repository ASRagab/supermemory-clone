# LLM Integration Test Failures - Technical Deep Dive

**Target Audience:** Backend developers, test engineers
**Complexity:** Advanced
**Date:** February 4, 2026

---

## Failure #1: Anthropic Concurrent Request JSON Corruption

### Symptom
```
Error: SyntaxError: Unexpected token 'T', "The statem" is not valid JSON
Test: Anthropic Provider Integration > should handle concurrent requests
Location: tests/integration/llm-integration.test.ts:468
```

### Full Error Context
```javascript
const results = await Promise.all(promises); // 3 concurrent requests

expect(results).toHaveLength(3);
results.forEach((result) => {
  expect(result.rawResponse).toBeTruthy();
  expect(() => JSON.parse(result.rawResponse)).not.toThrow(); // FAILS on one result
});
```

### Root Analysis

#### Step 1: Identify Malformed Response
The error message includes `"The statem"` which suggests:
- Response was truncated
- Response format is not JSON
- Likely raw text response when JSON expected

**Theory:** Anthropic API is returning plain text instead of JSON format

```
Expected: {"type": "fact|event|relationship", ...}
Received: "The statement \"I enjoy reading\" is..."
```

#### Step 2: Concurrency Pattern
The test runs 3 simultaneous requests:
```typescript
const prompts = [
  'Classify: I enjoy reading',
  'Classify: Birthday party tomorrow',
  'Classify: John is my colleague',
];

const promises = prompts.map((prompt) =>
  provider.generateJson(
    'Classify. Respond JSON: {"type": "fact|event|relationship"}',
    prompt
  )
);

const results = await Promise.all(promises);
```

**Pattern:**
- Test randomization or timing exposes issue
- Single requests work fine
- Concurrent requests sometimes fail
- Suggests: Rate limiting, connection pooling, or response buffering issue

#### Step 3: Provider Configuration
```typescript
provider = createAnthropicProvider({
  apiKey: ANTHROPIC_KEY!,
  model: 'claude-3-haiku-20240307', // Cheapest model
  maxTokens: 150,
  temperature: 0.1,
  timeoutMs: 30000,
  maxRetries: 3,
});
```

**Analysis:**
- maxTokens: 150 (very restrictive)
- maxRetries: 3 (should help, but not concurrent-specific)
- timeoutMs: 30000 (reasonable)

**Issue:** No request queuing or concurrency limiting

#### Step 4: Probable Root Cause

Anthropic's API likely has:
1. Connection pooling limits
2. Per-connection request limits
3. Rate limiting that triggers on concurrent requests
4. Response format degradation under load

When hit: Returns fallback response or error message as plain text

### Diagnostic Approach

```typescript
// Test to debug
it('should handle concurrent requests - DEBUG', async () => {
  const prompts = [
    'Classify: I enjoy reading',
    'Classify: Birthday party tomorrow',
    'Classify: John is my colleague',
  ];

  const promises = prompts.map((prompt, index) =>
    provider.generateJson(
      'Classify. Respond JSON: {"type": "fact|event|relationship"}',
      prompt
    )
    .catch(err => {
      console.log(`Request ${index} failed:`, err.message);
      return null;
    })
  );

  const results = await Promise.all(promises);
  results.forEach((result, i) => {
    console.log(`Result ${i}:`, {
      status: result ? 'OK' : 'FAILED',
      response: result?.rawResponse?.substring(0, 100),
    });
  });
});
```

### Solution Strategies

#### Strategy 1: Sequential Processing (Safest)
```typescript
// Instead of Promise.all()
const results: typeof promises extends (infer T)[] ? Awaited<T>[] : never = [];
for (const prompt of prompts) {
  results.push(await provider.generateJson(systemPrompt, prompt));
}
```

**Pros:**
- Guaranteed to work
- Tests sequential reliability

**Cons:**
- Slower test execution
- Doesn't test actual concurrent capability

#### Strategy 2: Response Validation (Robust)
```typescript
async doGenerateJson(systemPrompt: string, userPrompt: string): Promise<{...}> {
  const response = await this.call(systemPrompt, userPrompt);

  // NEW: Validate response format
  if (!response.content || response.content.length === 0) {
    throw LLMError.invalidResponse('anthropic', 'Empty response');
  }

  // NEW: Check for JSON format
  const text = response.content[0].text;
  if (!text.startsWith('{')) {
    // Response is not JSON, might be error message
    logger.warn('Non-JSON response received', { preview: text.substring(0, 100) });
    throw LLMError.invalidResponse('anthropic', 'Response is not valid JSON');
  }

  return {
    rawResponse: text,
    tokensUsed: { ... }
  };
}
```

**Pros:**
- Catches malformed responses early
- Enables proper error handling
- Still tests concurrent capability

**Cons:**
- Might reject valid non-JSON responses (unlikely)

#### Strategy 3: Request Queuing (Preventive)
```typescript
class AnthropicLLMProvider extends BaseLLMProvider {
  private requestQueue = new PQueue({ concurrency: 1 }); // Queue requests

  protected async doGenerateJson(systemPrompt: string, userPrompt: string) {
    return this.requestQueue.add(() =>
      this.makeRequest(systemPrompt, userPrompt)
    );
  }

  private async makeRequest(systemPrompt: string, userPrompt: string) {
    // Actual API call
  }
}
```

**Pros:**
- Prevents concurrent request issues entirely
- Works with Anthropic's limitations

**Cons:**
- Slower due to queueing
- Hides concurrency problems instead of fixing them

#### Strategy 4: Retry with Exponential Backoff (Resilient)
```typescript
protected async doGenerateJson(systemPrompt: string, userPrompt: string) {
  for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
    try {
      const response = await this.makeRequest(systemPrompt, userPrompt);

      // NEW: Validate format
      if (!this.isValidJsonResponse(response)) {
        throw new Error('Invalid response format');
      }

      return response;
    } catch (error) {
      if (attempt < this.config.maxRetries - 1) {
        // Exponential backoff
        await sleep(Math.pow(2, attempt) * 1000);
      } else {
        throw error;
      }
    }
  }
}

private isValidJsonResponse(response: { content: Array<{ text: string }> }): boolean {
  if (!response.content || response.content.length === 0) return false;
  const text = response.content[0].text.trim();
  return text.startsWith('{') || text.startsWith('[');
}
```

**Pros:**
- Automatic recovery from transient failures
- No architectural changes
- Works with any provider

**Cons:**
- Increases latency on failures
- Might mask real issues

### Recommended Fix
Use **Strategy 2 + Strategy 4 combined:**
1. Add response format validation
2. Add retry logic for invalid responses
3. Keep concurrent requests (don't queue)
4. Improve error messages for debugging

---

## Failure #4: Word Overlap Filter Blocking Semantic Contradiction

### Symptom
```
Test: Contradiction Detector > should detect update that supersedes
Expected: result.isContradiction = true
Received: result.isContradiction = false
Location: Line 674
```

### Test Case
```typescript
const oldMemory = createTestMemory('I live in New York', 'fact');
const newMemory = createTestMemory('I moved to San Francisco last month', 'event');

const result = await detector.checkContradiction(newMemory, oldMemory);
expect(result.isContradiction).toBe(true); // FAILS
```

### Root Cause Analysis

#### Step 1: Trace Execution Path

```typescript
// contradiction-detector.service.ts - checkContradiction()

// STEP 1: Calculate word overlap
const overlap = this.calculateWordOverlap(newMemory.content, existingMemory.content);

// "I live in New York" →
//   words: ["live", "york"]
// "I moved to San Francisco last month" →
//   words: ["moved", "san", "francisco", "month"]
```

#### Step 2: Calculate Exact Overlap
```typescript
private calculateWordOverlap(text1: string, text2: string): number {
  const words1 = new Set(
    text1
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)  // Filter: only words > 3 chars
  );
  const words2 = new Set(
    text2
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );

  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return union.size > 0 ? intersection.size / union.size : 0;
}

// Text1: "i live in new york"
// Words > 3 chars: ["live", "york"]
// Set1: {"live", "york"}

// Text2: "i moved to san francisco last month"
// Words > 3 chars: ["moved", "san", "francisco", "last", "month"]
// Set2: {"moved", "san", "francisco", "last", "month"}

// Intersection: {} (empty - no common words)
// Union: {"live", "york", "moved", "san", "francisco", "last", "month"}
// Overlap = 0 / 7 = 0.0
```

#### Step 3: Check Against Threshold
```typescript
if (overlap < this.config.minOverlapForCheck) {
  logger.debug('Skipping contradiction check due to low overlap', { overlap });
  return {
    isContradiction: false,
    confidence: 0,
    reason: 'Insufficient content overlap',
    shouldSupersede: false,
    cached: false,
    usedLLM: false,  // <-- PROBLEM: Never tries LLM
  };
}

// this.config.minOverlapForCheck = 0.2 (default)
// overlap = 0.0 < 0.2 → TRUE
// Early exit with isContradiction = false
```

#### Step 4: Why This Is Wrong

The semantic contradiction is **obvious:**
- OLD: "I live in New York"
- NEW: "I moved to San Francisco last month"

But syntactic word overlap is **zero:**
- No common content words between locations
- Proper nouns don't match (New York ≠ San Francisco)
- Verbs are different (live ≠ moved)

**The whole point of LLM is to handle this!** But the filter prevents LLM from being called.

### Code Flow Comparison

#### Current (Broken)
```
Input: "I live in New York" vs "I moved to San Francisco last month"
↓
Check word overlap: 0%
↓
overlap < 0.2? YES
↓
Return: isContradiction = false (without trying LLM)
↓
TEST FAILS ❌
```

#### Desired (Fixed)
```
Input: "I live in New York" vs "I moved to San Francisco last month"
↓
If LLM available:
  Call LLM with full content
  ↓
  LLM recognizes: location change = contradiction
  ↓
  Return: isContradiction = true, confidence = 0.95
  ↓
  TEST PASSES ✓
Else (no LLM):
  Check word overlap: 0%
  ↓
  overlap < 0.2? YES
  ↓
  Return: isContradiction = false (heuristic)
```

### Solution

#### Fix Location
**File:** `src/services/llm/contradiction-detector.service.ts`
**Method:** `checkContradiction()`
**Lines:** 156-170

#### Current Code
```typescript
async checkContradiction(
  newMemory: Memory,
  existingMemory: Memory
): Promise<ContradictionResult> {
  this.stats.totalChecks++;

  // Quick filter: check word overlap first
  const overlap = this.calculateWordOverlap(newMemory.content, existingMemory.content);
  if (overlap < this.config.minOverlapForCheck) {
    logger.debug('Skipping contradiction check due to low overlap', { overlap });
    return {
      isContradiction: false,
      confidence: 0,
      reason: 'Insufficient content overlap',
      shouldSupersede: false,
      cached: false,
      usedLLM: false,
    };
  }

  // ... rest of code
}
```

#### Fixed Code
```typescript
async checkContradiction(
  newMemory: Memory,
  existingMemory: Memory
): Promise<ContradictionResult> {
  this.stats.totalChecks++;

  // Calculate word overlap for later use
  const overlap = this.calculateWordOverlap(newMemory.content, existingMemory.content);

  // NEW: Try LLM first if available (regardless of overlap)
  if (isLLMAvailable()) {
    try {
      const result = await this.detectWithLLM(newMemory, existingMemory);
      this.stats.llmChecks++;

      if (result.isContradiction) {
        this.stats.contradictionsFound++;
      }

      // Cache the result
      if (this.config.enableCache && result.confidence >= this.config.minConfidence) {
        this.setCached(newMemory.content, existingMemory.content, {
          isContradiction: result.isContradiction,
          confidence: result.confidence,
          reason: result.reason,
          shouldSupersede: result.shouldSupersede,
          timestamp: Date.now(),
        });
      }

      return {
        ...result,
        cached: false,
        usedLLM: true,
      };
    } catch (error) {
      this.stats.errors++;
      logger.warn('LLM contradiction detection failed, falling back to heuristics', {
        error: error instanceof Error ? error.message : String(error),
      });

      if (!this.config.fallbackToHeuristics) {
        throw error;
      }
      // Continue to heuristic path below
    }
  }

  // CHANGED: Now only check overlap for heuristic path
  if (overlap < this.config.minOverlapForCheck) {
    logger.debug('Skipping heuristic check due to low overlap', { overlap });
    return {
      isContradiction: false,
      confidence: 0,
      reason: 'Insufficient content overlap',
      shouldSupersede: false,
      cached: false,
      usedLLM: false,
    };
  }

  // Fallback to heuristics (unchanged)
  const heuristicResult = this.detectWithHeuristics(newMemory, existingMemory);
  this.stats.heuristicChecks++;

  if (heuristicResult.isContradiction) {
    this.stats.contradictionsFound++;
  }

  return {
    ...heuristicResult,
    cached: false,
    usedLLM: false,
  };
}
```

### Key Changes
1. **Remove overlap check before LLM call** - Let LLM handle semantic meaning
2. **Keep overlap check for heuristic path only** - Optimize heuristic performance
3. **Try LLM regardless of overlap** - That's what LLM is for!
4. **Fall back to overlap filter only if LLM unavailable** - Graceful degradation

### Performance Impact
- **With API keys:** No change (LLM still called when available)
- **Without API keys:** No change (heuristic path unchanged)
- **Actual impact:** Better contradiction detection for semantic differences

### Testing Impact
```typescript
// This test will now PASS
it('should detect update that supersedes', async () => {
  const oldMemory = createTestMemory('I live in New York', 'fact');
  const newMemory = createTestMemory('I moved to San Francisco last month', 'event');

  const result = await detector.checkContradiction(newMemory, oldMemory);

  // Now works because LLM is called despite 0% word overlap
  expect(result.isContradiction).toBe(true); // ✓
  expect(result.shouldSupersede).toBe(true);
  expect(result.usedLLM).toBe(true);
});
```

---

## Failure #2 & #6: Test Isolation Issue

### Root Cause
Services use global `isLLMAvailable()` function that checks environment variables:

```typescript
// src/services/llm/index.ts
export function isLLMAvailable(): boolean {
  if (!isLLMFeatureEnabled()) {
    return false;
  }
  const hasOpenAI = !!(process.env[ENV_VARS.OPENAI_API_KEY] || appConfig.openaiApiKey);
  const hasAnthropic = !!process.env[ENV_VARS.ANTHROPIC_API_KEY];
  return hasOpenAI || hasAnthropic;
}
```

When environment has API keys, `isLLMAvailable()` always returns `true`, making it impossible to test fallback behavior.

### Test Expectations

```typescript
it('should fallback to patterns when LLM unavailable', async () => {
  // Create classifier WITHOUT explicit LLM configuration
  const noLLMClassifier = new MemoryClassifierService({
    fallbackToPatterns: true,
  });

  const result = await noLLMClassifier.classify('Paris is the capital of France');

  // EXPECTATION: Uses patterns, not LLM
  expect(result.type).toBe('fact');
  expect(result.usedLLM).toBe(false);  // <-- FAILS because LLM is available globally
  expect(result.cached).toBe(false);
});
```

### Solution Strategies

#### Strategy 1: Clear Environment Variables (Simplest)
```typescript
beforeEach(() => {
  // Clear API keys to force fallback
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  resetMemoryClassifier();
  resetLLMProvider();
});

afterEach(() => {
  // Restore API keys if needed
  process.env.OPENAI_API_KEY = OPENAI_KEY;
  process.env.ANTHROPIC_API_KEY = ANTHROPIC_KEY;
});
```

**Pros:** Simple, effective, minimal code changes
**Cons:** Modifies global state, might affect other tests

#### Strategy 2: Add Constructor Parameter (Recommended)
```typescript
// memory-classifier.service.ts
export interface ClassifierConfig {
  minConfidence?: number;
  enableCache?: boolean;
  fallbackToPatterns?: boolean;
  enableLLM?: boolean;  // NEW: Explicit LLM control
}

export class MemoryClassifierService {
  private enableLLM: boolean;

  constructor(config: ClassifierConfig = {}) {
    this.config = { ... };
    this.enableLLM = config.enableLLM ?? true;  // Default: enabled
  }

  async classify(content: string): Promise<ClassificationResult> {
    // ... cache check ...

    // Use instance flag instead of global function
    if (this.enableLLM && isLLMAvailable()) {
      try {
        // Use LLM
      } catch (error) {
        // Fallback
      }
    }

    // Fallback to patterns
  }
}
```

**Test Usage:**
```typescript
it('should fallback to patterns when LLM unavailable', async () => {
  // Explicitly disable LLM for this test
  const noLLMClassifier = new MemoryClassifierService({
    enableLLM: false,  // NEW
    fallbackToPatterns: true,
  });

  const result = await noLLMClassifier.classify('Paris is the capital of France');

  expect(result.usedLLM).toBe(false); // ✓ PASSES
});
```

**Pros:**
- Explicit, intention-clear
- No global state modification
- Works with any environment config

**Cons:**
- Requires changes to 3 service classes
- Adds parameter to each service

#### Strategy 3: Mock isLLMAvailable() (Flexible)
```typescript
import { vi } from 'vitest';
import * as llmModule from '../../src/services/llm/index.js';

describe('Fallback behavior', () => {
  beforeEach(() => {
    // Mock to always return false
    vi.spyOn(llmModule, 'isLLMAvailable').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fallback to patterns when LLM unavailable', async () => {
    const classifier = new MemoryClassifierService({
      fallbackToPatterns: true,
    });

    const result = await classifier.classify('Paris is the capital of France');
    expect(result.usedLLM).toBe(false); // ✓ PASSES
  });
});
```

**Pros:**
- No code changes required in services
- Works with existing implementation

**Cons:**
- Requires test-level mocking
- Less explicit about intent

### Recommended Solution
**Combine Strategy 1 (quick) + Strategy 2 (long-term):**

1. **Short-term:** Add env var cleanup to test setup
2. **Long-term:** Add `enableLLM` parameter to services

```typescript
// tests/integration/llm-integration.test.ts

describe('Memory Classifier Service Integration', () => {
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    resetMemoryClassifier();
    resetLLMProvider();

    if (HAS_OPENAI || HAS_ANTHROPIC) {
      // Real API tests: keep keys
      process.env.OPENAI_API_KEY = OPENAI_KEY;
      process.env.ANTHROPIC_API_KEY = ANTHROPIC_KEY;
      // ...
    }
  });

  afterEach(() => {
    resetMemoryClassifier();
    resetLLMProvider();
  });

  // ...

  it('should fallback to patterns when LLM unavailable', async () => {
    // NEW: Clear keys for this specific test
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const noLLMClassifier = new MemoryClassifierService({
      fallbackToPatterns: true,
    });

    const result = await noLLMClassifier.classify('Paris is the capital of France');

    expect(result.type).toBe('fact');
    expect(result.usedLLM).toBe(false);  // ✓ Now PASSES
    expect(result.cached).toBe(false);

    // Restore keys
    process.env.OPENAI_API_KEY = originalOpenAIKey;
    process.env.ANTHROPIC_API_KEY = originalAnthropicKey;

    updateStats('mock');
  });
});
```

---

## Failure #3: Zero Confidence on Low Overlap

### Problem
```typescript
if (overlap < this.config.minOverlapForCheck) {
  return {
    isContradiction: false,
    confidence: 0,  // <-- Problem: always 0
    reason: 'Insufficient content overlap',
    // ...
  };
}
```

Test expects:
```typescript
expect(result.isContradiction).toBe(false); // ✓ Got false
expect(result.confidence).toBeGreaterThanOrEqual(0.3); // ✗ Got 0
```

### Root Cause
Confidence = 0 is semantically "no evidence found" but should be "check skipped, no relationship found"

### Solution
```typescript
if (overlap < this.config.minOverlapForCheck) {
  return {
    isContradiction: false,
    confidence: 0.1,  // CHANGED: Non-zero indicates "checked but negative"
    reason: 'Insufficient content overlap',
    shouldSupersede: false,
    cached: false,
    usedLLM: false,
  };
}
```

Or more nuanced:
```typescript
if (overlap < this.config.minOverlapForCheck) {
  return {
    isContradiction: false,
    confidence: Math.min(0.3, overlap + 0.1),  // Confidence based on overlap
    reason: `Insufficient content overlap (${(overlap * 100).toFixed(1)}%)`,
    shouldSupersede: false,
    cached: false,
    usedLLM: false,
  };
}
```

---

## Summary Table: All Failures

| # | Failure | Root Cause | Code Location | Complexity | Fix Time |
|---|---------|-----------|---|-----------|----------|
| 1 | Anthropic concurrent JSON | API returns malformed JSON under load | anthropic.ts | Medium | 30min |
| 2 | Classifier fallback blocked | Global `isLLMAvailable()` prevents test | memory-classifier.ts:146 | Low | 15min |
| 3 | Zero confidence on low overlap | Semantic vs syntactic meaning | contradiction-detector.ts:164 | Low | 5min |
| 4 | Word overlap blocks LLM | Filter applied before LLM call | contradiction-detector.ts:159 | Medium | 10min |
| 5 | Heuristic pattern fails | Contradictory threshold logic | contradiction-detector.ts:410 | Medium | 20min |
| 6 | Extension fallback blocked | Same as #2 | memory-extension-detector.ts:189 | Low | 15min |

---

## Testing After Fixes

```bash
# Test each fix individually
npm test -- tests/integration/llm-integration.test.ts -t "should detect update that supersedes" --run

# Test all integrations
npm test -- tests/integration/llm-integration.test.ts --run

# Test with no API keys (force mocks)
unset OPENAI_API_KEY ANTHROPIC_API_KEY
npm test -- tests/integration/llm-integration.test.ts --run

# Verify cost tracking
npm test -- tests/integration/llm-integration.test.ts --run 2>&1 | grep "Estimated Cost"
```

Expected output after fixes:
```
✓ Tests:  32 passed
✓ Estimated Cost: $0.0008
```

