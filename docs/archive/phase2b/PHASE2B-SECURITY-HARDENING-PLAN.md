# Phase 2B: Security Hardening Plan

**Priority:** P0 (Critical)  
**Estimated Effort:** 2 weeks  
**Dependencies:** Phase 2A Complete ✅

---

## Executive Summary

Phase 2 reviews identified **8 P0 (critical) security issues** that must be addressed before production deployment. This plan details implementation strategy for each issue with concrete code examples and test requirements.

---

## P0 Security Issues

### 1. No Input Validation on User Content ⚠️

**Risk:** Malicious payloads, injection attacks, data corruption  
**Impact:** Critical - affects all user-facing APIs  
**Effort:** 3 days

**Current State:**
```typescript
// src/services/memory.service.ts (VULNERABLE)
async createMemory(input: CreateMemoryInput): Promise<Memory> {
  // No validation - accepts any input!
  return this.storage.add(input.content, input.metadata);
}
```

**Target State:**
```typescript
// Use Zod for runtime validation
import { z } from 'zod';

const CreateMemorySchema = z.object({
  content: z.string()
    .min(1, 'Content cannot be empty')
    .max(50000, 'Content too large')
    .refine(
      (content) => !containsMaliciousPatterns(content),
      'Content contains potentially malicious patterns'
    ),
  metadata: z.object({
    source: z.enum(['web', 'file', 'api', 'manual']),
    timestamp: z.date().optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
  }).optional(),
  containerTag: z.string().max(100).optional(),
});

async createMemory(input: unknown): Promise<Memory> {
  // Validate input
  const validated = CreateMemorySchema.parse(input);
  
  // Sanitize content
  const sanitized = sanitizeContent(validated.content);
  
  return this.storage.add(sanitized, validated.metadata);
}
```

**Implementation Tasks:**
- [ ] Create `src/utils/validation.ts` with Zod schemas
- [ ] Add validation middleware for API routes
- [ ] Implement content sanitization utilities
- [ ] Add tests for validation edge cases
- [ ] Update API documentation with validation rules

---

### 2. No SQL Injection Prevention in Raw Queries ⚠️

**Risk:** Database compromise, data exfiltration  
**Impact:** Critical - can expose entire database  
**Effort:** 2 days

**Current State:**
```typescript
// src/services/vectorstore/pgvector.ts (VULNERABLE)
async search(query: string, limit: number): Promise<Memory[]> {
  // Direct string interpolation - SQL INJECTION RISK!
  const sql = `
    SELECT * FROM memories 
    WHERE content LIKE '%${query}%' 
    LIMIT ${limit}
  `;
  return this.db.query(sql);
}
```

**Target State:**
```typescript
// Use parameterized queries ALWAYS
async search(query: string, limit: number): Promise<Memory[]> {
  // Validate inputs first
  const sanitizedQuery = validateSearchQuery(query);
  const validatedLimit = Math.min(Math.max(1, limit), 1000);
  
  // Use parameterized query
  const sql = `
    SELECT * FROM memories 
    WHERE content ILIKE $1 
    LIMIT $2
  `;
  return this.db.query(sql, [`%${sanitizedQuery}%`, validatedLimit]);
}
```

**Implementation Tasks:**
- [ ] Audit all SQL queries (grep for string interpolation)
- [ ] Convert to parameterized queries using `$1, $2` syntax
- [ ] Add query validation utilities
- [ ] Create SQL injection test suite
- [ ] Add automated SQL injection scanning

**Files to Audit:**
- src/services/vectorstore/pgvector.ts
- src/services/memory.service.ts
- src/database/schema/*.sql
- src/database/migrations/*.sql

---

### 3. No XSS Sanitization for HTML Extraction ⚠️

**Risk:** Cross-site scripting, session hijacking, data theft  
**Impact:** Critical - affects web content extraction  
**Effort:** 2 days

**Current State:**
```typescript
// src/services/extractors/html.ts (VULNERABLE)
async extract(html: string): Promise<string> {
  // No sanitization - script tags preserved!
  const dom = parseHTML(html);
  return dom.textContent;
}
```

**Target State:**
```typescript
import { sanitize } from 'isomorphic-dompurify';

async extract(html: string): Promise<string> {
  // Sanitize HTML first (remove scripts, dangerous attributes)
  const sanitized = sanitize(html, {
    ALLOWED_TAGS: ['p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
                   'ul', 'ol', 'li', 'a', 'strong', 'em', 'code', 'pre'],
    ALLOWED_ATTR: ['href', 'title'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onclick', 'onload'],
  });
  
  const dom = parseHTML(sanitized);
  const text = dom.textContent;
  
  // Additional text sanitization
  return sanitizeText(text);
}
```

**Implementation Tasks:**
- [ ] Install `isomorphic-dompurify` and `jsdom`
- [ ] Create HTML sanitization utility in `src/utils/sanitize.ts`
- [ ] Add XSS test vectors (OWASP XSS cheat sheet)
- [ ] Update HTML extractor with sanitization
- [ ] Add content security policy (CSP) headers

---

### 4. No Path Traversal Protection in File Operations ⚠️

**Risk:** Arbitrary file read/write, system compromise  
**Impact:** Critical - can access sensitive system files  
**Effort:** 1 day

**Current State:**
```typescript
// src/services/extractors/file.ts (VULNERABLE)
async readFile(filepath: string): Promise<string> {
  // No validation - can read ANY file!
  return fs.readFileSync(filepath, 'utf-8');
}
```

**Target State:**
```typescript
import path from 'path';

const ALLOWED_DIRECTORIES = [
  '/var/uploads',
  '/tmp/extraction',
] as const;

async readFile(filepath: string): Promise<string> {
  // Validate path
  const normalizedPath = path.normalize(filepath);
  const resolvedPath = path.resolve(normalizedPath);
  
  // Check for path traversal
  if (resolvedPath.includes('..')) {
    throw new SecurityError('Path traversal attempt detected');
  }
  
  // Verify path is within allowed directories
  const isAllowed = ALLOWED_DIRECTORIES.some(dir => 
    resolvedPath.startsWith(path.resolve(dir))
  );
  
  if (!isAllowed) {
    throw new SecurityError('Access to path denied');
  }
  
  // Additional checks
  const stats = await fs.promises.stat(resolvedPath);
  if (!stats.isFile()) {
    throw new SecurityError('Path is not a file');
  }
  
  // Size limit
  if (stats.size > 50 * 1024 * 1024) { // 50MB
    throw new SecurityError('File too large');
  }
  
  return fs.promises.readFile(resolvedPath, 'utf-8');
}
```

**Implementation Tasks:**
- [ ] Create path validation utility in `src/utils/security.ts`
- [ ] Define allowed directories in configuration
- [ ] Add path traversal test suite
- [ ] Audit all file operations
- [ ] Add file type validation

---

### 5. No Rate Limiting on API Endpoints ⚠️

**Risk:** DDoS, resource exhaustion, cost overruns  
**Impact:** Critical - service availability  
**Effort:** 2 days

**Current State:**
```typescript
// src/api/routes.ts (VULNERABLE)
app.post('/api/memories', async (req, res) => {
  // No rate limiting - unlimited requests!
  const memory = await memoryService.create(req.body);
  res.json(memory);
});
```

**Target State:**
```typescript
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

// Global rate limit
const globalLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:global:',
  }),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 min
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict rate limit for expensive operations
const strictLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:strict:',
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  skipSuccessfulRequests: false,
});

// Apply rate limiting
app.use('/api/', globalLimiter);
app.post('/api/memories', strictLimiter, async (req, res) => {
  const memory = await memoryService.create(req.body);
  res.json(memory);
});
```

**Implementation Tasks:**
- [ ] Install `express-rate-limit` and `rate-limit-redis`
- [ ] Configure Redis connection
- [ ] Define rate limits per endpoint category
- [ ] Add rate limit headers to responses
- [ ] Create rate limit monitoring dashboard
- [ ] Add tests for rate limiting

**Rate Limit Configuration:**
```typescript
const RATE_LIMITS = {
  global: { windowMs: 15 * 60 * 1000, max: 1000 },
  read: { windowMs: 60 * 1000, max: 100 },
  write: { windowMs: 60 * 1000, max: 10 },
  search: { windowMs: 60 * 1000, max: 30 },
  extraction: { windowMs: 60 * 1000, max: 5 },
};
```

---

### 6. Missing Authentication/Authorization ⚠️

**Risk:** Unauthorized access, data breaches  
**Impact:** Critical - no access control  
**Effort:** 3 days

**Current State:**
```typescript
// No authentication - all endpoints public!
app.get('/api/memories', async (req, res) => {
  const memories = await memoryService.getAll();
  res.json(memories);
});
```

**Target State:**
```typescript
import jwt from 'jsonwebtoken';

// Authentication middleware
const authenticate = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }
  
  // Verify API key (hash comparison)
  const hashedKey = hashApiKey(apiKey);
  const user = await getUserByApiKey(hashedKey);
  
  if (!user) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  // Check if key is expired
  if (user.apiKeyExpiry && user.apiKeyExpiry < new Date()) {
    return res.status(401).json({ error: 'API key expired' });
  }
  
  req.user = user;
  next();
};

// Authorization middleware
const authorize = (permissions: string[]) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const hasPermission = permissions.some(p => 
      req.user.permissions.includes(p)
    );
    
    if (!hasPermission) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
};

// Protected endpoints
app.get('/api/memories', 
  authenticate, 
  authorize(['read:memories']),
  async (req, res) => {
    // Filter by user's containerTag
    const memories = await memoryService.getAll({
      containerTag: req.user.containerTag,
    });
    res.json(memories);
  }
);
```

**Implementation Tasks:**
- [ ] Design API key schema (table: api_keys)
- [ ] Create key generation/hashing utilities
- [ ] Implement authentication middleware
- [ ] Implement authorization middleware
- [ ] Add role-based access control (RBAC)
- [ ] Create API key management endpoints
- [ ] Add audit logging for auth events
- [ ] Write authentication tests

---

### 7. No Secrets Management (API Keys in .env) ⚠️

**Risk:** Credential exposure, unauthorized access  
**Impact:** Critical - third-party API compromise  
**Effort:** 2 days

**Current State:**
```bash
# .env (VULNERABLE - committed to git!)
OPENAI_API_KEY=sk-proj-abc123...
ANTHROPIC_API_KEY=sk-ant-xyz789...
DATABASE_URL=postgresql://user:pass@localhost/db
```

**Target State:**

**Option 1: HashiCorp Vault (Production)**
```typescript
import { VaultClient } from 'node-vault';

const vault = new VaultClient({
  endpoint: process.env.VAULT_ADDR,
  token: process.env.VAULT_TOKEN, // From environment/IAM
});

async function getSecret(path: string): Promise<string> {
  const result = await vault.read(`secret/data/${path}`);
  return result.data.data.value;
}

// Usage
const openaiKey = await getSecret('openai/api-key');
const anthropicKey = await getSecret('anthropic/api-key');
```

**Option 2: AWS Secrets Manager (AWS deployment)**
```typescript
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

const secretsManager = new SecretsManager({ region: 'us-east-1' });

async function getSecret(secretName: string): Promise<string> {
  const response = await secretsManager.getSecretValue({
    SecretId: secretName,
  });
  return response.SecretString!;
}
```

**Option 3: Encrypted .env (Development)**
```typescript
// Use sops or git-crypt for encryption
// .env.enc (encrypted file)
import { decrypt } from 'sops';

const decrypted = decrypt('.env.enc');
process.env = { ...process.env, ...decrypted };
```

**Implementation Tasks:**
- [ ] Choose secrets management solution
- [ ] Migrate all secrets from .env
- [ ] Add .env to .gitignore (verify not in git history)
- [ ] Create secrets rotation policy
- [ ] Add secrets audit logging
- [ ] Document secrets management process
- [ ] Add CI/CD integration for secrets

---

### 8. No CSRF Protection ⚠️

**Risk:** Cross-site request forgery, unauthorized actions  
**Impact:** Critical - affects state-changing operations  
**Effort:** 1 day

**Current State:**
```typescript
// No CSRF protection
app.post('/api/memories', async (req, res) => {
  // Accepts any POST request!
  const memory = await memoryService.create(req.body);
  res.json(memory);
});
```

**Target State:**
```typescript
import csrf from 'csurf';

// CSRF protection middleware
const csrfProtection = csrf({ 
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  },
});

// Get CSRF token
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Protect state-changing endpoints
app.post('/api/memories', csrfProtection, async (req, res) => {
  // CSRF token validated automatically
  const memory = await memoryService.create(req.body);
  res.json(memory);
});

// For API-only (no cookies), use custom header validation
const validateApiRequest = (req, res, next) => {
  const headerToken = req.headers['x-requested-with'];
  if (headerToken !== 'XMLHttpRequest') {
    return res.status(403).json({ error: 'Invalid request' });
  }
  next();
};
```

**Implementation Tasks:**
- [ ] Install `csurf` package
- [ ] Add CSRF middleware to app
- [ ] Create CSRF token endpoint
- [ ] Update client to include CSRF tokens
- [ ] Add CSRF tests
- [ ] Document CSRF workflow

---

## Implementation Schedule

### Week 1: Input Validation & Injection Prevention

**Days 1-3:**
- Input validation framework (Zod schemas)
- XSS sanitization (HTML/content)
- Path traversal protection

**Days 4-5:**
- SQL injection prevention audit
- Parameterized query conversion
- Security test suite creation

### Week 2: Authentication & Infrastructure

**Days 6-8:**
- Rate limiting (Redis)
- Authentication/authorization system
- API key management

**Days 9-10:**
- Secrets management migration
- CSRF protection
- Security documentation
- Final testing & deployment

---

## Testing Strategy

### Security Test Suite

**1. Input Validation Tests:**
```typescript
describe('Input Validation', () => {
  test('rejects content over size limit', async () => {
    const oversized = 'a'.repeat(60000);
    await expect(
      memoryService.create({ content: oversized })
    ).rejects.toThrow('Content too large');
  });
  
  test('rejects malicious patterns', async () => {
    const malicious = '<script>alert("XSS")</script>';
    await expect(
      memoryService.create({ content: malicious })
    ).rejects.toThrow('potentially malicious');
  });
});
```

**2. SQL Injection Tests:**
```typescript
describe('SQL Injection Prevention', () => {
  test('handles SQL injection in search', async () => {
    const injection = "'; DROP TABLE memories; --";
    const results = await vectorStore.search(injection);
    // Should return empty results, not crash
    expect(results).toEqual([]);
  });
});
```

**3. Rate Limiting Tests:**
```typescript
describe('Rate Limiting', () => {
  test('enforces rate limit', async () => {
    const requests = Array(15).fill(null).map(() => 
      request(app).post('/api/memories').send({})
    );
    
    const responses = await Promise.all(requests);
    const tooManyRequests = responses.filter(r => r.status === 429);
    expect(tooManyRequests.length).toBeGreaterThan(0);
  });
});
```

---

## Success Criteria

| Security Issue | Target | Verification |
|----------------|--------|--------------|
| Input validation | 100% coverage | Zod schemas on all inputs |
| SQL injection | 0 vulnerabilities | Automated scanning + audit |
| XSS protection | All HTML sanitized | XSS test vectors pass |
| Path traversal | Restricted access | Path validation tests pass |
| Rate limiting | All endpoints | Load testing confirms limits |
| Authentication | Required on all APIs | Auth tests pass |
| Secrets mgmt | No keys in code/env | Secret scanning clean |
| CSRF protection | State-changing ops | CSRF tests pass |

---

## Monitoring & Alerting

### Security Metrics to Track

1. **Failed authentication attempts**
   - Alert on >10 failures/minute from single IP
   
2. **Rate limit violations**
   - Monitor rate limit hit rate
   - Alert on excessive violations

3. **Input validation failures**
   - Track validation error types
   - Alert on unusual patterns

4. **SQL query failures**
   - Monitor for SQL errors
   - Alert on injection attempts

5. **File access violations**
   - Track path traversal attempts
   - Alert on denied access patterns

---

## Documentation Deliverables

1. **Security.md** - Security architecture overview
2. **API-Authentication.md** - API key usage guide
3. **Rate-Limits.md** - Rate limit reference
4. **Input-Validation.md** - Validation rules
5. **Incident-Response.md** - Security incident procedures

---

## Post-Implementation Checklist

- [ ] All 8 P0 security issues resolved
- [ ] Security test suite passing (100%)
- [ ] Automated security scanning configured
- [ ] Security documentation complete
- [ ] Team training on security practices
- [ ] Penetration testing scheduled
- [ ] Security monitoring dashboard deployed
- [ ] Incident response plan documented

---

**Next Phase:** Phase 2C - Production Readiness (async processing, monitoring, optimization)
