# Error Handling Refactoring Plan

## Current State Analysis

The codebase has a well-structured error hierarchy in `/src/utils/errors.ts` with:

### Existing Error Classes
- `AppError` (base class) - HTTP status-aware errors with codes
- `ValidationError` - Input validation with field-level errors
- `NotFoundError` - Missing resources with type and ID
- `AuthenticationError` - Auth failures
- `AuthorizationError` - Permission denials
- `ConflictError` - Duplicates/version conflicts
- `RateLimitError` - Rate limiting
- `DatabaseError` - Database operation failures
- `EmbeddingError` - Embedding service errors
- `ExtractionError` - Content extraction errors
- `ExternalServiceError` - Third-party service failures

### Additional Needs
Based on grep analysis, we need to add:
- `CryptoError` - For encryption/crypto operations
- `ConfigurationError` - For invalid config
- `DependencyError` - For missing dependencies (e.g., pdf-parse)

## Generic Error Instances Found

Total: 60 instances of `throw new Error()`

### Priority Files (High Impact)

1. **src/services/vectorstore/pgvector.ts** (13 instances)
   - Lines 111, 131, 157, 165, 199, 251, 303, 344, 364, 379, 446, 479, 503, 518
   - Pattern: Database not initialized checks
   - Pattern: Duplicate entry checks

2. **src/services/embedding.service.ts** (5 instances)
   - Lines 166, 297, 306, 330, 348
   - Pattern: Empty text validation
   - Pattern: API errors
   - Pattern: Dimension mismatches

3. **src/services/pipeline.service.ts** (3 instances)
   - Lines 222, 348, 463
   - Pattern: Document not found

4. **src/mcp/index.ts** (4 instances)
   - Lines 424, 448, 502, 818
   - Pattern: Missing required fields
   - Pattern: Unknown actions

### Medium Priority Files

5. **src/services/vectorstore/base.ts** (7 instances)
   - Pattern: Vector dimension validation
   - Pattern: Type validation

6. **src/workers/** (4 instances)
   - Pattern: Not found errors
   - Pattern: Uninitialized state

7. **src/services/extractors/** (4 instances)
   - Pattern: HTTP errors
   - Pattern: Missing dependencies

### Low Priority Files

8. **src/config/index.ts** (1 instance)
9. **src/queues/index.ts** (3 instances)
10. **src/sdk/** (4 instances)
11. **src/services/** (remaining 12 instances)

## Migration Strategy

### Phase 1: Add Missing Error Classes
1. Add `CryptoError` to errors.ts
2. Add `ConfigurationError` to errors.ts
3. Add `DependencyError` to errors.ts
4. Add error codes to ErrorCode enum

### Phase 2: High Priority Migrations
1. pgvector.ts - DatabaseError for db operations
2. embedding.service.ts - ValidationError + EmbeddingError + ExternalServiceError
3. pipeline.service.ts - NotFoundError
4. mcp/index.ts - ValidationError

### Phase 3: Medium Priority Migrations
1. vectorstore/base.ts - ValidationError for vector validation
2. workers/* - NotFoundError + DatabaseError
3. extractors/* - ExternalServiceError + DependencyError

### Phase 4: Low Priority Migrations
1. Config, queues, SDK files
2. Remaining service files

### Phase 5: Testing & Validation
1. Update error middleware to handle new error types
2. Create comprehensive test suite
3. Verify all 60 instances replaced
4. Run full test suite

## Error Context Guidelines

Each error should include:
- **code**: From ErrorCode enum
- **message**: Clear, actionable description
- **details**: Relevant context (IDs, values, operations)

Example transformations:
```typescript
// Before
throw new Error('Database not initialized');

// After
throw new DatabaseError('Database not initialized', 'connection', {
  operation: 'query',
  table: this.tableName
});

// Before
throw new Error(`Document not found: ${docId}`);

// After
throw new NotFoundError('Document', docId, ErrorCode.DOCUMENT_NOT_FOUND);

// Before
throw new Error('Text cannot be empty');

// After
throw new ValidationError('Text cannot be empty', {
  text: ['Text is required and cannot be empty']
});
```

## Success Criteria

- [ ] All 60 generic Error instances replaced
- [ ] Missing error classes added
- [ ] Error middleware handles all error types
- [ ] 100% test coverage for error classes
- [ ] Documentation updated
- [ ] All existing tests pass
- [ ] Error messages are clear and actionable
