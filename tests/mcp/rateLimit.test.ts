/**
 * MCP Rate Limiting Test Suite
 *
 * Comprehensive tests for MCP tool-specific rate limiting functionality.
 * Tests tool-specific limits, container tag isolation, global limits,
 * rate limit reset, response format, Redis fallback, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MCPRateLimiter, createRateLimitErrorResponse, type RateLimitResult } from '../../src/mcp/rateLimit.js'
import { MemoryRateLimitStore } from '../../src/api/middleware/rateLimit.js'

// ============================================================================
// Test Suite
// ============================================================================

describe('MCP Rate Limiting', () => {
  let store: MemoryRateLimitStore
  let rateLimiter: MCPRateLimiter

  beforeEach(() => {
    store = new MemoryRateLimitStore()
    rateLimiter = new MCPRateLimiter({ store })
  })

  afterEach(() => {
    store.destroy()
  })

  // ==========================================================================
  // 1. getToolLimit
  // ==========================================================================

  describe('getToolLimit', () => {
    it('should return configured limits for known tools', () => {
      const addLimit = rateLimiter.getToolLimit('supermemory_add')
      expect(addLimit.maxRequests).toBe(50)
      expect(addLimit.windowMs).toBe(60 * 1000)

      const searchLimit = rateLimiter.getToolLimit('supermemory_search')
      expect(searchLimit.maxRequests).toBe(100)

      const deleteLimit = rateLimiter.getToolLimit('supermemory_delete')
      expect(deleteLimit.maxRequests).toBe(20)

      const recallLimit = rateLimiter.getToolLimit('supermemory_recall')
      expect(recallLimit.maxRequests).toBe(200)

      const listLimit = rateLimiter.getToolLimit('supermemory_list')
      expect(listLimit.maxRequests).toBe(200)

      const rememberLimit = rateLimiter.getToolLimit('supermemory_remember')
      expect(rememberLimit.maxRequests).toBe(100)

      const profileLimit = rateLimiter.getToolLimit('supermemory_profile')
      expect(profileLimit.maxRequests).toBe(50)
    })

    it('should return default limits for unknown tools', () => {
      const unknownLimit = rateLimiter.getToolLimit('unknown_tool')
      expect(unknownLimit.maxRequests).toBe(100)
      expect(unknownLimit.windowMs).toBe(60 * 1000)
    })
  })

  // ==========================================================================
  // 2. getGlobalLimit
  // ==========================================================================

  describe('getGlobalLimit', () => {
    it('should return the global limit configuration', () => {
      const globalLimit = rateLimiter.getGlobalLimit()
      expect(globalLimit.maxRequests).toBe(1000)
      expect(globalLimit.windowMs).toBe(15 * 60 * 1000)
    })
  })

  // ==========================================================================
  // 3. Tool-specific rate limits
  // ==========================================================================

  describe('Tool-specific rate limits', () => {
    it('should respect supermemory_add limit of 50 req/min', async () => {
      const containerTag = 'test-user'

      // Make 50 requests - all should be allowed
      for (let i = 0; i < 50; i++) {
        const result = await rateLimiter.checkLimit(containerTag, 'supermemory_add')
        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(49 - i)
      }

      // 51st request should be blocked
      const blockedResult = await rateLimiter.checkLimit(containerTag, 'supermemory_add')
      expect(blockedResult.allowed).toBe(false)
      expect(blockedResult.remaining).toBe(0)
      expect(blockedResult.limit).toBe(50)
      expect(blockedResult.limitType).toBe('tool')
    })

    it('should respect supermemory_delete limit of 20 req/min (strictest)', async () => {
      const containerTag = 'test-user'

      // Make 20 requests - all should be allowed
      for (let i = 0; i < 20; i++) {
        const result = await rateLimiter.checkLimit(containerTag, 'supermemory_delete')
        expect(result.allowed).toBe(true)
      }

      // 21st request should be blocked
      const blockedResult = await rateLimiter.checkLimit(containerTag, 'supermemory_delete')
      expect(blockedResult.allowed).toBe(false)
      expect(blockedResult.limit).toBe(20)
    })

    it('should respect supermemory_recall limit of 200 req/min (most lenient)', async () => {
      const containerTag = 'test-user'

      // Make 200 requests - all should be allowed
      for (let i = 0; i < 200; i++) {
        const result = await rateLimiter.checkLimit(containerTag, 'supermemory_recall')
        expect(result.allowed).toBe(true)
      }

      // 201st request should be blocked
      const blockedResult = await rateLimiter.checkLimit(containerTag, 'supermemory_recall')
      expect(blockedResult.allowed).toBe(false)
      expect(blockedResult.limit).toBe(200)
    })

    it('should apply correct limits to each tool type', async () => {
      const containerTag = 'test-user'
      const expectedLimits: Record<string, number> = {
        supermemory_add: 50,
        supermemory_delete: 20,
        supermemory_recall: 200,
        supermemory_search: 100,
        supermemory_remember: 100,
        supermemory_profile: 50,
        supermemory_list: 200,
      }

      for (const [toolName, expectedLimit] of Object.entries(expectedLimits)) {
        // Create a fresh rate limiter for each tool test
        const freshStore = new MemoryRateLimitStore()
        const freshLimiter = new MCPRateLimiter({ store: freshStore })

        const result = await freshLimiter.checkLimit(containerTag, toolName)
        expect(result.limit).toBe(expectedLimit)
        expect(result.remaining).toBe(expectedLimit - 1)

        freshStore.destroy()
      }
    })
  })

  // ==========================================================================
  // 4. Container tag isolation
  // ==========================================================================

  describe('Container tag isolation', () => {
    it('should isolate rate limits between different containerTags', async () => {
      const user1 = 'user-1'
      const user2 = 'user-2'

      // Exhaust user-1's limit for supermemory_delete (20 req/min)
      for (let i = 0; i < 20; i++) {
        await rateLimiter.checkLimit(user1, 'supermemory_delete')
      }

      // User-1 should be blocked
      const user1Result = await rateLimiter.checkLimit(user1, 'supermemory_delete')
      expect(user1Result.allowed).toBe(false)

      // User-2 should still be allowed
      const user2Result = await rateLimiter.checkLimit(user2, 'supermemory_delete')
      expect(user2Result.allowed).toBe(true)
      expect(user2Result.remaining).toBe(19)
    })

    it('should maintain independent counters for each containerTag', async () => {
      const tags = ['user-1', 'user-2', 'user-3']

      // Each user makes 5 requests
      for (const tag of tags) {
        for (let i = 0; i < 5; i++) {
          await rateLimiter.checkLimit(tag, 'supermemory_add')
        }
      }

      // Verify each user has their own counter
      for (const tag of tags) {
        const status = await rateLimiter.getStatus(tag, 'supermemory_add')
        expect(status.remaining).toBe(45) // 50 - 5 = 45
      }
    })

    it('should use default containerTag when not provided', async () => {
      const result = await rateLimiter.checkLimit('', 'supermemory_add')
      expect(result.allowed).toBe(true)
    })
  })

  // ==========================================================================
  // 5. Global rate limit
  // ==========================================================================

  describe('Global rate limit', () => {
    it('should enforce global limit per containerTag across all tools', async () => {
      const containerTag = 'test-user'

      // Create a limiter with a very low global limit for testing
      const testStore = new MemoryRateLimitStore()
      const testLimiter = new MCPRateLimiter({
        store: testStore,
        globalLimit: { maxRequests: 10, windowMs: 60 * 1000 },
      })

      // Make 10 requests across different tools
      for (let i = 0; i < 10; i++) {
        const tool = i % 2 === 0 ? 'supermemory_search' : 'supermemory_list'
        const result = await testLimiter.checkLimit(containerTag, tool)
        expect(result.allowed).toBe(true)
      }

      // 11th request should be blocked by global limit
      const blockedResult = await testLimiter.checkLimit(containerTag, 'supermemory_add')
      expect(blockedResult.allowed).toBe(false)
      expect(blockedResult.limitType).toBe('global')

      testStore.destroy()
    })

    it('should block before tool limit if global limit exceeded', async () => {
      const containerTag = 'test-user'

      // Low global limit, high tool limit
      const testStore = new MemoryRateLimitStore()
      const testLimiter = new MCPRateLimiter({
        store: testStore,
        globalLimit: { maxRequests: 5, windowMs: 60 * 1000 },
      })

      // Make 5 requests - all should pass
      for (let i = 0; i < 5; i++) {
        const result = await testLimiter.checkLimit(containerTag, 'supermemory_recall')
        expect(result.allowed).toBe(true)
      }

      // 6th request blocked by global limit (tool limit would allow 200)
      const blockedResult = await testLimiter.checkLimit(containerTag, 'supermemory_recall')
      expect(blockedResult.allowed).toBe(false)
      expect(blockedResult.limitType).toBe('global')

      testStore.destroy()
    })

    it('should count all tool calls toward global limit', async () => {
      const containerTag = 'test-user'

      const testStore = new MemoryRateLimitStore()
      const testLimiter = new MCPRateLimiter({
        store: testStore,
        globalLimit: { maxRequests: 12, windowMs: 60 * 1000 },
      })

      // Make requests across multiple tools
      const tools = [
        'supermemory_add',
        'supermemory_search',
        'supermemory_delete',
        'supermemory_recall',
        'supermemory_list',
        'supermemory_remember',
      ]

      // 2 requests per tool = 12 total
      for (const tool of tools) {
        await testLimiter.checkLimit(containerTag, tool)
        await testLimiter.checkLimit(containerTag, tool)
      }

      // Any additional request should be blocked
      const blockedResult = await testLimiter.checkLimit(containerTag, 'supermemory_search')
      expect(blockedResult.allowed).toBe(false)
      expect(blockedResult.limitType).toBe('global')

      testStore.destroy()
    })
  })

  // ==========================================================================
  // 6. Rate limit reset
  // ==========================================================================

  describe('Rate limit reset', () => {
    it('should reset counter after window expires', async () => {
      const containerTag = 'test-user'

      // Use a very short window for testing
      const testStore = new MemoryRateLimitStore()
      const testLimiter = new MCPRateLimiter({
        store: testStore,
        toolLimits: {
          supermemory_add: { maxRequests: 2, windowMs: 100 }, // 100ms window
        },
      })

      // Exhaust the limit
      await testLimiter.checkLimit(containerTag, 'supermemory_add')
      await testLimiter.checkLimit(containerTag, 'supermemory_add')
      const blockedResult = await testLimiter.checkLimit(containerTag, 'supermemory_add')
      expect(blockedResult.allowed).toBe(false)

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Should be allowed again
      const allowedResult = await testLimiter.checkLimit(containerTag, 'supermemory_add')
      expect(allowedResult.allowed).toBe(true)
      expect(allowedResult.remaining).toBe(1)

      testStore.destroy()
    })

    it('should provide accurate resetIn time', async () => {
      const containerTag = 'test-user'

      const windowMs = 5000 // 5 second window
      const testStore = new MemoryRateLimitStore()
      const testLimiter = new MCPRateLimiter({
        store: testStore,
        toolLimits: {
          supermemory_add: { maxRequests: 1, windowMs },
        },
      })

      // Make a request to start the window
      const result = await testLimiter.checkLimit(containerTag, 'supermemory_add')

      // resetIn should be approximately windowMs in seconds
      expect(result.resetIn).toBeGreaterThan(0)
      expect(result.resetIn).toBeLessThanOrEqual(Math.ceil(windowMs / 1000))

      testStore.destroy()
    })
  })

  // ==========================================================================
  // 7. Rate limit response format
  // ==========================================================================

  describe('Rate limit response format', () => {
    it('should return allowed: false when limited', async () => {
      const containerTag = 'test-user'

      const testStore = new MemoryRateLimitStore()
      const testLimiter = new MCPRateLimiter({
        store: testStore,
        toolLimits: {
          supermemory_add: { maxRequests: 1, windowMs: 60 * 1000 },
        },
      })

      // First request allowed
      const allowed = await testLimiter.checkLimit(containerTag, 'supermemory_add')
      expect(allowed.allowed).toBe(true)

      // Second request blocked
      const blocked = await testLimiter.checkLimit(containerTag, 'supermemory_add')
      expect(blocked.allowed).toBe(false)

      testStore.destroy()
    })

    it('should return correct remaining count', async () => {
      const containerTag = 'test-user'
      const maxRequests = 10

      const testStore = new MemoryRateLimitStore()
      const testLimiter = new MCPRateLimiter({
        store: testStore,
        toolLimits: {
          supermemory_add: { maxRequests, windowMs: 60 * 1000 },
        },
      })

      for (let i = 0; i < maxRequests + 2; i++) {
        const result = await testLimiter.checkLimit(containerTag, 'supermemory_add')

        if (i < maxRequests) {
          expect(result.remaining).toBe(maxRequests - 1 - i)
        } else {
          expect(result.remaining).toBe(0)
        }
      }

      testStore.destroy()
    })

    it('should include limit value in response', async () => {
      const containerTag = 'test-user'

      const result = await rateLimiter.checkLimit(containerTag, 'supermemory_add')
      expect(result.limit).toBe(50)

      const deleteResult = await rateLimiter.checkLimit(containerTag, 'supermemory_delete')
      expect(deleteResult.limit).toBe(20)

      const recallResult = await rateLimiter.checkLimit(containerTag, 'supermemory_recall')
      expect(recallResult.limit).toBe(200)
    })

    it('should include limitType when blocked', async () => {
      const containerTag = 'test-user'

      // Exhaust delete limit
      for (let i = 0; i < 20; i++) {
        await rateLimiter.checkLimit(containerTag, 'supermemory_delete')
      }

      const blocked = await rateLimiter.checkLimit(containerTag, 'supermemory_delete')
      expect(blocked.allowed).toBe(false)
      expect(blocked.limitType).toBe('tool')
    })
  })

  // ==========================================================================
  // 8. getStatus (non-incrementing)
  // ==========================================================================

  describe('getStatus', () => {
    it('should return current status without incrementing counter', async () => {
      const containerTag = 'test-user'

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        await rateLimiter.checkLimit(containerTag, 'supermemory_add')
      }

      // Get status (should not increment)
      const status1 = await rateLimiter.getStatus(containerTag, 'supermemory_add')
      expect(status1.remaining).toBe(45) // 50 - 5

      // Get status again (should still be 45)
      const status2 = await rateLimiter.getStatus(containerTag, 'supermemory_add')
      expect(status2.remaining).toBe(45)
    })

    it('should report blocked status when limit exceeded', async () => {
      const containerTag = 'test-user'

      // Exhaust limit
      for (let i = 0; i < 20; i++) {
        await rateLimiter.checkLimit(containerTag, 'supermemory_delete')
      }

      const status = await rateLimiter.getStatus(containerTag, 'supermemory_delete')
      expect(status.allowed).toBe(false)
      expect(status.limitType).toBe('tool')
    })
  })

  // ==========================================================================
  // 9. Custom configuration
  // ==========================================================================

  describe('Custom configuration', () => {
    it('should accept custom tool limits', async () => {
      const customLimiter = new MCPRateLimiter({
        store,
        toolLimits: {
          supermemory_add: { maxRequests: 5, windowMs: 60 * 1000 },
        },
      })

      const limit = customLimiter.getToolLimit('supermemory_add')
      expect(limit.maxRequests).toBe(5)

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        const result = await customLimiter.checkLimit('test', 'supermemory_add')
        expect(result.allowed).toBe(true)
      }

      // 6th should be blocked
      const result = await customLimiter.checkLimit('test', 'supermemory_add')
      expect(result.allowed).toBe(false)
    })

    it('should accept custom global limit', () => {
      const customLimiter = new MCPRateLimiter({
        store,
        globalLimit: { maxRequests: 500, windowMs: 30 * 60 * 1000 },
      })

      const globalLimit = customLimiter.getGlobalLimit()
      expect(globalLimit.maxRequests).toBe(500)
      expect(globalLimit.windowMs).toBe(30 * 60 * 1000)
    })
  })

  // ==========================================================================
  // 10. Edge cases
  // ==========================================================================

  describe('Edge cases', () => {
    it('should handle empty containerTag', async () => {
      const result = await rateLimiter.checkLimit('', 'supermemory_add')
      expect(result.allowed).toBe(true)
      expect(result.limit).toBe(50)
    })

    it('should use default limit for unknown tool name', async () => {
      const containerTag = 'test-user'

      const result = await rateLimiter.checkLimit(containerTag, 'unknown_tool')
      expect(result.allowed).toBe(true)
      expect(result.limit).toBe(100) // Default limit
    })

    it('should handle special characters in containerTag', async () => {
      const specialTags = ['user@email.com', 'user:123', 'user/path', 'user-with-dashes']

      for (const tag of specialTags) {
        const result = await rateLimiter.checkLimit(tag, 'supermemory_add')
        expect(result.allowed).toBe(true)
      }
    })

    it('should handle very long containerTag', async () => {
      const longTag = 'a'.repeat(1000)
      const result = await rateLimiter.checkLimit(longTag, 'supermemory_add')
      expect(result.allowed).toBe(true)
    })

    it('should handle rapid sequential requests', async () => {
      const containerTag = 'test-user'

      const testStore = new MemoryRateLimitStore()
      const testLimiter = new MCPRateLimiter({
        store: testStore,
        toolLimits: {
          supermemory_add: { maxRequests: 100, windowMs: 60 * 1000 },
        },
      })

      // Rapid fire 100 requests
      const startTime = Date.now()
      for (let i = 0; i < 100; i++) {
        const result = await testLimiter.checkLimit(containerTag, 'supermemory_add')
        expect(result.allowed).toBe(true)
      }
      const elapsed = Date.now() - startTime

      // Should complete quickly (under 1 second for in-memory)
      expect(elapsed).toBeLessThan(1000)

      // 101st request should be blocked
      const blocked = await testLimiter.checkLimit(containerTag, 'supermemory_add')
      expect(blocked.allowed).toBe(false)

      testStore.destroy()
    })
  })
})

// ============================================================================
// createRateLimitErrorResponse Tests
// ============================================================================

describe('createRateLimitErrorResponse', () => {
  it('should create error response for tool limit', () => {
    const result: RateLimitResult = {
      allowed: false,
      remaining: 0,
      resetIn: 45,
      limit: 50,
      limitType: 'tool',
    }

    const response = createRateLimitErrorResponse(result, 'supermemory_add')

    expect(response.isError).toBe(true)
    expect(response.content).toHaveLength(1)
    expect(response.content[0].type).toBe('text')
    expect(response.content[0].text).toContain('supermemory_add')
    expect(response.content[0].text).toContain('45 seconds')
    expect(response.content[0].text).toContain('50 requests')
  })

  it('should create error response for global limit', () => {
    const result: RateLimitResult = {
      allowed: false,
      remaining: 0,
      resetIn: 120,
      limit: 1000,
      limitType: 'global',
    }

    const response = createRateLimitErrorResponse(result, 'supermemory_search')

    expect(response.isError).toBe(true)
    expect(response.content[0].text).toContain('Global rate limit exceeded')
    expect(response.content[0].text).toContain('120 seconds')
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('MCP Rate Limiting Integration', () => {
  let store: MemoryRateLimitStore
  let rateLimiter: MCPRateLimiter

  beforeEach(() => {
    store = new MemoryRateLimitStore()
    rateLimiter = new MCPRateLimiter({ store })
  })

  afterEach(() => {
    store.destroy()
  })

  it('should simulate realistic MCP tool usage pattern', async () => {
    const containerTag = 'workspace-1'

    // Simulate typical usage: search -> add -> remember -> recall
    const operations = [
      { tool: 'supermemory_search', count: 10 },
      { tool: 'supermemory_add', count: 5 },
      { tool: 'supermemory_remember', count: 3 },
      { tool: 'supermemory_recall', count: 20 },
    ]

    for (const op of operations) {
      for (let i = 0; i < op.count; i++) {
        const result = await rateLimiter.checkLimit(containerTag, op.tool)
        expect(result.allowed).toBe(true)
      }
    }

    // Verify individual tool remaining counts
    const searchStatus = await rateLimiter.getStatus(containerTag, 'supermemory_search')
    expect(searchStatus.remaining).toBe(90) // 100 - 10

    const addStatus = await rateLimiter.getStatus(containerTag, 'supermemory_add')
    expect(addStatus.remaining).toBe(45) // 50 - 5

    const rememberStatus = await rateLimiter.getStatus(containerTag, 'supermemory_remember')
    expect(rememberStatus.remaining).toBe(97) // 100 - 3

    const recallStatus = await rateLimiter.getStatus(containerTag, 'supermemory_recall')
    expect(recallStatus.remaining).toBe(180) // 200 - 20
  })

  it('should handle multi-tenant scenario', async () => {
    const tenants = ['org-1', 'org-2', 'org-3']

    // Each tenant has different usage patterns
    const usagePatterns: Record<string, Array<{ tool: string; count: number }>> = {
      'org-1': [
        { tool: 'supermemory_search', count: 50 },
        { tool: 'supermemory_add', count: 30 },
      ],
      'org-2': [
        { tool: 'supermemory_recall', count: 100 },
        { tool: 'supermemory_delete', count: 15 },
      ],
      'org-3': [
        { tool: 'supermemory_remember', count: 25 },
        { tool: 'supermemory_profile', count: 20 },
      ],
    }

    // Apply usage patterns
    for (const tenant of tenants) {
      for (const op of usagePatterns[tenant]) {
        for (let i = 0; i < op.count; i++) {
          await rateLimiter.checkLimit(tenant, op.tool)
        }
      }
    }

    // Verify isolation
    const org1Status = await rateLimiter.getStatus('org-1', 'supermemory_search')
    expect(org1Status.remaining).toBe(50) // 100 - 50

    const org2Status = await rateLimiter.getStatus('org-2', 'supermemory_search')
    expect(org2Status.remaining).toBe(100) // Never used search

    const org3Status = await rateLimiter.getStatus('org-3', 'supermemory_search')
    expect(org3Status.remaining).toBe(100) // Never used search
  })

  it('should enforce stricter tool limits before global limit', async () => {
    const containerTag = 'heavy-deleter'

    // supermemory_delete has the strictest limit (20/min)
    // Make 20 delete requests
    for (let i = 0; i < 20; i++) {
      const result = await rateLimiter.checkLimit(containerTag, 'supermemory_delete')
      expect(result.allowed).toBe(true)
    }

    // 21st delete should be blocked by tool limit (not global)
    const blocked = await rateLimiter.checkLimit(containerTag, 'supermemory_delete')
    expect(blocked.allowed).toBe(false)
    expect(blocked.limit).toBe(20) // Tool limit, not global
    expect(blocked.limitType).toBe('tool')

    // Other tools should still work
    const searchResult = await rateLimiter.checkLimit(containerTag, 'supermemory_search')
    expect(searchResult.allowed).toBe(true)
  })
})
