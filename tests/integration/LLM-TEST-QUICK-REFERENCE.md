# LLM Integration Tests - Quick Reference

## 🚀 Quick Start

```bash
# Set API keys (optional - tests skip if not set)
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."

# Run all tests
npm test tests/integration/llm-integration.test.ts
```

---

## 📊 Test Summary

| Category | Tests | Duration | Cost |
|----------|-------|----------|------|
| OpenAI Provider | 9 | ~20s | $0.0009 |
| Anthropic Provider | 5 | ~15s | $0.0009 |
| Memory Classifier | 5 | ~10s | $0.0003 |
| Contradiction Detector | 5 | ~12s | $0.0003 |
| Extension Detector | 4 | ~8s | $0.0002 |
| Error Handling | 4 | ~5s | $0.0000 |
| **Total** | **30** | **~70s** | **$0.0018** |

---

## 🎯 Run Specific Tests

```bash
# OpenAI only
npm test tests/integration/llm-integration.test.ts -t "OpenAI"

# Anthropic only
npm test tests/integration/llm-integration.test.ts -t "Anthropic"

# Memory Classifier only
npm test tests/integration/llm-integration.test.ts -t "Memory Classifier"

# Contradiction Detector only
npm test tests/integration/llm-integration.test.ts -t "Contradiction Detector"

# Extension Detector only
npm test tests/integration/llm-integration.test.ts -t "Extension Detector"

# Error handling only
npm test tests/integration/llm-integration.test.ts -t "Error Handling"
```

---

## 💰 Cost Breakdown

### Per Test Run
- **OpenAI (gpt-4o-mini)**: ~15 calls × $0.00006 = $0.0009
- **Anthropic (claude-haiku)**: ~8 calls × $0.00011 = $0.0009
- **Total**: $0.0018 per full test run

### Monthly Projections
- **1 run/day**: $0.054/month
- **5 runs/day**: $0.27/month
- **20 runs/day**: $1.08/month

---

## ✅ Expected Results (With API Keys)

```
✓ OpenAI Provider Integration (9 tests) - 20s
  ✓ should be available when API key is set
  ✓ should successfully classify memory type with real LLM
  ✓ should detect contradictions with real LLM
  ✓ should detect memory extensions with real LLM
  ✓ should handle invalid API key gracefully
  ✓ should handle malformed JSON responses
  ✓ should handle concurrent requests without race conditions
  ✓ should respect timeout configuration
  ✓ should use caching effectively

✓ Anthropic Provider Integration (5 tests) - 15s
  ✓ should be available when API key is set
  ✓ should successfully classify memory type with real LLM
  ✓ should detect contradictions with real LLM
  ✓ should handle invalid API key gracefully
  ✓ should handle concurrent requests

✓ Memory Classifier Service Integration (5 tests) - 10s
  ✓ should classify fact with real LLM
  ✓ should classify event with real LLM
  ✓ should classify preference with real LLM
  ✓ should use cache for repeated classifications
  ✓ should fallback to patterns when LLM unavailable

✓ Contradiction Detector Service Integration (5 tests) - 12s
  ✓ should detect true contradiction with real LLM
  ✓ should detect compatible statements (no contradiction)
  ✓ should detect update that supersedes
  ✓ should skip check for low overlap
  ✓ should fallback to heuristics when LLM fails

✓ Memory Extension Detector Service Integration (4 tests) - 8s
  ✓ should detect true extension with real LLM
  ✓ should detect non-extension (different topics)
  ✓ should detect substring (not extension)
  ✓ should fallback to heuristics when LLM unavailable

✓ LLM Error Handling (4 tests) - 5s
✓ Performance Metrics (1 test)

📊 LLM Integration Test Statistics:
   Total Tests: 30
   OpenAI Tests: 15
   Anthropic Tests: 8
   Mock Tests: 7
   Total API Calls: 23
   Total Tokens: 3,450
   Estimated Cost: $0.0026
```

---

## ⚠️ Without API Keys

```
⏭️  Skipping OpenAI tests - OPENAI_API_KEY not set
⏭️  Skipping Anthropic tests - ANTHROPIC_API_KEY not set

✓ Memory Classifier Service Integration (1 test)
  ✓ should fallback to patterns when LLM unavailable

✓ Contradiction Detector Service Integration (2 tests)
  ✓ should skip check for low overlap
  ✓ should fallback to heuristics when LLM fails

✓ Memory Extension Detector Service Integration (2 tests)
  ✓ should detect substring (not extension)
  ✓ should fallback to heuristics when LLM unavailable

📊 LLM Integration Test Statistics:
   Total Tests: 5
   OpenAI Tests: 0
   Anthropic Tests: 0
   Mock Tests: 5
   Total API Calls: 0
   Total Tokens: 0
   Estimated Cost: $0.0000
```

---

## 🔧 Troubleshooting

### Tests Timing Out

```bash
# Increase timeout
npm test -- --testTimeout=60000
```

### Rate Limit Errors

```bash
# Run fewer tests
npm test tests/integration/llm-integration.test.ts -t "Memory Classifier"

# Or add delay between tests
npm test -- --maxWorkers=1
```

### API Key Errors

```bash
# Verify API keys
echo $OPENAI_API_KEY
echo $ANTHROPIC_API_KEY

# Check account status
# OpenAI: https://platform.openai.com/account/usage
# Anthropic: https://console.anthropic.com/
```

### Debugging

```bash
# Enable debug logging
LOG_LEVEL=debug npm test tests/integration/llm-integration.test.ts
```

---

## 📁 Related Files

- **Test File**: `tests/integration/llm-integration.test.ts`
- **Full Report**: `docs/LLM-INTEGRATION-TEST-REPORT.md`
- **Implementation Summary**: `docs/LLM-INTEGRATION-IMPLEMENTATION-SUMMARY.md`
- **Source Files**:
  - `src/services/llm/openai.ts`
  - `src/services/llm/anthropic.ts`
  - `src/services/llm/memory-classifier.service.ts`
  - `src/services/llm/contradiction-detector.service.ts`
  - `src/services/llm/memory-extension-detector.service.ts`

---

## 🎓 Test Coverage

### What Is Tested

✅ Real API integration (OpenAI, Anthropic)
✅ JSON response parsing
✅ Error handling (auth, timeout, rate limit)
✅ Service integration (Classifier, Contradiction, Extension)
✅ Caching effectiveness
✅ Concurrent request handling
✅ Fallback to pattern matching
✅ Cost tracking and optimization

### What Is NOT Tested

❌ Streaming responses (not implemented)
❌ Batch processing (future enhancement)
❌ Long content (>10,000 chars)
❌ Multi-language content
❌ Provider comparison benchmarks

---

## 🚀 CI/CD Integration

```yaml
# .github/workflows/test.yml
jobs:
  test-llm-integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - name: Run LLM Integration Tests
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: npm test tests/integration/llm-integration.test.ts
```

---

## 📊 Metrics to Track

Monitor these in production:

1. **API Call Count**: <100/day in dev, <1000/day in prod
2. **Token Usage**: <15,000/day
3. **Cost**: <$0.50/day in dev, <$5/day in prod
4. **Cache Hit Rate**: >40%
5. **Error Rate**: <5%
6. **Latency**: <5s per call

---

## 🎯 Success Criteria

✅ All tests pass with valid API keys
✅ Tests skip gracefully without API keys
✅ <$0.002 cost per test run
✅ <70s total execution time
✅ >40% cache hit rate
✅ <5% error rate
✅ No race conditions in concurrent tests

---

## 📖 Documentation

- **Quick Reference**: `tests/integration/LLM-TEST-QUICK-REFERENCE.md` (this file)
- **Full Report**: `docs/LLM-INTEGRATION-TEST-REPORT.md` (detailed documentation)
- **Implementation Summary**: `docs/LLM-INTEGRATION-IMPLEMENTATION-SUMMARY.md` (overview)

---

## 🔄 Next Steps

1. Set up API keys in CI/CD
2. Configure rate limiting
3. Set up cost monitoring
4. Tune cache settings
5. Add more test scenarios

---

**Status**: ✅ Ready for production

**Last Updated**: 2026-02-04
