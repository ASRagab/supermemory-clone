# LLM Integration Test Failures - Quick Reference

**Test Run:** February 4, 2026
**Total Tests:** 32 | **Passed:** 26 | **Failed:** 6 | **Pass Rate:** 81.25%

---

## Failure Matrix

| # | Test Name | Status | Error | Line | Root Cause | Fix |
|---|-----------|--------|-------|------|-----------|-----|
| 1 | Anthropic: Handle concurrent requests | FAIL | `SyntaxError: Unexpected token 'T'` | 468 | Malformed JSON response from API | Validate response format + retry logic |
| 2 | Memory Classifier: Fallback to patterns | FAIL | `expected true to be false` | 590 | `isLLMAvailable()` returns true (API keys present) | Clear env vars in test setup |
| 3 | Contradiction: Compatible statements | FAIL | `expected 0 >= 0.3` (confidence) | 657 | Early exit returns 0 confidence on low overlap | Return meaningful confidence values |
| 4 | Contradiction: Update that supersedes | FAIL | `expected false to be true` | 674 | Word overlap filter blocks semantic analysis (0% overlap for "New York" → "San Francisco") | Remove overlap filter for LLM path |
| 5 | Contradiction: Fallback to heuristics | FAIL | `expected false to be true` | 708 | Heuristic pattern detected but final contradiction logic fails | Debug overlap calculation, verify thresholds |
| 6 | Extension: Fallback to heuristics | FAIL | `expected true to be false` | 813 | Same as #2 - `isLLMAvailable()` prevents fallback | Same as #2 |

---

## Failure Categories

### Category A: Test Isolation (Failures #2, #6)
**Problem:** Services check global `isLLMAvailable()` which reads from environment
**Tests can't force fallback behavior when API keys are set**
**Fix:** Clear env vars in test setup or add `enableLLM` parameter

```typescript
// CURRENT (BROKEN)
const classifier = new MemoryClassifierService({ fallbackToPatterns: true });
// Still uses LLM because isLLMAvailable() checks process.env.OPENAI_API_KEY

// SOLUTION
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
const classifier = new MemoryClassifierService({ fallbackToPatterns: true });
// Now properly falls back to patterns
```

### Category B: Semantic Filtering (Failures #1, #4)
**Problem:** Syntactic filters prevent semantic analysis
**Word overlap too restrictive, JSON format validation too strict**
**Fix:** Validate format better, don't filter before LLM analysis

```typescript
// CURRENT (BROKEN) - Contradiction detector
const overlap = this.calculateWordOverlap(newMemory.content, existingMemory.content);
if (overlap < 0.2) {
  return { isContradiction: false, confidence: 0, ... }; // Gives up without trying LLM
}

// SOLUTION
if (isLLMAvailable()) {
  // Try LLM regardless of overlap
  const result = await this.detectWithLLM(newMemory, existingMemory);
  return result;
}
// Only apply overlap filter for heuristic fallback
if (overlap < 0.2) {
  return { isContradiction: false, confidence: 0, ... };
}
```

### Category C: Validation Logic (Failures #3, #5)
**Problem:** Confidence values contradictory, threshold logic unclear
**Tests expect meaningful confidence even for non-matches**
**Fix:** Improve threshold values and confidence calculation

```typescript
// CURRENT (BROKEN)
if (overlap < 0.2) {
  return { confidence: 0, ... }; // Zero confidence always

// SOLUTION
if (overlap < 0.2) {
  return { confidence: 0.1, reason: 'Insufficient overlap' }; // Non-zero indicates "checked"
}
```

---

## Severity Assessment

| Severity | Count | Failures | Impact |
|----------|-------|----------|--------|
| CRITICAL | 1 | #4 | Blocks production contradiction detection |
| HIGH | 1 | #1 | API unreliability in concurrent scenarios |
| MEDIUM | 4 | #2, #3, #5, #6 | Test reliability + threshold issues |

---

## Code Locations

### Services with Issues
```
src/services/llm/
├── contradiction-detector.service.ts
│   ├── Line 159-170: Overlap filter blocks LLM
│   ├── Line 385-410: Heuristic pattern logic
│   └── Line 444-461: Overlap calculation
├── memory-classifier.service.ts
│   ├── Line 146: isLLMAvailable() prevents fallback test
│   └── Line 179-188: Pattern fallback path
├── memory-extension-detector.service.ts
│   ├── Line 189: isLLMAvailable() prevents fallback test
│   └── Line 225-237: Heuristic fallback path
├── anthropic.ts
│   └── Response format validation needed
└── index.ts
    ├── Line 223-230: isLLMAvailable() function
    └── Feature flag system needed
```

### Test File
```
tests/integration/llm-integration.test.ts
├── Line 488-504: Setup doesn't clear environment variables
├── Line 590: Test #2 assertion
├── Line 657: Test #3 assertion
├── Line 674: Test #4 assertion
├── Line 708: Test #5 assertion
└── Line 813: Test #6 assertion
```

---

## Recommended Fix Order

### Phase 1: Critical Path (Do First)
1. **Failure #4** - Remove word overlap filter before LLM call
   - File: `src/services/llm/contradiction-detector.service.ts`
   - Impact: Fixes production contradiction detection
   - Risk: Low (only changes filter placement)
   - Effort: 10 minutes

2. **Failure #1** - Add Anthropic response validation
   - File: `src/services/llm/anthropic.ts`
   - Impact: Prevents JSON parse errors
   - Risk: Medium (need to handle edge cases)
   - Effort: 30 minutes

### Phase 2: Test Infrastructure (Do Second)
3. **Failures #2, #6** - Fix test isolation
   - File: `tests/integration/llm-integration.test.ts`
   - Impact: Tests properly validate fallback behavior
   - Risk: Low (test-only changes)
   - Effort: 20 minutes
   - Options:
     - Option A: Clear env vars in beforeEach()
     - Option B: Add `enableLLM` parameter to services
     - Option C: Mock `isLLMAvailable()` in tests

### Phase 3: Thresholds & Logic (Do Third)
4. **Failure #5** - Fix heuristic pattern logic
   - File: `src/services/llm/contradiction-detector.service.ts`
   - Effort: 15-30 minutes (debug required)

5. **Failure #3** - Fix confidence thresholds
   - File: `src/services/llm/contradiction-detector.service.ts`
   - Effort: 10 minutes

---

## Testing Strategy

### Validate Fixes
```bash
# Run failing tests only
npm test -- tests/integration/llm-integration.test.ts --run --reporter=verbose

# Run with no API keys (force mock)
unset OPENAI_API_KEY ANTHROPIC_API_KEY
npm test -- tests/integration/llm-integration.test.ts --run

# Run with one API key only
export OPENAI_API_KEY=sk-...
unset ANTHROPIC_API_KEY
npm test -- tests/integration/llm-integration.test.ts --run

# Check costs
grep "Estimated Cost" [test output]
```

### Validate No Regressions
```bash
npm test -- tests/integration/ --run
npm test -- tests/services/ --run
```

---

## Key Insights

1. **Overlap calculation is too restrictive for semantic relationships**
   - "New York" → "San Francisco" has 0% word overlap but 100% semantic contradiction
   - Should only filter heuristic path, not LLM path

2. **Environment variables leak between tests**
   - API keys persist across test cases
   - Prevents testing fallback behavior
   - Need explicit cleanup or dependency injection

3. **Anthropic API format issues under concurrency**
   - Single requests work fine
   - Concurrent requests sometimes return invalid JSON
   - Need response validation before parsing

4. **Heuristic patterns working, but final logic contradictory**
   - Pattern matches "now" in "I now work at Microsoft"
   - But final `isContradiction` still false
   - Suggests threshold/overlap calculation bug

5. **Confidence semantics unclear**
   - Zero confidence on low overlap is actually "didn't check"
   - Should probably be "checked but no relationship found"
   - Need clearer confidence semantics

---

## Monitoring Checklist

After fixes, monitor for:
- [ ] All 32 tests passing consistently
- [ ] No API timeouts or retries needed
- [ ] Heuristic fallback working when LLM unavailable
- [ ] Contradiction detection accuracy > 85%
- [ ] Extension detection accuracy > 80%
- [ ] Cost stays under $0.001 per 100 calls
- [ ] No false positives from overly aggressive matching

---

## Related Issues

- Fallback mechanism tested but not verified in production
- No performance benchmarks for contradiction detection
- No accuracy metrics vs. ground truth
- Concurrent request handling not stressed tested
- No API rate limit monitoring

---

## Document Versions

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-04 | Initial investigation complete |
