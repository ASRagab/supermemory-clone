# Console.log Replacement Analysis

## Executive Summary

Total console statements found: **82** (excluding logger.ts implementation)

## Files by Priority

### HIGH RISK (PII/Security Concerns) - 9 statements
1. `src/services/auth.service.ts` - 5 statements
   - Risk: Authentication tokens, API keys
   - Strategy: Use logger.error() with redacted context (log IDs only, never tokens)

2. `src/api/middleware/auth.ts` - 2 statements
   - Risk: Auth headers, user credentials
   - Strategy: Log user IDs and auth status, never credentials

3. `src/services/csrf.service.ts` - 2 statements
   - Risk: CSRF tokens
   - Strategy: Log validation results, never tokens

### MEDIUM RISK (Service/API Operations) - 53 statements
4. `src/mcp/index.ts` - 16 statements
   - Category: MCP server operations
   - Strategy: Structured logging with request context

5. `src/queues/index.ts` - 10 statements
   - Category: Job queue operations
   - Strategy: Log job IDs, types, and status

6. `src/api/middleware/rateLimit.ts` - 8 statements
   - Category: Rate limiting
   - Strategy: Log containerTag and limit status

7. `src/services/persistence/index.ts` - 4 statements
   - Category: Data persistence
   - Strategy: Log operation status and counts

8. `src/sdk/http.ts` - 4 statements
   - Category: HTTP client
   - Strategy: Log request metadata (method, path, status)

9. `src/services/relationships/index.ts` - 3 statements
   - Category: Relationship detection
   - Strategy: Log detection results and counts

10. `src/services/embedding.service.ts` - 3 statements
    - Category: Embedding generation
    - Strategy: Log operation status, use debug level

11. `src/sdk/client.ts` - 3 statements
    - Category: SDK client
    - Strategy: Log API calls at debug level

12. `src/api/index.ts` - 3 statements
    - Category: API server
    - Strategy: Log server status and errors

13. `src/api/middleware/csrf.ts` - 2 statements
    - Category: CSRF protection
    - Strategy: Log validation status

14. `src/services/relationships/memory-integration.ts` - 2 statements
    - Category: Memory integration
    - Strategy: Log integration status

### LOW RISK (Configuration/Utilities) - 20 statements
15. `src/config/index.ts` - 2 statements
    - Category: Config validation
    - Strategy: Use logger.warn() for validation issues

16. `src/queues/config.ts` - 2 statements
    - Category: Queue configuration
    - Strategy: Log config status

17. `src/db/postgres.ts` - 2 statements
    - Category: Database connection
    - Strategy: Log connection status

18. `src/index.ts` - 2 statements
    - Category: Application startup
    - Strategy: Log startup events

19. `src/db/index.ts` - 1 statement
    - Category: Database initialization
    - Strategy: Log init status

20. `src/services/vectorstore/migration.ts` - 2 statements
    - Category: Migration operations
    - Strategy: Log migration progress

21. `src/services/vectorstore/base.ts` - 1 statement
    - Category: Vector store base
    - Strategy: Log operations at debug level

22. `src/services/extractors/pdf.extractor.ts` - 1 statement
    - Category: PDF extraction
    - Strategy: Log extraction status

23. `src/services/extractors/markdown.extractor.ts` - 1 statement
    - Category: Markdown extraction
    - Strategy: Log extraction status

24. `src/api/middleware/errorHandler.ts` - 1 statement
    - Category: Error handling
    - Strategy: Use logger.error() with error context

### EXCLUDED (Logger Implementation) - 4 statements
25. `src/utils/logger.ts` - 4 statements (lines 129-139)
    - Category: Logger implementation
    - Strategy: **DO NOT CHANGE** - Logger needs console for output

## Replacement Patterns

### High-Risk Pattern (PII Redaction)
```typescript
// BEFORE
console.log('User authenticated:', user);
console.error('API key:', apiKey);

// AFTER
import { getLogger } from '../utils/logger';
const logger = getLogger('auth-service');

logger.info('User authenticated', { userId: user.id });
logger.error('API key validation failed', { keyId: apiKey.id }); // Never log the key itself
```

### Medium-Risk Pattern (Service Operations)
```typescript
// BEFORE
console.error('[MCP] Loaded 5 documents');
console.log('Job processing:', job);

// AFTER
import { getLogger } from '../utils/logger';
const logger = getLogger('mcp-server');

logger.info('Documents loaded', { count: 5 });
logger.info('Job processing', { jobId: job.id, type: job.type });
```

### Low-Risk Pattern (Configuration/Utilities)
```typescript
// BEFORE
console.error('Config validation failed:', issue);
console.warn('Using default value');

// AFTER
import { getLogger } from '../utils/logger';
const logger = getLogger('config');

logger.warn('Config validation failed', { path: issue.path, message: issue.message });
logger.debug('Using default value', { key: 'timeout', value: 30000 });
```

## PII Protection Guidelines

### NEVER LOG:
- Full user objects
- Passwords or password hashes
- API keys (plaintext)
- Authentication tokens
- CSRF tokens
- Email addresses (log userId instead)
- Full names (log userId instead)
- Credit card numbers
- Social security numbers
- Any other personally identifiable information

### SAFE TO LOG:
- User IDs (UUID/nanoid)
- Memory IDs
- Document IDs
- API key IDs (not the key itself)
- Operation status (success/failure)
- Counts and statistics
- Timestamps
- Non-sensitive metadata

## Log Level Guidelines

- **logger.debug()**: Verbose development logs, low-level operations
- **logger.info()**: Normal operations, successful actions
- **logger.warn()**: Warnings, degraded functionality, fallbacks
- **logger.error()**: Errors, failures, exceptions

## Next Steps

1. Replace high-risk files first (auth, CSRF)
2. Replace medium-risk files (services, API, MCP)
3. Replace low-risk files (config, utilities)
4. Verify no console.log remains (except logger.ts)
5. Run test suite
6. Document changes
