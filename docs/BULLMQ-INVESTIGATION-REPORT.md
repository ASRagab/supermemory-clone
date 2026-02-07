# BullMQ Queue System - Test Failure Investigation Report

**Investigation Date:** 2026-02-04
**Test File:** `tests/queues/bullmq.test.ts`
**Total Tests:** 25
**Passed:** 23 (92%)
**Failed:** 2 (8%)
**Status:** ✗ FAILURES IDENTIFIED + SOLUTIONS PROVIDED

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Failure Details](#failure-details)
3. [Root Cause Analysis](#root-cause-analysis)
4. [Code Evidence](#code-evidence)
5. [Impact Assessment](#impact-assessment)
6. [Solutions](#solutions)
7. [Recommendations](#recommendations)

---

## Executive Summary

### Test Execution Results

```
 ✓ Tests 23 passed (23)
 ✗ Tests 2 failed (2)

FAIL  Dead Letter Queue > should throw error when moving non-existent job
FAIL  Job Progress Tracking > should throw error when updating progress of non-existent job
```

### Key Finding

Both failures are **error message format mismatches** where the actual error message format (`"Job with ID 'jobId' not found"`) doesn't match the expected format (`"Job jobId not found"`).

### Classification

- **Type:** Test Specification Error
- **Severity:** Low (System Logic is Correct)
- **Scope:** 2 tests in 1 file
- **Fix Complexity:** Trivial (1-line changes)

---

## Failure Details

### Failure #1: Dead Letter Queue Test

**Location:** `tests/queues/bullmq.test.ts:220-224`

**Test Code:**
```typescript
it('should throw error when moving non-existent job', async () => {
  await expect(
    moveToDeadLetterQueue(QueueName.EXTRACTION, 'non-existent-id', 'Test failure'),
  ).rejects.toThrow('Job non-existent-id not found');
});
```

**Error Output:**
```
AssertionError: expected [Function] to throw error including
'Job non-existent-id not found' but got
'Job with ID 'non-existent-id' not found'

Expected: "Job non-existent-id not found"
Received: "Job with ID 'non-existent-id' not found"
```

**Analysis:**
- The `moveToDeadLetterQueue()` function correctly throws an error when the job doesn't exist
- The error type (NotFoundError) is correct
- The error code (NOT_FOUND) is correct
- Only the message format differs from test expectation

---

### Failure #2: Job Progress Tracking Test

**Location:** `tests/queues/bullmq.test.ts:267-271`

**Test Code:**
```typescript
it('should throw error when updating progress of non-existent job', async () => {
  await expect(
    updateJobProgress(QueueName.EXTRACTION, 'non-existent', { percentage: 50 }),
  ).rejects.toThrow('Job non-existent not found');
});
```

**Error Output:**
```
AssertionError: expected [Function] to throw error including
'Job non-existent not found' but got
'Job with ID 'non-existent' not found'

Expected: "Job non-existent not found"
Received: "Job with ID 'non-existent' not found"
```

**Analysis:**
- The `updateJobProgress()` function correctly throws an error when the job doesn't exist
- The error type (NotFoundError) is correct
- The error code (NOT_FOUND) is correct
- Only the message format differs from test expectation

---

## Root Cause Analysis

### Execution Flow

```
Queue Service Called (queues/index.ts)
  ↓
Job Lookup: queue.getJob(jobId)
  ↓
Job Not Found
  ↓
throw new NotFoundError('Job', jobId, ErrorCode.NOT_FOUND)
  ↓
NotFoundError Constructor (utils/errors.ts:224-226)
  ↓
Message Generated: "Job with ID 'jobId' not found"
  ↓
Test Expectation Check
  ✗ Expected: "Job jobId not found"
  ✗ Got: "Job with ID 'jobId' not found"
```

### Source Code Analysis

**File 1: `src/queues/index.ts`**

Lines 220-230 (moveToDeadLetterQueue):
```typescript
export async function moveToDeadLetterQueue(
  queueName: QueueName,
  jobId: string,
  reason: string,
): Promise<string> {
  const sourceQueue = getQueue(queueName);
  const job = await sourceQueue.getJob(jobId);

  if (!job) {
    throw new NotFoundError('Job', jobId, ErrorCode.NOT_FOUND);
    // ↑ Throws: "Job with ID 'non-existent-id' not found"
  }
  // ... rest of function
}
```

Lines 258-271 (updateJobProgress):
```typescript
export async function updateJobProgress(
  queueName: QueueName,
  jobId: string,
  progress: JobProgress,
): Promise<void> {
  const queue = getQueue(queueName);
  const job = await queue.getJob(jobId);

  if (!job) {
    throw new NotFoundError('Job', jobId, ErrorCode.NOT_FOUND);
    // ↑ Throws: "Job with ID 'non-existent' not found"
  }
  // ... rest of function
}
```

**File 2: `src/utils/errors.ts`**

Lines 215-231 (NotFoundError class):
```typescript
export class NotFoundError extends AppError {
  readonly resourceType: string;
  readonly resourceId?: string;

  constructor(
    resourceType: string,
    resourceId?: string,
    code: ErrorCodeType = ErrorCode.NOT_FOUND
  ) {
    const message = resourceId
      ? `${resourceType} with ID '${resourceId}' not found`
      // ↑ MESSAGE FORMAT: "Job with ID 'jobId' not found"
      : `${resourceType} not found`;
    super(message, code);
    this.name = 'NotFoundError';
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }
}
```

### The Issue

The NotFoundError constructor creates messages with this format:
```
[resourceType] with ID '[resourceId]' not found
```

So when called as `new NotFoundError('Job', 'non-existent-id', ErrorCode.NOT_FOUND)`, it produces:
```
"Job with ID 'non-existent-id' not found"
```

But the tests expect the simple format:
```
"Job non-existent-id not found"
```

---

## Code Evidence

### Test Expectations (What Was Expected)

```typescript
// Test 1: Line 223
.rejects.toThrow('Job non-existent-id not found');

// Test 2: Line 270
.rejects.toThrow('Job non-existent not found');
```

### Actual Implementation (What Actually Happens)

```typescript
// From NotFoundError constructor
const message = resourceId
  ? `${resourceType} with ID '${resourceId}' not found`
  : `${resourceType} not found`;

// Which produces for our cases:
// Case 1: new NotFoundError('Job', 'non-existent-id', ...)
//         → "Job with ID 'non-existent-id' not found"

// Case 2: new NotFoundError('Job', 'non-existent', ...)
//         → "Job with ID 'non-existent' not found"
```

### Why This Format Was Chosen

The "with ID" format in NotFoundError is used consistently throughout the codebase for clarity:
- It explicitly shows when an ID is provided
- It maintains consistency with formatted error messages elsewhere
- It's more descriptive and user-friendly

---

## Impact Assessment

### What's Working Correctly

✓ **Queue Creation** - All 4 processing queues created successfully
✓ **Job Operations** - Jobs can be added, retrieved, and processed
✓ **Error Detection** - System correctly identifies missing jobs
✓ **Error Types** - NotFoundError properly thrown with correct code
✓ **Redis Integration** - Connection health checks pass, all operations work
✓ **Queue Metrics** - Metrics collection works properly
✓ **Job Priority** - Priority system functions correctly
✓ **Dead Letter Queue** - DLQ operations work (except error message format)
✓ **Job Progress** - Progress tracking works (except error message format)

### What Needs Fixing

✗ **Test Assertions** - 2 test assertions expect wrong error message format

### Risk Assessment

| Aspect | Assessment | Risk |
|--------|-----------|------|
| System Logic | Correct | None |
| Runtime Behavior | Correct | None |
| Error Handling | Correct | None |
| Job Processing | Correct | None |
| Data Integrity | Correct | None |
| Test Accuracy | Incorrect | Low - cosmetic only |

---

## Solutions

### Solution 1: Update Test Expectations (Recommended)

**Why Recommended:**
- Minimal change (2 lines)
- No side effects on other code
- Aligns tests with actual implementation
- NotFoundError format is consistent across codebase

**Implementation:**

File: `tests/queues/bullmq.test.ts`

**Change 1 - Line 223:**
```typescript
// BEFORE
).rejects.toThrow('Job non-existent-id not found');

// AFTER
).rejects.toThrow("Job with ID 'non-existent-id' not found");
```

**Change 2 - Line 270:**
```typescript
// BEFORE
).rejects.toThrow('Job non-existent not found');

// AFTER
).rejects.toThrow("Job with ID 'non-existent' not found");
```

**Verification:**
```bash
npm test -- tests/queues/bullmq.test.ts --run
# Expected: Tests  25 passed (25)
```

**Impact:** None on other code

---

### Solution 2: Change Error Message Format

**Why Not Recommended:**
- Affects all NotFoundError usage across codebase
- Would require updating multiple test files
- NotFoundError is used in auth, profile, memory services
- Current format is more descriptive

**Would Affect:**
- `tests/services/auth.service.test.ts`
- `tests/services/profile.service.test.ts`
- `tests/services/search.service.test.ts`
- Any other code throwing NotFoundError

**Implementation Would Be:**

File: `src/utils/errors.ts` (lines 224-226)

```typescript
// BEFORE
const message = resourceId
  ? `${resourceType} with ID '${resourceId}' not found`
  : `${resourceType} not found`;

// AFTER - Option A (Simple)
const message = resourceId
  ? `${resourceType} ${resourceId} not found`
  : `${resourceType} not found`;

// AFTER - Option B (With Quotes)
const message = resourceId
  ? `${resourceType} '${resourceId}' not found`
  : `${resourceType} not found`;
```

**Impact:** Would require updating error messages in multiple test files across the entire test suite

---

### Solution 3: Use Regex Pattern Matching

**Why Less Ideal:**
- Tests become less specific about error messages
- Hides potential message format changes
- Reduces test precision

**Implementation Would Be:**

File: `tests/queues/bullmq.test.ts`

```typescript
// Line 221-223: BEFORE
await expect(
  moveToDeadLetterQueue(QueueName.EXTRACTION, 'non-existent-id', 'Test failure'),
).rejects.toThrow('Job non-existent-id not found');

// Line 221-223: AFTER
await expect(
  moveToDeadLetterQueue(QueueName.EXTRACTION, 'non-existent-id', 'Test failure'),
).rejects.toThrow(/Job.*non-existent-id.*not found/);

// Line 268-270: BEFORE
await expect(
  updateJobProgress(QueueName.EXTRACTION, 'non-existent', { percentage: 50 }),
).rejects.toThrow('Job non-existent not found');

// Line 268-270: AFTER
await expect(
  updateJobProgress(QueueName.EXTRACTION, 'non-existent', { percentage: 50 }),
).rejects.toThrow(/Job.*non-existent.*not found/);
```

**Impact:** Tests become less strict but more flexible

---

## Recommendations

### Primary Recommendation

**Implement Solution 1** - Update test expectations to match actual error message format.

**Rationale:**
1. Minimal code changes (2 lines)
2. No side effects on other code
3. Aligns tests with implementation reality
4. NotFoundError format is consistent across codebase
5. Tests become more accurate
6. Fastest fix (under 1 minute)

### Implementation Steps

1. Open `tests/queues/bullmq.test.ts`
2. Go to line 223, update the assertion
3. Go to line 270, update the assertion
4. Save file
5. Run tests: `npm test -- tests/queues/bullmq.test.ts --run`
6. Verify: All 25 tests pass

### Preventive Measures

For future tests expecting NotFoundError messages:
- Always use the format: `"[resourceType] with ID '[id]' not found"`
- Or use regex patterns: `/[resourceType].*[id].*not found/`
- Consider documenting the expected error message format

### Environmental Notes

**Redis Eviction Policy Warning:**
The test output shows:
```
IMPORTANT! Eviction policy is allkeys-lru. It should be "noeviction"
```

While not causing test failures, this should be addressed for production:
- Update `redis.conf` with `maxmemory-policy noeviction`
- Or update docker-compose.yml Redis configuration
- This prevents data loss when Redis reaches memory limit

---

## Summary Table

| Aspect | Status | Details |
|--------|--------|---------|
| **System Logic** | ✓ Working | Queue system functions correctly |
| **Job Operations** | ✓ Working | Add, retrieve, delete operations all work |
| **Error Handling** | ✓ Working | Proper error types and codes used |
| **Redis Connection** | ✓ Healthy | All pings successful, ready for commands |
| **Test Coverage** | ✓ Good | 25 tests, 23 passing, only 2 format issues |
| **Code Quality** | ✓ Good | Well-structured, clear error hierarchy |
| **Critical Issues** | ✗ None | No blocking issues found |
| **Test Accuracy** | ✗ Needs Fix | 2 assertions use wrong expected format |

---

## Conclusion

The BullMQ queue system implementation is **functioning correctly** with proper error handling, queue management, and job lifecycle operations. The 2 failing tests are due to a simple **error message format mismatch** that can be fixed with 2 trivial line changes to the test expectations.

**Estimated Fix Time:** 2 minutes
**Test Suite Health After Fix:** 100% (25/25 passing)
**System Ready For:** Production (with Redis configuration fix)
