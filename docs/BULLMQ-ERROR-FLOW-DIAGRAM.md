# BullMQ Test Failure - Error Flow Diagram

## Error Generation Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TEST EXECUTION STARTS                             │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Test: "should throw error when moving non-existent job"                    │
│ Location: tests/queues/bullmq.test.ts:220-224                             │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Function Call:                                                              │
│ moveToDeadLetterQueue(QueueName.EXTRACTION, 'non-existent-id', 'Test...')  │
│                                                                             │
│ File: src/queues/index.ts:220-230                                         │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Queue Operation:                                                            │
│ const job = await sourceQueue.getJob('non-existent-id')                   │
│                                                                             │
│ Result: job = null (Job not found in Redis)                               │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Condition Check: if (!job) → TRUE                                          │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Error Thrown:                                                               │
│ throw new NotFoundError('Job', 'non-existent-id', ErrorCode.NOT_FOUND)    │
│                                                                             │
│ File: src/utils/errors.ts:219-231                                         │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ NotFoundError Constructor (lines 224-226):                                 │
│                                                                             │
│ const message = resourceId                                                 │
│   ? `${resourceType} with ID '${resourceId}' not found`                   │
│   : `${resourceType} not found`;                                           │
│                                                                             │
│ With values:                                                                │
│   resourceType = 'Job'                                                      │
│   resourceId = 'non-existent-id'                                          │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ MESSAGE GENERATION:                                                         │
│                                                                             │
│ `Job with ID 'non-existent-id' not found`                                │
│                                                                             │
│ ^^^ ACTUAL ERROR MESSAGE ^^^                                               │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ AppError Constructor (super call):                                         │
│                                                                             │
│ - Sets this.message = "Job with ID 'non-existent-id' not found"          │
│ - Sets this.code = ErrorCode.NOT_FOUND                                   │
│ - Sets this.statusCode = 404                                              │
│ - Sets this.name = 'NotFoundError'                                        │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Error is thrown and caught by test expectation:                            │
│                                                                             │
│ await expect(                                                               │
│   moveToDeadLetterQueue(...)                                              │
│ ).rejects.toThrow('Job non-existent-id not found')                        │
│                                                                             │
│ ^^^ TEST EXPECTATION ^^^                                                   │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ MESSAGE COMPARISON:                                                         │
│                                                                             │
│ Expected: "Job non-existent-id not found"                                 │
│ Actual:   "Job with ID 'non-existent-id' not found"                       │
│                                                                             │
│ Match: NO ✗                                                                │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ TEST FAILS ✗                                                                │
│                                                                             │
│ AssertionError: expected [Function] to throw error including               │
│ 'Job non-existent-id not found' but got                                   │
│ 'Job with ID 'non-existent-id' not found'                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Side-by-Side Comparison

```
┌────────────────────────────────────────────────────────────────────────┐
│                    ERROR MESSAGE FORMAT MISMATCH                        │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  EXPECTED (Test)         ACTUAL (Implementation)                      │
│  ────────────────       ───────────────────────                       │
│  Job non-existent-id    Job with ID 'non-existent-id'               │
│  not found              not found                                     │
│                                                                        │
│  Simple format          Descriptive format                            │
│  No extra words         Includes "with ID" and quotes                │
│  Less clear             More explicit about what's missing           │
│                                                                        │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  SAME: 'non-existent-id'  ✓                                          │
│  SAME: "not found"        ✓                                          │
│  DIFFERENT: Surrounding format  ✗                                    │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## NotFoundError Constructor Logic

```
┌─────────────────────────────────────────────────────┐
│  NotFoundError Constructor (src/utils/errors.ts)   │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│  constructor(                                       │
│    resourceType: string,    // 'Job'               │
│    resourceId?: string,     // 'non-existent-id'   │
│    code: ErrorCodeType      // ErrorCode.NOT_FOUND │
│  )                                                  │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│  if (resourceId) ? TRUE : FALSE                    │
│                                                     │
│  In our case: resourceId = 'non-existent-id'      │
│  Therefore: TRUE (use with ID format)             │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────┐
│  Message Template (with ID version):                │
│                                                      │
│  `${resourceType} with ID '${resourceId}'           │
│   not found`                                        │
│                                                      │
│  Substituting:                                      │
│  resourceType = 'Job'                              │
│  resourceId = 'non-existent-id'                    │
│                                                      │
│  Result:                                            │
│  "Job with ID 'non-existent-id' not found"        │
└──────────────────────────────────────────────────────┘
```

---

## Test Assertion Comparison

```
┌────────────────────────────────────────────────────────────────────┐
│                  FAILURE #1: Line 223                              │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Test Code:                                                        │
│  ──────────                                                        │
│  await expect(                                                    │
│    moveToDeadLetterQueue(                                         │
│      QueueName.EXTRACTION,                                        │
│      'non-existent-id',                                          │
│      'Test failure'                                              │
│    )                                                              │
│  ).rejects.toThrow('Job non-existent-id not found');            │
│                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^             │
│                       EXPECTED STRING                              │
│                                                                    │
│  Execution Result:                                                 │
│  ─────────────────                                                │
│  throw new NotFoundError('Job', 'non-existent-id', ...)         │
│                                                                    │
│  Message Created:                                                  │
│  ─────────────────                                                │
│  "Job with ID 'non-existent-id' not found"                      │
│   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^                       │
│   ACTUAL STRING THROWN                                             │
│                                                                    │
│  Comparison:                                                       │
│  ───────────                                                       │
│  Expected ≠ Actual  ✗ FAIL                                       │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘


┌────────────────────────────────────────────────────────────────────┐
│                  FAILURE #2: Line 270                              │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Test Code:                                                        │
│  ──────────                                                        │
│  await expect(                                                    │
│    updateJobProgress(                                             │
│      QueueName.EXTRACTION,                                        │
│      'non-existent',                                             │
│      { percentage: 50 }                                          │
│    )                                                              │
│  ).rejects.toThrow('Job non-existent not found');               │
│                       ^^^^^^^^^^^^^^^^^^^^^^^                      │
│                       EXPECTED STRING                              │
│                                                                    │
│  Execution Result:                                                 │
│  ─────────────────                                                │
│  throw new NotFoundError('Job', 'non-existent', ...)            │
│                                                                    │
│  Message Created:                                                  │
│  ─────────────────                                                │
│  "Job with ID 'non-existent' not found"                         │
│   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^                           │
│   ACTUAL STRING THROWN                                             │
│                                                                    │
│  Comparison:                                                       │
│  ───────────                                                       │
│  Expected ≠ Actual  ✗ FAIL                                       │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## Error Chain Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                     ERROR CHAIN SUMMARY                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Test calls moveToDeadLetterQueue('non-existent-id')       │
│                    ↓                                             │
│  2. Function looks up job in Redis                             │
│                    ↓                                             │
│  3. Job returns null                                           │
│                    ↓                                             │
│  4. Error condition triggered: if (!job)                       │
│                    ↓                                             │
│  5. NotFoundError instantiated:                                │
│     new NotFoundError('Job', 'non-existent-id', NOT_FOUND)   │
│                    ↓                                             │
│  6. Constructor formats message:                               │
│     "Job with ID 'non-existent-id' not found"                │
│                    ↓                                             │
│  7. AppError base class receives message                       │
│                    ↓                                             │
│  8. Error thrown with formatted message                        │
│                    ↓                                             │
│  9. Test expects: "Job non-existent-id not found"            │
│                    ↓                                             │
│  10. Test compares expected vs actual                          │
│       Expected: "Job non-existent-id not found"              │
│       Actual:   "Job with ID 'non-existent-id' not found"    │
│                    ↓                                             │
│  11. Strings don't match → TEST FAILS ✗                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Fix Application Visual

```
┌──────────────────────────────────────────────────────────────────┐
│                   BEFORE FIX (FAILING)                           │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ tests/queues/bullmq.test.ts:223                                │
│ ───────────────────────────────────────────────────────        │
│ .rejects.toThrow('Job non-existent-id not found')             │
│           ^^^^^^^^                                              │
│           ✗ WRONG - doesn't match actual message               │
│                                                                  │
│ tests/queues/bullmq.test.ts:270                                │
│ ───────────────────────────────────────────────────────        │
│ .rejects.toThrow('Job non-existent not found')                │
│           ^^^^^^^^                                              │
│           ✗ WRONG - doesn't match actual message               │
│                                                                  │
│ Result: 2 tests FAILING ✗                                      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                             │
                             │ APPLY FIX
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                   AFTER FIX (PASSING)                            │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ tests/queues/bullmq.test.ts:223                                │
│ ───────────────────────────────────────────────────────        │
│ .rejects.toThrow("Job with ID 'non-existent-id' not found")  │
│           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^                │
│           ✓ CORRECT - matches actual message exactly            │
│                                                                  │
│ tests/queues/bullmq.test.ts:270                                │
│ ───────────────────────────────────────────────────────        │
│ .rejects.toThrow("Job with ID 'non-existent' not found")     │
│           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^                     │
│           ✓ CORRECT - matches actual message exactly            │
│                                                                  │
│ Result: 25 tests PASSING ✓                                     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Code Path Visualization

```
                    moveToDeadLetterQueue
                            │
                            ▼
                   src/queues/index.ts:225
                   const sourceQueue = getQueue(name)
                            │
                            ▼
                   src/queues/index.ts:226
                   const job = await getJob(jobId)
                            │
                      ┌─────┴─────┐
                      │           │
                   Found      Not Found
                      │           │
                      │           ▼
                      │    if (!job) → TRUE
                      │           │
                      │           ▼
                      │    throw new NotFoundError
                      │    'Job', jobId, NOT_FOUND
                      │           │
                      │           ▼
                      │    src/utils/errors.ts:224-226
                      │    NotFoundError constructor
                      │    formats message:
                      │    "Job with ID '{id}' not found"
                      │           │
                      └─────┬─────┘
                            │
                            ▼
                    Error thrown to test
                            │
                            ▼
            Test assertion checks message
                            │
                      ┌─────┴──────┐
                      │            │
                   Match       No Match
                      │            │
                      ▼            ▼
                   PASS         FAIL
                      ✓            ✗
```

---

## Key Takeaway

The error message format follows this pattern in the codebase:

```
PATTERN USED BY NotFoundError:
"${resourceType} with ID '${resourceId}' not found"

EXAMPLE MESSAGES:
- "Job with ID 'job-123' not found"
- "User with ID 'user-456' not found"
- "Profile with ID 'profile-789' not found"
- "Memory with ID 'memory-000' not found"
```

The tests should use this exact format when checking for NotFoundError messages.
