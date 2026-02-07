# BullMQ Test Failures - Exact Code Changes Required

**File to Modify:** `tests/queues/bullmq.test.ts`
**Number of Changes:** 2 lines
**Estimated Time:** 2 minutes

---

## Change #1: Line 223

### Location
File: `tests/queues/bullmq.test.ts`
Test: "should throw error when moving non-existent job"
Describe Block: "Dead Letter Queue"

### Current Code (WRONG)

```typescript
    it('should throw error when moving non-existent job', async () => {
      await expect(
        moveToDeadLetterQueue(QueueName.EXTRACTION, 'non-existent-id', 'Test failure'),
      ).rejects.toThrow('Job non-existent-id not found');  // ← LINE 223
    });
```

### Fixed Code (CORRECT)

```typescript
    it('should throw error when moving non-existent job', async () => {
      await expect(
        moveToDeadLetterQueue(QueueName.EXTRACTION, 'non-existent-id', 'Test failure'),
      ).rejects.toThrow("Job with ID 'non-existent-id' not found");  // ← LINE 223 (FIXED)
    });
```

### What Changed
```diff
- ).rejects.toThrow('Job non-existent-id not found');
+ ).rejects.toThrow("Job with ID 'non-existent-id' not found");
```

### Explanation
The actual error message thrown includes:
- The phrase "with ID"
- Single quotes around the job ID
- Format: `"Job with ID 'jobId' not found"`

---

## Change #2: Line 270

### Location
File: `tests/queues/bullmq.test.ts`
Test: "should throw error when updating progress of non-existent job"
Describe Block: "Job Progress Tracking"

### Current Code (WRONG)

```typescript
    it('should throw error when updating progress of non-existent job', async () => {
      await expect(
        updateJobProgress(QueueName.EXTRACTION, 'non-existent', { percentage: 50 }),
      ).rejects.toThrow('Job non-existent not found');  // ← LINE 270
    });
```

### Fixed Code (CORRECT)

```typescript
    it('should throw error when updating progress of non-existent job', async () => {
      await expect(
        updateJobProgress(QueueName.EXTRACTION, 'non-existent', { percentage: 50 }),
      ).rejects.toThrow("Job with ID 'non-existent' not found");  // ← LINE 270 (FIXED)
    });
```

### What Changed
```diff
- ).rejects.toThrow('Job non-existent not found');
+ ).rejects.toThrow("Job with ID 'non-existent' not found");
```

### Explanation
The actual error message thrown includes:
- The phrase "with ID"
- Single quotes around the job ID
- Format: `"Job with ID 'jobId' not found"`

---

## Full File Context: Change #1

### Before (Lines 220-224)

```typescript
    it('should throw error when moving non-existent job', async () => {
      await expect(
        moveToDeadLetterQueue(QueueName.EXTRACTION, 'non-existent-id', 'Test failure'),
      ).rejects.toThrow('Job non-existent-id not found');
    });
```

### After (Lines 220-224)

```typescript
    it('should throw error when moving non-existent job', async () => {
      await expect(
        moveToDeadLetterQueue(QueueName.EXTRACTION, 'non-existent-id', 'Test failure'),
      ).rejects.toThrow("Job with ID 'non-existent-id' not found");
    });
```

---

## Full File Context: Change #2

### Before (Lines 267-271)

```typescript
    it('should throw error when updating progress of non-existent job', async () => {
      await expect(
        updateJobProgress(QueueName.EXTRACTION, 'non-existent', { percentage: 50 }),
      ).rejects.toThrow('Job non-existent not found');
    });
```

### After (Lines 267-271)

```typescript
    it('should throw error when updating progress of non-existent job', async () => {
      await expect(
        updateJobProgress(QueueName.EXTRACTION, 'non-existent', { percentage: 50 }),
      ).rejects.toThrow("Job with ID 'non-existent' not found");
    });
```

---

## Unified Diff Format

```diff
--- a/tests/queues/bullmq.test.ts
+++ b/tests/queues/bullmq.test.ts
@@ -220,7 +220,7 @@
     it('should throw error when moving non-existent job', async () => {
       await expect(
         moveToDeadLetterQueue(QueueName.EXTRACTION, 'non-existent-id', 'Test failure'),
-      ).rejects.toThrow('Job non-existent-id not found');
+      ).rejects.toThrow("Job with ID 'non-existent-id' not found");
     });
   });

@@ -267,7 +267,7 @@
     it('should throw error when updating progress of non-existent job', async () => {
       await expect(
         updateJobProgress(QueueName.EXTRACTION, 'non-existent', { percentage: 50 }),
-      ).rejects.toThrow('Job non-existent not found');
+      ).rejects.toThrow("Job with ID 'non-existent' not found");
     });
   });

```

---

## Copy-Paste Ready Fixes

### Fix #1 (Copy the entire line)

```typescript
      ).rejects.toThrow("Job with ID 'non-existent-id' not found");
```

### Fix #2 (Copy the entire line)

```typescript
      ).rejects.toThrow("Job with ID 'non-existent' not found");
```

---

## Verification Steps

### Step 1: Apply Changes
Edit `tests/queues/bullmq.test.ts` and make the two changes above.

### Step 2: Save File
Ensure the file is saved.

### Step 3: Run Tests
```bash
npm test -- tests/queues/bullmq.test.ts --run
```

### Step 4: Expected Output
```
 ✓ tests/queues/bullmq.test.ts > BullMQ Queue System > Dead Letter Queue > should throw error when moving non-existent job
 ✓ tests/queues/bullmq.test.ts > BullMQ Queue System > Job Progress Tracking > should throw error when updating progress of non-existent job

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

Test Files  1 passed (1)
     Tests  25 passed (25)
```

---

## String Comparison (for clarity)

### Change #1

**What we had:**
```
'Job non-existent-id not found'
 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

**What we need:**
```
"Job with ID 'non-existent-id' not found"
 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

**Character breakdown:**
```
OLD: Job [space] non-existent-id [space] not [space] found
NEW: Job [space] with [space] ID [space] 'non-existent-id' [space] not [space] found
     ^^^                    ^^^^^^                ^^           (additions)
```

### Change #2

**What we had:**
```
'Job non-existent not found'
 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

**What we need:**
```
"Job with ID 'non-existent' not found"
 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

**Character breakdown:**
```
OLD: Job [space] non-existent [space] not [space] found
NEW: Job [space] with [space] ID [space] 'non-existent' [space] not [space] found
     ^^^                    ^^^^^^                ^^           (additions)
```

---

## Important Notes

### Quote Style
Both changes switch from single quotes `'...'` to double quotes `"..."` because the message contains single quotes. This is standard practice:

```typescript
// Don't do this (quote nesting issues):
'Job with ID 'non-existent' not found'
               ^ quote conflict

// Do this instead (use double quotes):
"Job with ID 'non-existent' not found"
// or escape single quotes:
'Job with ID \'non-existent\' not found'
```

### Template Literals
You could also use template literals:
```typescript
).rejects.toThrow(`Job with ID 'non-existent-id' not found`);
).rejects.toThrow(`Job with ID 'non-existent' not found`);
```

---

## Validation Checklist

Before and after applying changes:

### Before Fix
- [ ] Test suite shows 2 failures: "should throw error when moving non-existent job"
- [ ] Test suite shows 2 failures: "should throw error when updating progress of non-existent job"
- [ ] All other 23 tests passing

### After Fix
- [ ] Both previously failing tests now passing
- [ ] All 25 tests passing
- [ ] No new test failures introduced
- [ ] Test execution time still under 1 second

---

## Common Issues and Solutions

### Issue: "Expected X but got Y" still appears after fix

**Solution:** Verify you copied the exact string including:
- Double quotes around the message
- The phrase "with ID"
- Single quotes around the ID
- Correct job ID in each test

### Issue: Syntax error after change

**Solution:** Ensure:
- Parenthesis and semicolon are intact
- Quote pairs are balanced
- No extra spaces or characters

### Issue: Different error message still appears

**Solution:** This would mean the error message format changed elsewhere. Check:
- `src/utils/errors.ts` - NotFoundError class
- `src/queues/index.ts` - Where errors are thrown

---

## Quick Verification Command

After making changes, run:

```bash
npm test -- tests/queues/bullmq.test.ts --run 2>&1 | grep -E "(✓|×|passed|failed)"
```

Expected output:
```
 ✓ tests/queues/bullmq.test.ts
Test Files  1 passed (1)
     Tests  25 passed (25)
```

---

## Summary

**Total Changes:** 2 single-line modifications
**File Modified:** 1 (tests/queues/bullmq.test.ts)
**Risk Level:** None (test changes only)
**Expected Result:** 100% test pass rate
**Time to Complete:** Under 5 minutes

The changes are minimal, safe, and directly resolve the failing tests.
