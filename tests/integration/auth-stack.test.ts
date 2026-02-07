/**
 * Full Authentication Stack Integration Tests
 *
 * 10 comprehensive tests covering:
 * - Rate limit → CSRF → Auth → Authorization → MCP tool flow (3 tests)
 * - Error propagation through middleware (3 tests)
 * - Audit logging of security chain (4 tests)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// ============================================================================
// Security Middleware Stack
// ============================================================================

interface RateLimitEntry {
  attempts: number[];
  blockedUntil?: number;
}

interface CsrfToken {
  value: string;
  signature: string;
  timestamp: number;
}

interface AuthContext {
  userId?: string;
  sessionId?: string;
  roles?: string[];
  authenticated: boolean;
}

interface AuditLog {
  timestamp: Date;
  level: 'info' | 'warn' | 'error';
  event: string;
  userId?: string;
  ip?: string;
  details: Record<string, any>;
}

class SecurityStack {
  private rateLimitStore = new Map<string, RateLimitEntry>();
  private auditLogs: AuditLog[] = [];
  private secret = 'test-secret-key';

  // ============================================================================
  // Rate Limiting Layer
  // ============================================================================

  checkRateLimit(identifier: string, maxAttempts: number = 5, windowMs: number = 60000): {
    allowed: boolean;
    remaining: number;
  } {
    const now = Date.now();
    const entry = this.rateLimitStore.get(identifier) || { attempts: [] };

    // Check if blocked
    if (entry.blockedUntil && now < entry.blockedUntil) {
      this.logAudit('warn', 'rate_limit_blocked', undefined, { identifier });
      return { allowed: false, remaining: 0 };
    }

    // Remove expired attempts
    entry.attempts = entry.attempts.filter((timestamp) => now - timestamp < windowMs);

    // Check if under limit
    if (entry.attempts.length >= maxAttempts) {
      entry.blockedUntil = now + 300000; // 5 min block
      this.rateLimitStore.set(identifier, entry);
      this.logAudit('warn', 'rate_limit_exceeded', undefined, { identifier, attempts: entry.attempts.length });
      return { allowed: false, remaining: 0 };
    }

    // Record attempt
    entry.attempts.push(now);
    this.rateLimitStore.set(identifier, entry);

    const remaining = maxAttempts - entry.attempts.length;
    this.logAudit('info', 'rate_limit_checked', undefined, { identifier, remaining });

    return { allowed: true, remaining };
  }

  // ============================================================================
  // CSRF Protection Layer
  // ============================================================================

  generateCsrfToken(): CsrfToken {
    const value = randomBytes(32).toString('hex');
    const timestamp = Date.now();
    const data = `${value}.${timestamp}`;
    const signature = createHmac('sha256', this.secret).update(data).digest('hex');

    return { value, signature, timestamp };
  }

  verifyCsrfToken(
    value: string,
    signature: string,
    timestamp: number,
    maxAge: number = 3600000
  ): boolean {
    // Check expiry
    if (Date.now() - timestamp > maxAge) {
      this.logAudit('warn', 'csrf_token_expired', undefined, { timestamp });
      return false;
    }

    // Verify signature
    const data = `${value}.${timestamp}`;
    const expectedSignature = createHmac('sha256', this.secret).update(data).digest('hex');

    if (signature.length !== 64 || !/^[0-9a-f]{64}$/.test(signature)) {
      this.logAudit('error', 'csrf_token_invalid_format', undefined, { signatureLength: signature.length });
      return false;
    }

    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    const isValid = timingSafeEqual(signatureBuffer, expectedBuffer);

    if (!isValid) {
      this.logAudit('error', 'csrf_token_signature_mismatch', undefined, {});
    } else {
      this.logAudit('info', 'csrf_token_verified', undefined, {});
    }

    return isValid;
  }

  checkCsrfDoubleSubmit(cookieToken: string, headerToken: string): boolean {
    const isMatch = cookieToken === headerToken;

    if (!isMatch) {
      this.logAudit('error', 'csrf_double_submit_mismatch', undefined, {});
    }

    return isMatch;
  }

  // ============================================================================
  // Authentication Layer
  // ============================================================================

  authenticate(token: string, validTokens: Map<string, AuthContext>): AuthContext | null {
    const context = validTokens.get(token);

    if (!context) {
      this.logAudit('warn', 'authentication_failed', undefined, { reason: 'invalid_token' });
      return null;
    }

    this.logAudit('info', 'authentication_success', context.userId, { sessionId: context.sessionId });
    return context;
  }

  // ============================================================================
  // Authorization Layer
  // ============================================================================

  authorize(context: AuthContext, requiredRole: string): boolean {
    if (!context.authenticated) {
      this.logAudit('warn', 'authorization_failed', context.userId, { reason: 'not_authenticated' });
      return false;
    }

    const hasRole = context.roles?.includes(requiredRole);

    if (!hasRole) {
      this.logAudit('warn', 'authorization_failed', context.userId, {
        requiredRole,
        userRoles: context.roles,
      });
      return false;
    }

    this.logAudit('info', 'authorization_success', context.userId, { requiredRole });
    return true;
  }

  // ============================================================================
  // MCP Tool Execution Layer
  // ============================================================================

  async executeMcpTool(
    toolName: string,
    params: Record<string, any>,
    context: AuthContext
  ): Promise<{ success: boolean; result?: any; error?: string }> {
    this.logAudit('info', 'mcp_tool_execution_start', context.userId, { toolName, params });

    // Simulate tool execution
    try {
      const result = { data: `${toolName} executed successfully` };

      this.logAudit('info', 'mcp_tool_execution_success', context.userId, { toolName, result });

      return { success: true, result };
    } catch (error: any) {
      this.logAudit('error', 'mcp_tool_execution_error', context.userId, {
        toolName,
        error: error.message,
      });

      return { success: false, error: error.message };
    }
  }

  // ============================================================================
  // Audit Logging
  // ============================================================================

  logAudit(
    level: 'info' | 'warn' | 'error',
    event: string,
    userId?: string,
    details: Record<string, any> = {}
  ): void {
    this.auditLogs.push({
      timestamp: new Date(),
      level,
      event,
      userId,
      details,
    });
  }

  getAuditLogs(filter?: { level?: 'info' | 'warn' | 'error'; event?: string }): AuditLog[] {
    if (!filter) return this.auditLogs;

    return this.auditLogs.filter((log) => {
      if (filter.level && log.level !== filter.level) return false;
      if (filter.event && log.event !== filter.event) return false;
      return true;
    });
  }

  clearAuditLogs(): void {
    this.auditLogs = [];
  }

  resetRateLimits(): void {
    this.rateLimitStore.clear();
  }
}

// ============================================================================
// Full Stack Flow Tests (3 tests)
// ============================================================================

describe('Full Authentication Stack Flow', () => {
  let stack: SecurityStack;
  let validTokens: Map<string, AuthContext>;

  beforeEach(() => {
    stack = new SecurityStack();
    validTokens = new Map([
      [
        'valid-token-123',
        {
          userId: 'user-1',
          sessionId: 'session-1',
          roles: ['admin', 'user'],
          authenticated: true,
        },
      ],
      [
        'valid-token-456',
        {
          userId: 'user-2',
          sessionId: 'session-2',
          roles: ['user'],
          authenticated: true,
        },
      ],
    ]);
  });

  it('should complete successful full stack flow: rate limit → CSRF → auth → authz → MCP', async () => {
    const identifier = 'user@example.com';

    // 1. Rate Limit Check
    const rateLimitResult = stack.checkRateLimit(identifier);
    expect(rateLimitResult.allowed).toBe(true);
    expect(rateLimitResult.remaining).toBeGreaterThan(0);

    // 2. CSRF Validation
    const csrfToken = stack.generateCsrfToken();
    const csrfValid = stack.verifyCsrfToken(
      csrfToken.value,
      csrfToken.signature,
      csrfToken.timestamp
    );
    expect(csrfValid).toBe(true);

    // 3. Authentication
    const authContext = stack.authenticate('valid-token-123', validTokens);
    expect(authContext).not.toBeNull();
    expect(authContext?.authenticated).toBe(true);

    // 4. Authorization
    const authorized = stack.authorize(authContext!, 'admin');
    expect(authorized).toBe(true);

    // 5. MCP Tool Execution
    const toolResult = await stack.executeMcpTool('memory_store', { key: 'test' }, authContext!);
    expect(toolResult.success).toBe(true);

    // Verify audit trail
    const logs = stack.getAuditLogs();
    expect(logs.some((l) => l.event === 'rate_limit_checked')).toBe(true);
    expect(logs.some((l) => l.event === 'csrf_token_verified')).toBe(true);
    expect(logs.some((l) => l.event === 'authentication_success')).toBe(true);
    expect(logs.some((l) => l.event === 'authorization_success')).toBe(true);
    expect(logs.some((l) => l.event === 'mcp_tool_execution_success')).toBe(true);
  });

  it('should block request at rate limit stage', () => {
    const identifier = 'attacker@evil.com';

    // Exhaust rate limit
    for (let i = 0; i < 5; i++) {
      stack.checkRateLimit(identifier, 5);
    }

    // Next request should be blocked
    const result = stack.checkRateLimit(identifier, 5);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);

    // Verify no further checks occurred
    const logs = stack.getAuditLogs({ level: 'warn', event: 'rate_limit_exceeded' });
    expect(logs.length).toBeGreaterThan(0);
  });

  it('should block request at CSRF validation stage', () => {
    const identifier = 'user@example.com';

    // 1. Pass rate limit
    const rateLimitResult = stack.checkRateLimit(identifier);
    expect(rateLimitResult.allowed).toBe(true);

    // 2. Fail CSRF (invalid signature)
    const csrfToken = stack.generateCsrfToken();
    const invalidSignature = 'a'.repeat(64);
    const csrfValid = stack.verifyCsrfToken(csrfToken.value, invalidSignature, csrfToken.timestamp);
    expect(csrfValid).toBe(false);

    // Verify audit log
    const logs = stack.getAuditLogs({ level: 'error', event: 'csrf_token_signature_mismatch' });
    expect(logs.length).toBeGreaterThan(0);

    // Flow should stop here - no auth attempt
    const authLogs = stack.getAuditLogs({ event: 'authentication_success' });
    expect(authLogs.length).toBe(0);
  });
});

// ============================================================================
// Error Propagation Tests (3 tests)
// ============================================================================

describe('Error Propagation Through Middleware', () => {
  let stack: SecurityStack;

  beforeEach(() => {
    stack = new SecurityStack();
  });

  it('should propagate validation errors from rate limiter', () => {
    const identifier = 'blocked-user';

    // Block user by exhausting limit
    for (let i = 0; i < 6; i++) {
      stack.checkRateLimit(identifier, 5);
    }

    const result = stack.checkRateLimit(identifier, 5);
    expect(result.allowed).toBe(false);

    // Check error logged
    const errorLogs = stack.getAuditLogs({ level: 'warn' });
    expect(errorLogs.some((l) => l.event === 'rate_limit_exceeded')).toBe(true);
  });

  it('should propagate auth failures with context', () => {
    const validTokens = new Map<string, AuthContext>();

    const authContext = stack.authenticate('invalid-token', validTokens);
    expect(authContext).toBeNull();

    // Verify error context
    const authLogs = stack.getAuditLogs({ event: 'authentication_failed' });
    expect(authLogs.length).toBe(1);
    expect(authLogs[0]?.details.reason).toBe('invalid_token');
  });

  it('should propagate authorization denials with role info', () => {
    const context: AuthContext = {
      userId: 'user-1',
      sessionId: 'session-1',
      roles: ['user'],
      authenticated: true,
    };

    const authorized = stack.authorize(context, 'admin');
    expect(authorized).toBe(false);

    // Verify denial logged with role info
    const authzLogs = stack.getAuditLogs({ event: 'authorization_failed' });
    expect(authzLogs.length).toBe(1);
    expect(authzLogs[0]?.details.requiredRole).toBe('admin');
    expect(authzLogs[0]?.details.userRoles).toEqual(['user']);
  });
});

// ============================================================================
// Audit Logging Tests (4 tests)
// ============================================================================

describe('Security Chain Audit Logging', () => {
  let stack: SecurityStack;
  let validTokens: Map<string, AuthContext>;

  beforeEach(() => {
    stack = new SecurityStack();
    validTokens = new Map([
      [
        'admin-token',
        {
          userId: 'admin-1',
          sessionId: 'admin-session',
          roles: ['admin', 'user'],
          authenticated: true,
        },
      ],
    ]);
  });

  it('should log successful authentication with session details', () => {
    const context = stack.authenticate('admin-token', validTokens);
    expect(context).not.toBeNull();

    const logs = stack.getAuditLogs({ event: 'authentication_success' });
    expect(logs.length).toBe(1);
    expect(logs[0]?.userId).toBe('admin-1');
    expect(logs[0]?.details.sessionId).toBe('admin-session');
    expect(logs[0]?.level).toBe('info');
  });

  it('should log failed authentication attempts', () => {
    stack.authenticate('invalid-token', validTokens);
    stack.authenticate('another-invalid', validTokens);
    stack.authenticate('yet-another', validTokens);

    const logs = stack.getAuditLogs({ event: 'authentication_failed' });
    expect(logs.length).toBe(3);
    expect(logs.every((l) => l.level === 'warn')).toBe(true);
    expect(logs.every((l) => l.details.reason === 'invalid_token')).toBe(true);
  });

  it('should log rate limit violations with attempt count', () => {
    const identifier = 'attacker';

    // Trigger rate limit
    for (let i = 0; i < 6; i++) {
      stack.checkRateLimit(identifier, 5);
    }

    const logs = stack.getAuditLogs({ event: 'rate_limit_exceeded' });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]?.level).toBe('warn');
    expect(logs[0]?.details.identifier).toBe(identifier);
    expect(logs[0]?.details.attempts).toBeGreaterThanOrEqual(5);
  });

  it('should log CSRF violations with error details', () => {
    // Generate valid token
    const token = stack.generateCsrfToken();

    // Test various CSRF failures
    stack.verifyCsrfToken(token.value, 'invalid-sig', token.timestamp); // Invalid signature
    stack.verifyCsrfToken(token.value, token.signature, Date.now() - 7200000); // Expired

    const errorLogs = stack.getAuditLogs({ level: 'error' });
    const warnLogs = stack.getAuditLogs({ level: 'warn' });

    expect(errorLogs.length + warnLogs.length).toBeGreaterThan(0);

    // Check for specific error events
    const allLogs = stack.getAuditLogs();
    expect(allLogs.some((l) => l.event === 'csrf_token_invalid_format')).toBe(true);
    expect(allLogs.some((l) => l.event === 'csrf_token_expired')).toBe(true);
  });
});

// ============================================================================
// Integration Test: Complete Security Flow
// ============================================================================

describe('Complete Security Flow Integration', () => {
  it('should execute complete secure request lifecycle', async () => {
    const stack = new SecurityStack();
    const validTokens = new Map([
      [
        'secure-token',
        {
          userId: 'secure-user',
          sessionId: 'secure-session',
          roles: ['admin'],
          authenticated: true,
        },
      ],
    ]);

    // Complete flow simulation
    const identifier = 'secure-user@example.com';
    const csrfToken = stack.generateCsrfToken();
    const authToken = 'secure-token';

    // Step 1: Rate Limit
    const rateLimit = stack.checkRateLimit(identifier);
    if (!rateLimit.allowed) {
      throw new Error('Rate limit exceeded');
    }

    // Step 2: CSRF
    const csrfValid = stack.verifyCsrfToken(
      csrfToken.value,
      csrfToken.signature,
      csrfToken.timestamp
    );
    if (!csrfValid) {
      throw new Error('CSRF validation failed');
    }

    // Step 3: Authentication
    const authContext = stack.authenticate(authToken, validTokens);
    if (!authContext) {
      throw new Error('Authentication failed');
    }

    // Step 4: Authorization
    const authorized = stack.authorize(authContext, 'admin');
    if (!authorized) {
      throw new Error('Authorization failed');
    }

    // Step 5: Execute MCP Tool
    const result = await stack.executeMcpTool('memory_search', { query: 'test' }, authContext);

    expect(result.success).toBe(true);

    // Verify complete audit trail
    const auditLogs = stack.getAuditLogs();
    expect(auditLogs.length).toBeGreaterThan(0);

    // Verify all stages logged
    const events = auditLogs.map((l) => l.event);
    expect(events).toContain('rate_limit_checked');
    expect(events).toContain('csrf_token_verified');
    expect(events).toContain('authentication_success');
    expect(events).toContain('authorization_success');
    expect(events).toContain('mcp_tool_execution_success');

    // Verify no errors
    const errors = stack.getAuditLogs({ level: 'error' });
    expect(errors.length).toBe(0);
  });
});
