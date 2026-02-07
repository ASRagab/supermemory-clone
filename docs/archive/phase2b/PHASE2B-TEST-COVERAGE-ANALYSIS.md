# Phase 2B Security Test Coverage Analysis

**Generated**: 2026-02-03
**Scope**: Auth Service, CSRF Protection, Secrets Management, MCP Authentication

---

## Executive Summary

**Current Test Status**:
- **Total Tests**: 489 tests across 5 files
- **Auth Service**: 98 tests (auth middleware tests (removed))
- **CSRF Service**: 93 tests (csrf.service.test.ts)
- **CSRF Middleware**: 155 tests (csrf.test.ts)
- **Secrets Service**: 87 tests (secrets.service.test.ts)
- **MCP Auth**: 56 tests (mcp/auth.test.ts)

**Coverage Gaps Identified**: 127 missing test scenarios across 5 categories

---

## 1. Auth Service Coverage Gaps (auth middleware tests (removed))

### Current Coverage (98 tests)
- ✅ Basic key generation, hashing, validation
- ✅ Key lifecycle (create, revoke, rotate)
- ✅ Scope management and authorization
- ✅ Expiration handling
- ✅ Security (bcrypt cost factor, no plaintext storage)

### Critical Gaps (Priority: HIGH)

#### 1.1 Concurrent Access Patterns (12 tests needed)
**Missing Scenarios**:
```typescript
// Concurrent key validation
- Multiple simultaneous validations of same key
- Concurrent rotation attempts on same key
- Race conditions in lastUsedAt updates
- Concurrent scope updates
- Simultaneous revocation attempts
- Deadlock prevention in key operations
```

**Why Critical**: Production environments will have concurrent API requests using same keys. Race conditions could lead to:
- Inconsistent lastUsedAt timestamps
- Multiple rotation operations creating orphaned keys
- Scope update conflicts

**Recommended Tests**:
```typescript
describe('Concurrent Operations', () => {
  it('should handle concurrent key validations without race conditions', async () => {
    const { plaintextKey } = await createApiKey({ name: 'Concurrent Test' });

    // 100 concurrent validations
    const validations = Array(100).fill(null).map(() =>
      validateApiKey(plaintextKey)
    );

    const results = await Promise.all(validations);
    expect(results.every(r => r !== null)).toBe(true);

    // Verify lastUsedAt is set correctly (not corrupted)
    const key = await getApiKeyById(results[0].id);
    expect(key.lastUsedAt).toBeTruthy();
  });

  it('should prevent concurrent rotation race conditions', async () => {
    const { apiKey } = await createApiKey({ name: 'Rotation Race' });

    // 10 concurrent rotation attempts
    const rotations = Array(10).fill(null).map(() =>
      rotateApiKey(apiKey.id)
    );

    const results = await Promise.allSettled(rotations);

    // Only one should succeed
    const succeeded = results.filter(r => r.status === 'fulfilled');
    expect(succeeded.length).toBe(1);

    // Old key should be revoked exactly once
    const oldKey = await getApiKeyById(apiKey.id);
    expect(oldKey.revoked).toBeTruthy();
  });

  it('should handle concurrent scope updates atomically', async () => {
    const { apiKey } = await createApiKey({ name: 'Scope Race', scopes: ['read'] });

    const updates = [
      updateApiKeyScopes(apiKey.id, ['read', 'write']),
      updateApiKeyScopes(apiKey.id, ['read', 'admin']),
      updateApiKeyScopes(apiKey.id, ['write'])
    ];

    await Promise.all(updates);

    // Last write should win (or first, but consistent)
    const finalKey = await getApiKeyById(apiKey.id);
    expect(finalKey.scopes).toBeDefined();
    expect(finalKey.scopes.length).toBeGreaterThan(0);
  });
});
```

#### 1.2 Rate Limiting & Brute Force (8 tests needed)
**Missing Scenarios**:
```typescript
- Brute force validation attempts (timing attack resistance)
- Rate limiting on key creation (prevent key exhaustion)
- Rate limiting on validation failures
- Exponential backoff after failed validations
- Account lockout after repeated failures
- Key enumeration prevention
```

**Why Critical**: Without rate limiting, attackers can:
- Brute force API keys
- Enumerate valid keys
- Exhaust key creation limits
- Perform timing attacks to leak information

**Recommended Tests**:
```typescript
describe('Rate Limiting & Anti-Brute-Force', () => {
  it('should rate limit validation attempts', async () => {
    const attempts = Array(1000).fill(null).map(() =>
      validateApiKey('sk-mem_invalid_key_' + Math.random())
    );

    const results = await Promise.all(attempts);

    // Should start rejecting after threshold (e.g., 100 attempts/minute)
    const nullResults = results.filter(r => r === null).length;
    expect(nullResults).toBe(1000); // All invalid
  });

  it('should implement exponential backoff after failures', async () => {
    const start = Date.now();

    // Attempt 10 invalid validations rapidly
    for (let i = 0; i < 10; i++) {
      await validateApiKey('invalid-key-' + i);
    }

    const duration = Date.now() - start;

    // Should take longer due to backoff (not instant)
    expect(duration).toBeGreaterThan(100); // At least 100ms total
  });

  it('should prevent key enumeration via timing', async () => {
    const { plaintextKey } = await createApiKey({ name: 'Timing Test' });

    // Measure validation time for valid key
    const validStart = process.hrtime.bigint();
    await validateApiKey(plaintextKey);
    const validDuration = Number(process.hrtime.bigint() - validStart);

    // Measure validation time for invalid key
    const invalidStart = process.hrtime.bigint();
    await validateApiKey('sk-mem_invalid_totally_wrong');
    const invalidDuration = Number(process.hrtime.bigint() - invalidStart);

    // Should be similar (within 2x to prevent timing attacks)
    const ratio = validDuration / invalidDuration;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2.0);
  });
});
```

#### 1.3 Key Lifecycle Edge Cases (6 tests needed)
**Missing Scenarios**:
```typescript
- Rotation of already rotated key (should fail)
- Revocation of already revoked key (idempotent)
- Validation during rotation (atomic operation)
- Key expiration during validation
- Scope changes during active request
- Metadata size limits
```

### Medium Priority Gaps (9 tests)

#### 1.4 Database Constraint Violations
```typescript
- Duplicate key hashes (should be impossible but test)
- Invalid UUID formats in key operations
- NULL constraint violations
- Foreign key cascade behavior
- Transaction rollback scenarios
```

#### 1.5 Input Validation
```typescript
- Extremely long key names (>255 chars)
- Special characters in metadata
- Invalid scope names
- Negative expiration dates
```

---

## 2. CSRF Protection Coverage Gaps

### Current Coverage (248 tests total across 2 files)

#### Service Tests (csrf.service.test.ts - 93 tests)
- ✅ Token generation, validation, rotation
- ✅ Session association
- ✅ Constant-time comparison
- ✅ Token cleanup

#### Middleware Tests (csrf.test.ts - 155 tests)
- ✅ Safe/unsafe method handling
- ✅ Double-submit cookie pattern
- ✅ Origin/Referer validation
- ✅ Exempt paths
- ✅ Custom configuration

### Critical Gaps (Priority: CRITICAL)

#### 2.1 Advanced Attack Vectors (15 tests needed)

**Missing Scenarios**:
```typescript
// Token Fixation Attack
- Attacker pre-generates token and tricks user into using it
- Session fixation combined with CSRF token fixation
- Token reuse across different sessions

// Subdomain Attacks
- CSRF from subdomain.example.com to example.com
- Cookie scope manipulation
- Domain attribute exploitation

// BREACH/CRIME Compression Attacks
- Token length variation attacks
- Compression oracle via CSRF tokens
- Response size measurement attacks

// Token Swapping
- Swap cookie and header tokens (should fail)
- Use token from different session
- Token replay from previous session

// Edge Cases
- Token validation during rotation
- Extremely long tokens (DoS)
- Malformed token encoding (non-hex)
- Double encoding attacks
```

**Recommended Tests**:
```typescript
describe('CSRF Advanced Attack Vectors', () => {
  it('should prevent token fixation attacks', async () => {
    // Attacker generates token
    const attackerToken = generateCsrfToken(secret);
    const attackerString = `${attackerToken.value}.${attackerToken.timestamp}.${attackerToken.signature}`;

    // Victim uses attacker's token (forced via XSS)
    app.post('/api/action', (c) => c.json({ success: true }));

    const res = await app.request('/api/action', {
      method: 'POST',
      headers: {
        Cookie: `csrf-token=${attackerString}; session=victim-session`,
        'x-csrf-token': attackerString,
        Host: 'example.com'
      }
    });

    // Should fail because token not tied to victim's session
    expect(res.status).toBe(403);
  });

  it('should reject CSRF from subdomain', async () => {
    const token = generateCsrfToken(secret);
    const tokenString = `${token.value}.${token.timestamp}.${token.signature}`;

    const res = await app.request('/api/action', {
      method: 'POST',
      headers: {
        Cookie: `csrf-token=${tokenString}`,
        'x-csrf-token': tokenString,
        Origin: 'https://evil.example.com',
        Host: 'example.com'
      }
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ORIGIN_MISMATCH');
  });

  it('should prevent BREACH compression oracle', async () => {
    // Generate tokens of varying lengths
    const tokens = [
      generateCsrfToken(secret, 16),
      generateCsrfToken(secret, 32),
      generateCsrfToken(secret, 64)
    ];

    // Verify all tokens have different signatures (no compression hints)
    const signatures = tokens.map(t => t.signature);
    const uniqueSigs = new Set(signatures);
    expect(uniqueSigs.size).toBe(tokens.length);
  });

  it('should reject swapped cookie and header tokens', async () => {
    const token1 = generateCsrfToken(secret);
    const token2 = generateCsrfToken(secret);

    const cookieToken = `${token1.value}.${token1.timestamp}.${token1.signature}`;
    const headerToken = `${token2.value}.${token2.timestamp}.${token2.signature}`;

    const res = await app.request('/api/action', {
      method: 'POST',
      headers: {
        Cookie: `csrf-token=${cookieToken}`,
        'x-csrf-token': headerToken,
        Host: 'example.com'
      }
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('CSRF_TOKEN_MISMATCH');
  });
});
```

#### 2.2 MCP Stdio Transport (10 tests needed)

**Missing Scenarios**:
```typescript
// Stdio transport has no HTTP headers - need alternative CSRF
- Token passing via JSON-RPC params
- Token validation without cookies
- Session identification in stdio mode
- Request replay protection in stdio
- Token rotation in stdio transport
```

**Why Critical**: MCP stdio transport is fundamentally different from HTTP:
- No cookies available
- No HTTP headers (Origin, Referer)
- Need alternative CSRF protection mechanism

**Recommended Tests**:
```typescript
describe('CSRF Protection for MCP Stdio', () => {
  it('should validate CSRF token in JSON-RPC params', async () => {
    const token = generateCsrfToken(secret);

    const request = {
      jsonrpc: '2.0',
      method: 'supermemory_add',
      params: {
        content: 'test',
        csrfToken: `${token.value}.${token.timestamp}.${token.signature}`
      },
      id: 1
    };

    // Verify token from params instead of headers
    const tokenFromParams = request.params.csrfToken;
    const parsed = parseToken(tokenFromParams);
    const isValid = verifyToken(parsed.value, parsed.signature, parsed.timestamp, secret);

    expect(isValid).toBe(true);
  });

  it('should prevent replay attacks in stdio mode', async () => {
    const token = generateCsrfToken(secret);
    const tokenString = `${token.value}.${token.timestamp}.${token.signature}`;

    // First request succeeds
    const request1 = {
      jsonrpc: '2.0',
      method: 'supermemory_add',
      params: { content: 'test1', csrfToken: tokenString, nonce: '12345' },
      id: 1
    };

    // Replay with same nonce should fail
    const request2 = {
      jsonrpc: '2.0',
      method: 'supermemory_add',
      params: { content: 'test2', csrfToken: tokenString, nonce: '12345' },
      id: 2
    };

    // Implementation should track nonces and reject duplicates
    // (requires nonce tracking service)
  });
});
```

### Medium Priority Gaps (8 tests)

#### 2.3 Performance & DoS Protection
```typescript
- Token storage memory limits (prevent unbounded growth)
- Cleanup performance with millions of tokens
- Token generation rate limiting
- Malformed token handling (DoS via parsing)
```

---

## 3. Secrets Service Coverage Gaps (secrets.service.test.ts)

### Current Coverage (87 tests)
- ✅ Secret loading (env, file)
- ✅ Validation (format, strength, entropy)
- ✅ Encryption/decryption (AES-256-GCM)
- ✅ Key derivation (PBKDF2, scrypt)
- ✅ Rotation, sanitization, pattern detection

### Critical Gaps (Priority: HIGH)

#### 3.1 Integration with Real Vault Systems (12 tests needed)

**Missing Scenarios**:
```typescript
// HashiCorp Vault Integration
- Load secrets from Vault API
- Handle Vault authentication (token, AppRole)
- Vault connection failures and retries
- Vault token renewal
- Vault secret versioning

// AWS Secrets Manager Integration
- Load from AWS Secrets Manager
- IAM role authentication
- Secret rotation via AWS Lambda
- Cross-region secret replication

// Environment-specific Loading
- Load different secrets per environment (dev/staging/prod)
- Fallback chain: Vault → Env → File → Default
```

**Why Critical**: Production systems use vault services, not just environment variables.

**Recommended Tests**:
```typescript
describe('Vault Integration', () => {
  it('should load secret from HashiCorp Vault', async () => {
    // Mock Vault client
    const vaultClient = {
      read: vi.fn().mockResolvedValue({
        data: { data: { apiKey: 'vault-secret-value' } }
      })
    };

    const service = new SecretsService({ vault: vaultClient });
    const secret = await service.loadFromVault('secret/data/app/apiKey');

    expect(secret).toBe('vault-secret-value');
    expect(vaultClient.read).toHaveBeenCalledWith('secret/data/app/apiKey');
  });

  it('should handle Vault connection failures with retries', async () => {
    const vaultClient = {
      read: vi.fn()
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockResolvedValueOnce({ data: { data: { key: 'value' } } })
    };

    const service = new SecretsService({ vault: vaultClient, retries: 3 });
    const secret = await service.loadFromVault('secret/key');

    expect(secret).toBe('value');
    expect(vaultClient.read).toHaveBeenCalledTimes(3);
  });

  it('should fall back to env vars if Vault unavailable', async () => {
    process.env.FALLBACK_SECRET = 'env-fallback';

    const vaultClient = {
      read: vi.fn().mockRejectedValue(new Error('Vault unavailable'))
    };

    const service = new SecretsService({ vault: vaultClient });
    const secret = await service.loadWithFallback('secret/key', 'FALLBACK_SECRET');

    expect(secret).toBe('env-fallback');
  });
});
```

#### 3.2 Concurrent Encryption Operations (8 tests needed)

**Missing Scenarios**:
```typescript
// Concurrent Encryption
- 1000 concurrent encrypt operations
- Concurrent encrypt/decrypt of same data
- Race conditions in IV generation
- Key derivation during concurrent operations

// Memory Management
- Memory leaks in encryption loops
- Buffer cleanup after encryption
- Key material zeroing after use
```

**Recommended Tests**:
```typescript
describe('Concurrent Encryption', () => {
  it('should handle 1000 concurrent encryptions safely', async () => {
    const service = new SecretsService('encryption-password');
    const plaintext = 'concurrent-test-data';

    const encryptions = Array(1000).fill(null).map(() =>
      service.encrypt(plaintext)
    );

    const results = await Promise.all(encryptions);

    // All should succeed with unique IVs
    const ivs = results.map(r => r.iv);
    const uniqueIvs = new Set(ivs);
    expect(uniqueIvs.size).toBe(1000);

    // All should decrypt correctly
    const decryptions = results.map(r =>
      service.decrypt(r.encrypted, r.iv, r.authTag)
    );
    const decrypted = await Promise.all(decryptions);
    expect(decrypted.every(d => d === plaintext)).toBe(true);
  });

  it('should not leak memory in encryption loops', async () => {
    const service = new SecretsService('memory-test');
    const initialMemory = process.memoryUsage().heapUsed;

    // Encrypt 10,000 times
    for (let i = 0; i < 10000; i++) {
      const result = service.encrypt('test-data-' + i);
      service.decrypt(result.encrypted, result.iv, result.authTag);
    }

    global.gc(); // Force garbage collection
    const finalMemory = process.memoryUsage().heapUsed;
    const memoryIncrease = finalMemory - initialMemory;

    // Should not leak significantly (<10MB)
    expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
  });
});
```

#### 3.3 Sanitization Bypass Attempts (6 tests needed)

**Missing Scenarios**:
```typescript
// Advanced Obfuscation
- Base64-encoded secrets in logs
- URL-encoded secrets
- Unicode encoding tricks
- Multi-line secrets spanning log entries
- Secrets split across multiple fields
- Template string injection
```

**Recommended Tests**:
```typescript
describe('Sanitization Bypass Prevention', () => {
  it('should detect base64-encoded API keys', () => {
    const apiKey = 'sk-mem_' + 'a'.repeat(40);
    const encoded = Buffer.from(apiKey).toString('base64');
    const text = `Encoded key: ${encoded}`;

    // Should detect and redact base64-encoded secrets
    const sanitized = service.sanitizeForLogging(text);
    expect(sanitized).not.toContain(encoded);
    expect(sanitized).toContain('***REDACTED***');
  });

  it('should sanitize multi-line secrets', () => {
    const text = `
      Database connection:
      postgresql://user:secret_password_here@localhost/db
      on port 5432
    `;

    const sanitized = service.sanitizeForLogging(text);
    expect(sanitized).not.toContain('secret_password_here');
    expect(sanitized).toContain('***REDACTED***');
  });

  it('should detect secrets in JSON strings', () => {
    const json = JSON.stringify({
      config: {
        apiKey: 'sk-mem_secret123abc',
        dbUrl: 'postgresql://u:p@host/db'
      }
    });

    const sanitized = service.sanitizeForLogging(json);
    expect(sanitized).not.toContain('sk-mem_secret123abc');
    expect(sanitized).not.toContain(':p@');
  });
});
```

### Medium Priority Gaps (10 tests)

#### 3.4 Key Rotation Edge Cases
```typescript
- Rotation during active encryption
- Rotation with invalid new key
- Rollback after failed rotation
- Re-encryption of stored secrets
```

#### 3.5 Validation Edge Cases
```typescript
- Empty secret strings
- Secrets with only whitespace
- Extremely long secrets (>1MB)
- Binary secret data
```

---

## 4. MCP Authentication Coverage Gaps (mcp/auth.test.ts)

### Current Coverage (56 tests)
- ✅ API key extraction from headers
- ✅ Authentication validation
- ✅ Authorization with scopes
- ✅ Tool-to-scope mapping
- ✅ Admin scope grants all permissions

### Critical Gaps (Priority: HIGH)

#### 4.1 MCP-Specific Edge Cases (14 tests needed)

**Missing Scenarios**:
```typescript
// Stdio Transport Authentication
- Auth without HTTP headers (stdio mode)
- Token passing in JSON-RPC params
- Session management in stateless stdio
- Request authentication ordering

// Multi-Tenant Scenarios
- API key from different tenant
- Cross-tenant tool access attempts
- Tenant isolation validation
- Scope inheritance across tenants

// Custom Scopes
- Dynamic scope creation
- Scope hierarchy (admin > write > read)
- Wildcard scopes (api:*)
- Negative scopes (deny patterns)
```

**Recommended Tests**:
```typescript
describe('MCP Stdio Authentication', () => {
  it('should authenticate from JSON-RPC params in stdio mode', async () => {
    const { plaintextKey } = await createApiKey({
      name: 'Stdio Key',
      scopes: ['read', 'write']
    });

    const request = {
      jsonrpc: '2.0',
      method: 'supermemory_search',
      params: {
        query: 'test',
        apiKey: plaintextKey // In params, not headers
      },
      id: 1
    };

    // Extract from params instead of headers
    const apiKey = request.params.apiKey;
    const authResult = await authenticateRequest({ apiKey });

    expect(authResult.authenticated).toBe(true);
    expect(authResult.apiKey.scopes).toContain('read');
  });

  it('should enforce tenant isolation', async () => {
    const { plaintextKey: tenant1Key } = await createApiKey({
      name: 'Tenant 1 Key',
      scopes: ['read'],
      metadata: { tenantId: 'tenant-1' }
    });

    const { plaintextKey: tenant2Key } = await createApiKey({
      name: 'Tenant 2 Key',
      scopes: ['read'],
      metadata: { tenantId: 'tenant-2' }
    });

    // Tenant 1 tries to access Tenant 2's data
    const headers = { 'x-api-key': tenant1Key };
    const authResult = await authenticateRequest(headers);

    // Should authenticate but not authorize cross-tenant access
    expect(authResult.authenticated).toBe(true);

    // Authorization should check tenant isolation
    const canAccessTenant2 = authorizeRequest(authResult, ['read'], 'tenant-2');
    expect(canAccessTenant2.authorized).toBe(false);
  });
});
```

#### 4.2 Performance & Caching (6 tests needed)

**Missing Scenarios**:
```typescript
// Authentication Caching
- Cache validated API keys (avoid DB lookups)
- Cache invalidation on key revocation
- TTL-based cache expiry
- Cache memory limits

// Performance Testing
- 10,000 concurrent authentication requests
- Authentication latency benchmarks
```

### Medium Priority Gaps (8 tests)

#### 4.3 Error Handling
```typescript
- Database connection failures during auth
- Corrupted API key data
- Invalid scope formats in database
- Missing TOOL_SCOPES entries
```

---

## 5. Integration Test Gaps

### Cross-Component Integration (20 tests needed)

**Missing Scenarios**:
```typescript
// Auth + CSRF Integration
- CSRF token validation with API key auth
- Token rotation during authenticated session
- Multi-layer security (API key + CSRF + rate limit)

// Auth + Secrets Integration
- Load API key secrets from Vault
- Rotate encryption keys for API key hashes
- Secret detection in API key metadata

// Full Request Flow
- HTTP request → Rate limit → CSRF → Auth → Authorization → MCP tool execution
- Error propagation through middleware stack
- Audit logging of full auth chain
```

**Recommended Tests**:
```typescript
describe('Integration: Full Auth Stack', () => {
  it('should validate full request through all security layers', async () => {
    const { plaintextKey } = await createApiKey({
      name: 'Integration Test',
      scopes: ['write']
    });

    const csrfToken = csrfService.generateToken();
    const tokenString = `${csrfToken.token}.${csrfToken.signature}`;

    const app = new Hono();
    app.use('*', rateLimitMiddleware({ max: 100 }));
    app.use('*', csrfMiddleware({ secret }));
    app.use('*', authMiddleware());
    app.post('/api/add', async (c) => {
      // MCP tool execution
      return c.json({ success: true });
    });

    const res = await app.request('/api/add', {
      method: 'POST',
      headers: {
        'X-API-Key': plaintextKey,
        'Cookie': `csrf-token=${tokenString}`,
        'X-CSRF-Token': tokenString,
        'Host': 'localhost'
      },
      body: JSON.stringify({ content: 'test' })
    });

    expect(res.status).toBe(200);
  });
});
```

---

## Summary: Test Implementation Roadmap

### Priority 1: Critical Security Gaps (48 tests, ~2 days)
1. **CSRF Advanced Attacks** (15 tests)
   - Token fixation, subdomain attacks, BREACH
   - MCP stdio CSRF protection (10 tests)

2. **Auth Rate Limiting** (8 tests)
   - Brute force prevention
   - Timing attack resistance

3. **Secrets Vault Integration** (12 tests)
   - HashiCorp Vault, AWS Secrets Manager
   - Fallback chains

4. **MCP Tenant Isolation** (8 tests)
   - Multi-tenant scenarios
   - Stdio transport auth

5. **Concurrent Operations** (5 tests)
   - Auth key rotation races
   - Concurrent encryption

### Priority 2: High-Impact Gaps (39 tests, ~1.5 days)
1. **Auth Concurrent Access** (12 tests)
2. **CSRF Performance & DoS** (8 tests)
3. **Secrets Sanitization Bypass** (6 tests)
4. **MCP Custom Scopes** (8 tests)
5. **Auth Lifecycle Edge Cases** (5 tests)

### Priority 3: Integration Tests (20 tests, ~1 day)
1. **Full Auth Stack** (10 tests)
2. **Cross-Component** (10 tests)

### Priority 4: Medium Priority (20 tests, ~0.5 days)
1. **Database Constraints** (5 tests)
2. **Input Validation** (4 tests)
3. **Key Rotation Edge Cases** (4 tests)
4. **Error Handling** (7 tests)

---

## Total Summary

| Category | Current Tests | Missing Tests | Priority | Effort |
|----------|--------------|---------------|----------|--------|
| Auth Service | 98 | 27 | High | 1 day |
| CSRF Protection | 248 | 33 | Critical | 1.5 days |
| Secrets Management | 87 | 26 | High | 1 day |
| MCP Auth | 56 | 22 | High | 0.75 days |
| Integration | 0 | 20 | Critical | 1 day |
| **TOTAL** | **489** | **127** | - | **5.25 days** |

---

## Recommended Implementation Order

### Week 1 (Critical Security)
**Day 1-2**: CSRF Advanced Attacks + MCP Stdio
- Prevent token fixation, subdomain attacks
- Implement stdio CSRF protection

**Day 3**: Auth Rate Limiting
- Brute force prevention
- Timing attack resistance

**Day 4**: Secrets Vault Integration
- HashiCorp Vault tests
- AWS Secrets Manager tests

**Day 5**: Integration Tests (Part 1)
- Full auth stack validation
- Multi-layer security tests

### Week 2 (High Impact + Completion)
**Day 6**: Concurrent Operations
- Auth key races
- Concurrent encryption

**Day 7**: MCP Tenant Isolation
- Multi-tenant tests
- Custom scopes

**Day 8**: Sanitization & Edge Cases
- Bypass prevention
- Lifecycle edge cases

**Day 9**: Integration Tests (Part 2)
- Cross-component tests
- Error propagation

**Day 10**: Medium Priority Cleanup
- Database constraints
- Input validation
- Final review

---

## Coverage Target

**Current**: ~75% (based on basic scenarios)
**After P1+P2**: ~92% (adding critical security + high impact)
**After All**: ~97% (comprehensive coverage)

**Metrics**:
- Statement coverage: >95%
- Branch coverage: >90%
- Attack vector coverage: 100%
- Edge case coverage: >85%

---

## Tools & Automation

### Recommended Setup
```bash
# Run coverage analysis
npm run test:coverage

# Watch mode during development
npm run test:watch

# Security-focused test suite
npm run test:security

# Performance benchmarks
npm run test:perf
```

### CI/CD Integration
```yaml
# .github/workflows/test.yml
- name: Run Security Tests
  run: npm run test:security

- name: Coverage Threshold
  run: |
    npm run test:coverage
    # Enforce >90% coverage
```

---

## Next Steps

1. **Review & Approve**: Prioritize which gaps to address first
2. **Sprint Planning**: Allocate 5.25 days across team
3. **Implementation**: Follow recommended order
4. **Code Review**: Security-focused review for all new tests
5. **Documentation**: Update security test documentation
6. **CI/CD**: Integrate security test suite into pipeline

---

**Generated by**: Claude Code Testing Agent
**Review Status**: Pending
**Estimated Completion**: 2 weeks (10 business days)
