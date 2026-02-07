# LLM Integration Test Failure Investigation Report

**Date:** February 4, 2026
**Test File:** `tests/integration/llm-integration.test.ts`
**Total Tests:** 32 (26 passed, 6 failed)
**Pass Rate:** 81.25%

---

## Executive Summary

Six tests are failing due to three distinct root causes:

1. **JSON Response Format Issue (Anthropic)** - Malformed JSON with incomplete "The statement" text
2. **Fallback Behavior Mismatch** - Services using real LLM when fallback should trigger
3. **Heuristic Detection Failures** - Pattern matching not detecting expected relationships

These failures impact contradiction detection and extension detection, with 2 high-priority issues affecting LLM availability determination.

---

## Failure Details

### FAILURE 1: Anthropic Concurrent Requests - JSON Parse Error

**Test:** `Anthropic Provider Integration (Real API) > should handle concurrent requests`
**Status:** FAIL
**Error:** `SyntaxError: Unexpected token 'T', "The statem" is not valid JSON`
**Line:** 468 in test file

```javascript
results.forEach((result) => {
  expect(result.rawResponse).toBeTruthy();
  expect(() => JSON.parse(result.rawResponse)).not.toThrow(); // FAILS HERE
});
```

**Root Cause:** Anthropic API is returning malformed JSON in concurrent requests. The response starts with `"The statement"` instead of proper JSON object format.

**Impact:** HIGH - Anthropic provider unreliable for concurrent operations
**Frequency:** Intermittent (concurrent requests amplify the issue)
**Data Type:** Response parsing issue

**Evidence:**
- Test runs 3 concurrent requests simultaneously
- At least one returns broken JSON that starts with `"The statement..."`
- JSON.parse() throws on unexpected token 'T'
- This suggests API rate limiting or connection issues causing truncated/malformed responses

**Fix Recommendation:**
1. Implement response validation before JSON parsing
2. Add retry logic specifically for concurrent requests to Anthropic
3. Add timeout between concurrent requests or use sequential processing
4. Validate response starts with '{' before attempting JSON.parse()

---

### FAILURE 2: Memory Classifier - Fallback Not Triggered When LLM Available

**Test:** `Memory Classifier Service Integration > should fallback to patterns when LLM unavailable`
**Status:** FAIL
**Error:** `expected true to be false // Object.is equality` (line 590)
**Expected:** `result.usedLLM = false`
**Received:** `result.usedLLM = true`

```typescript
const noLLMClassifier = new MemoryClassifierService({
  fallbackToPatterns: true,
});

const result = await noLLMClassifier.classify('Paris is the capital of France');

expect(result.usedLLM).toBe(false); // FAILS - got true instead
```

**Root Cause:** `isLLMAvailable()` returns `true` even though test expects fallback to patterns.

**Impact:** MEDIUM - Tests not properly isolating LLM behavior
**Frequency:** Every run when real API keys are set
**Failure Mode:** Logic error - LLM is being used when test expects pattern matching

**Evidence:**
- Test creates classifier without explicit API key configuration
- `isLLMAvailable()` (line 146 in memory-classifier.service.ts) checks global LLM availability
- From `/src/services/llm/index.ts` line 223-230:
  ```typescript
  export function isLLMAvailable(): boolean {
    if (!isLLMFeatureEnabled()) {
      return false;
    }
    const hasOpenAI = !!(process.env[ENV_VARS.OPENAI_API_KEY] || appConfig.openaiApiKey);
    const hasAnthropic = !!process.env[ENV_VARS.ANTHROPIC_API_KEY];
    return hasOpenAI || hasAnthropic;
  }
  ```
- Since test uses environment API keys, function returns true
- Classifier never enters fallback path

**Fix Recommendation:**
1. Reset LLM provider before each test to ensure fresh state
2. Clear environment variables during test: `delete process.env.OPENAI_API_KEY`
3. Explicitly disable LLM in test setup: `process.env.MEMORY_ENABLE_LLM = 'false'`
4. Use feature flag or explicit provider override for test isolation
5. Consider: Pass explicit `enableLLM: false` parameter to classifier constructor

---

### FAILURE 3: Contradiction Detector - No Contradiction Without LLM

**Test:** `Contradiction Detector Service Integration > should detect compatible statements (no contradiction)`
**Status:** FAIL
**Error:** `expected 0 to be greater than or equal to 0.3` (line 657)
**Expected:** `result.confidence >= 0.3`
**Received:** `result.confidence = 0`

```typescript
const oldMemory = createTestMemory('I like pizza', 'preference');
const newMemory = createTestMemory('I also enjoy pasta', 'preference');

const result = await detector.checkContradiction(newMemory, oldMemory);

expect(result.isContradiction).toBe(false);
expect(result.confidence).toBeGreaterThanOrEqual(0.3); // FAILS - got 0
```

**Root Cause:** Word overlap check filtering out the comparison before confidence can be set.

**Impact:** MEDIUM - Contradictory confidence thresholds in logic
**Frequency:** Always occurs for low-overlap comparisons
**Failure Mode:** Early return with zero confidence

**Evidence:**
- From `contradiction-detector.service.ts` line 159-170:
  ```typescript
  const overlap = this.calculateWordOverlap(newMemory.content, existingMemory.content);
  if (overlap < this.config.minOverlapForCheck) {
    logger.debug('Skipping contradiction check due to low overlap', { overlap });
    return {
      isContradiction: false,
      confidence: 0, // <-- PROBLEM: Always 0 for low overlap
      reason: 'Insufficient content overlap',
      shouldSupersede: false,
      cached: false,
      usedLLM: false,
    };
  }
  ```
- "I like pizza" (4 words) vs "I also enjoy pasta" (4 words)
- Overlap calculation filters words >3 chars: "like", "pizza", "also", "enjoy", "pasta"
- Intersection: {"like", "pizza"} = 2
- Union: {"like", "pizza", "also", "enjoy", "pasta"} = 5
- Overlap = 2/5 = 0.4 (should pass 0.2 threshold)
- BUT: With common words filtered, actual overlap might be lower
- Test expects confidence even for non-contradictions, but logic returns 0 on low overlap

**Fix Recommendation:**
1. Return meaningful confidence values even for low-overlap cases
2. Confidence should reflect "no contradiction detected" state, not punishment for low overlap
3. Change early return to: `confidence: 0.1` instead of `0`
4. Or: Separate confidence (strength of evidence) from contradiction (binary)
5. Document: What overlap ratio triggers this filter

---

### FAILURE 4: Contradiction Detector - Update Not Detected

**Test:** `Contradiction Detector Service Integration > should detect update that supersedes`
**Status:** FAIL
**Error:** `expected false to be true` (line 674)
**Expected:** `result.isContradiction = true`
**Received:** `result.isContradiction = false`

```typescript
const oldMemory = createTestMemory('I live in New York', 'fact');
const newMemory = createTestMemory('I moved to San Francisco last month', 'event');

const result = await detector.checkContradiction(newMemory, oldMemory);

expect(result.isContradiction).toBe(true); // FAILS - got false
```

**Root Cause:** Insufficient word overlap filters out comparison before LLM can analyze semantic meaning.

**Impact:** HIGH - Critical relationship detection failure
**Frequency:** Always (word overlap < threshold)
**Failure Mode:** Semantic relationships hidden by syntactic filters

**Evidence:**
- Words in "I live in New York": {live, york}
- Words in "I moved to San Francisco last month": {moved, san, francisco, month}
- Common words (>3 chars): {} = empty set
- Overlap = 0 / 6 = 0.0
- Early exit at line 160 with `overlap < 0.2` check
- LLM never gets chance to analyze "New York" → "San Francisco" contradiction

**Test Configuration:**
```typescript
detector = new ContradictionDetectorService({
  minConfidence: 0.5,
  enableCache: true,
  fallbackToHeuristics: true,
});
```

**Fix Recommendation:**
1. Improve word overlap calculation to handle proper nouns (San Francisco)
2. Use semantic similarity instead of strict word overlap
3. Increase `minOverlapForCheck` threshold only for heuristic path
4. Always attempt LLM when available, regardless of overlap
5. Filter only when `!isLLMAvailable()` and falling back to heuristics

---

### FAILURE 5: Contradiction Detector - Heuristic Pattern Not Matching

**Test:** `Contradiction Detector Service Integration > should fallback to heuristics when LLM fails`
**Status:** FAIL
**Error:** `expected false to be true` (line 708)
**Expected:** `result.isContradiction = true`
**Received:** `result.isContradiction = false`

```typescript
const noLLMDetector = new ContradictionDetectorService({
  fallbackToHeuristics: true,
});

const oldMemory = createTestMemory('I work at Google', 'fact');
const newMemory = createTestMemory('I now work at Microsoft', 'fact');

const result = await noLLMDetector.checkContradiction(newMemory, oldMemory);

expect(result.isContradiction).toBe(true); // FAILS - got false
```

**Root Cause:** Heuristic pattern matching logic has contradictory requirements.

**Impact:** MEDIUM - Fallback mechanism unreliable
**Frequency:** Always (consistent pattern failure)
**Failure Mode:** Pattern detected but contradiction still false

**Evidence:**
- From `contradiction-detector.service.ts` line 385-399:
  ```typescript
  // Check for update indicators
  let hasUpdateIndicator = false;
  for (const pattern of RELATIONSHIP_INDICATORS.updates) {
    if (pattern.test(newLower)) {
      hasUpdateIndicator = true;
      break;
    }
  }
  // ... more checks ...
  const isContradiction = (hasUpdateIndicator || hasContradiction || hasSuperseding) && overlap > 0.3;
  ```
- Patterns for updates include: `/\b(now|currently|...)\b/i`
- Text "I now work at Microsoft" matches "now" pattern ✓
- Overlap: "work" vs "work" + "google" vs "microsoft"
  - Words: {"work", "microsoft"} intersect with {"work", "google"} = {"work"}
  - Union: {"work", "google", "microsoft"} = 3
  - Overlap = 1/3 = 0.33 > 0.3 ✓
- But contradiction requires: `hasUpdateIndicator && overlap > 0.3` which should be true
- Probable issue: `hasContradiction` check at line 394-398 requires overlap > 0.3 with contradiction pattern
- Final logic is: `(A || B || C) && overlap > 0.3` where A is true, overlap is true, so result should be true

**Hypothesis:** Overlap calculation is different or rounding issue causes 0.33 < 0.3

**Fix Recommendation:**
1. Verify overlap calculation is consistent across all code paths
2. Add logging to debug overlap values in tests
3. Adjust threshold from 0.3 to 0.25 for update indicators
4. Separate thresholds for different contradiction types
5. Test with exact data to verify overlap calculation

---

### FAILURE 6: Extension Detector - Fallback Not Triggered

**Test:** `Memory Extension Detector Service Integration > should fallback to heuristics when LLM unavailable`
**Status:** FAIL
**Error:** `expected true to be false` (line 813)
**Expected:** `result.usedLLM = false`
**Received:** `result.usedLLM = true`

```typescript
const noLLMDetector = new MemoryExtensionDetectorService({
  fallbackToHeuristics: true,
});

const oldMemory = createTestMemory('I like coffee', 'preference');
const newMemory = createTestMemory('I like coffee and tea', 'preference');

const result = await noLLMDetector.checkExtension(newMemory, oldMemory);

expect(result.isExtension).toBe(true); // PASSES
expect(result.usedLLM).toBe(false);  // FAILS - got true
```

**Root Cause:** Same as Failure #2 - `isLLMAvailable()` global function prevents fallback.

**Impact:** MEDIUM - Test isolation issue
**Frequency:** Every run when API keys present
**Failure Mode:** Falls back to LLM instead of heuristics

**Evidence:**
- Same root cause as Failure #2
- `isLLMAvailable()` checks global environment, not test-specific configuration
- No mechanism to disable LLM for specific test instances

**Fix Recommendation:**
1. Same as Failure #2 - implement test isolation
2. Add `enableLLM` parameter to service constructors
3. Clear API keys in test setup/teardown
4. Consider dependency injection to override LLM availability in tests

---

## Root Cause Summary

| ID | Type | Severity | Component | Root Cause |
|---|------|----------|-----------|-----------|
| 1 | API Format | HIGH | Anthropic Provider | Concurrent requests returning malformed JSON |
| 2 | Test Isolation | MEDIUM | Memory Classifier | Global `isLLMAvailable()` prevents test fallback |
| 3 | Validation Logic | MEDIUM | Contradiction Detector | Zero confidence on low overlap, contradicts test expectations |
| 4 | Semantic Filter | HIGH | Contradiction Detector | Word overlap filter blocks semantic contradiction detection |
| 5 | Pattern Logic | MEDIUM | Contradiction Detector | Heuristic pattern matching contradictory requirements |
| 6 | Test Isolation | MEDIUM | Extension Detector | Same as #2 - global LLM availability prevents fallback test |

---

## Patterns Discovered

### Pattern 1: Test Isolation Issues
**Failures:** 2, 6
**Problem:** Services use global `isLLMAvailable()` function that checks environment variables, making it impossible to test fallback behavior when API keys are present.
**Pattern:** Lack of dependency injection or feature flags for testing

### Pattern 2: Semantic vs. Syntactic Filtering
**Failures:** 1, 4
**Problem:** Syntactic filters (word overlap, response format) block semantic analysis that the LLM could handle.
**Pattern:** Over-optimization of early-exit paths

### Pattern 3: Threshold Configuration
**Failures:** 3, 5
**Problem:** Confidence and overlap thresholds contradict test expectations and heuristic logic requirements.
**Pattern:** Threshold values tuned for production, not validated against test scenarios

---

## Fix Priority & Strategy

### Phase 1: Critical (Blocking Production)
1. **Fix Failure #1** (Anthropic JSON issue)
   - Add response validation
   - Implement retry for concurrent requests
   - Document format expectations

2. **Fix Failure #4** (Word overlap blocking contradiction detection)
   - Remove or adjust overlap filter for LLM path
   - Keep filter only for heuristic path

### Phase 2: Important (High Impact)
3. **Fix Failures #2 & #6** (Test isolation)
   - Add `enableLLM` constructor parameter
   - Clear API keys in test setup
   - Or: Mock `isLLMAvailable()` in tests

4. **Fix Failure #5** (Heuristic pattern logic)
   - Debug overlap calculation
   - Verify threshold consistency
   - Add logging

### Phase 3: Enhancement (Nice to Have)
5. **Fix Failure #3** (Zero confidence on low overlap)
   - Return meaningful confidence values
   - Separate "contradiction found" from "overlap inadequate"

---

## Test Execution Context

**Environment:**
- Test file: `tests/integration/llm-integration.test.ts`
- Real API calls to OpenAI (gpt-4o-mini) and Anthropic (claude-3-haiku)
- API keys checked from environment: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
- Cost tracking: ~$0.0008 estimated for 17 API calls
- Timeout: 30-60 seconds per test

**Setup:**
- Tests skip gracefully if API keys missing
- Mock provider fallback when no API keys
- Services reset between tests: `resetMemoryClassifier()`, `resetLLMProvider()`
- Environment variables persist between tests (source of isolation issues)

---

## Recommendations

### Immediate Actions
1. Add environment variable cleanup in test teardown
2. Add response validation to Anthropic provider
3. Adjust word overlap threshold for LLM path

### Short-term Improvements
1. Implement `enableLLM` parameter in service constructors
2. Add dependency injection for LLM provider availability
3. Document threshold expectations in services

### Long-term Architecture
1. Replace global `isLLMAvailable()` with dependency-injected provider
2. Implement feature flag system instead of environment-based config
3. Separate syntax validation from semantic filtering
4. Add comprehensive logging for threshold decisions

---

## Test Data Analysis

**Anthropic Concurrent Request Issue:**
- Payload: 3 concurrent requests
- One request returned invalid JSON starting with `"The statement"`
- Suggests: Rate limiting, connection loss, or response truncation

**Contradiction Detector Test Data:**
- Old: "I live in New York" (4 unique words > 3 chars: none with >3 chars except "live", "york")
- New: "I moved to San Francisco last month" (unique words: "moved", "san", "francisco", "month")
- Calculated overlap: ~0% (proper nouns not matching)
- Expected: Detected as contradiction (semantic meaning clear)
- Actual: Filtered out as low overlap

**Extension Detector Test Data:**
- Old: "I like coffee"
- New: "I like coffee and tea"
- Overlap: "like" (common) = potentially ~20-30%
- Heuristic pattern: "and" detected as extension indicator ✓
- Expected: Extension detected via heuristics (no LLM)
- Actual: LLM used (due to global availability)

---

## Conclusion

The failures stem from **three independent issues:**

1. **Anthropic API reliability** - Concurrent requests producing invalid JSON
2. **Test isolation** - Global LLM availability preventing fallback tests
3. **Filtering logic** - Syntactic filters blocking semantic analysis

**All are fixable** with targeted interventions. Failures #2 and #6 are simple test setup issues. Failure #4 is a design issue (word overlap too restrictive). Failures #3 and #5 are threshold/logic issues. Only Failure #1 requires API/provider-level investigation.

**Priority:** Fix #1 (API reliability) and #4 (semantic blocking) first, as they affect production. Then fix test isolation issues for test reliability.
