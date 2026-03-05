/**
 * MCP Rate Limiter
 *
 * Provides rate limiting for MCP tool calls using the existing
 * RateLimitStore infrastructure. Supports both per-tool limits
 * and global limits per containerTag.
 */

import { RateLimitStore, MemoryRateLimitStore, RedisRateLimitStore } from '../api/middleware/rateLimit.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a rate limit check
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Remaining requests in the current window */
  remaining: number
  /** Seconds until the limit resets */
  resetIn: number
  /** The limit that applies */
  limit: number
  /** Which limit was hit (if any) */
  limitType?: 'tool' | 'global'
}

/**
 * Configuration for a rate limit
 */
export interface RateLimitConfig {
  /** Maximum requests allowed */
  maxRequests: number
  /** Time window in milliseconds */
  windowMs: number
}

/**
 * Tool-specific rate limit configurations
 */
export interface ToolLimits {
  [toolName: string]: RateLimitConfig
}

// ============================================================================
// Default Limits
// ============================================================================

/**
 * Tool-specific rate limits
 *
 * Limits are based on:
 * - Computational cost (embedding generation is expensive)
 * - Side effects (delete is destructive)
 * - Read vs write operations
 */
const DEFAULT_TOOL_LIMITS: ToolLimits = {
  // Write operations with embedding generation - most expensive
  supermemory_add: {
    maxRequests: 50,
    windowMs: 60 * 1000, // 50 req/min
  },

  // Search operations - moderately expensive
  supermemory_search: {
    maxRequests: 100,
    windowMs: 60 * 1000, // 100 req/min
  },

  // Profile operations - moderately expensive
  supermemory_profile: {
    maxRequests: 50,
    windowMs: 60 * 1000, // 50 req/min
  },

  // Remember - creates facts with potential embedding
  supermemory_remember: {
    maxRequests: 100,
    windowMs: 60 * 1000, // 100 req/min
  },

  // Recall - semantic search over facts
  supermemory_recall: {
    maxRequests: 200,
    windowMs: 60 * 1000, // 200 req/min
  },

  // List - lightweight read operation
  supermemory_list: {
    maxRequests: 200,
    windowMs: 60 * 1000, // 200 req/min
  },

  // Delete - destructive, strict limit
  supermemory_delete: {
    maxRequests: 20,
    windowMs: 60 * 1000, // 20 req/min
  },
}

/**
 * Global rate limit per containerTag
 * Applies across all tools to prevent abuse
 */
const DEFAULT_GLOBAL_LIMIT: RateLimitConfig = {
  maxRequests: 1000,
  windowMs: 15 * 60 * 1000, // 1000 req/15min
}

// ============================================================================
// MCPRateLimiter Class
// ============================================================================

/**
 * Rate limiter for MCP tool calls
 *
 * Provides two levels of rate limiting:
 * 1. Per-tool limits: Different limits for each tool based on cost
 * 2. Global limit: Overall limit per containerTag across all tools
 *
 * Uses the same store infrastructure as the API rate limiter,
 * supporting both in-memory (single instance) and Redis (distributed).
 */
export class MCPRateLimiter {
  private store: RateLimitStore
  private toolLimits: ToolLimits
  private globalLimit: RateLimitConfig
  private readonly keyPrefix = 'mcp:'

  constructor(options?: {
    store?: RateLimitStore
    toolLimits?: { [toolName: string]: RateLimitConfig }
    globalLimit?: Partial<RateLimitConfig>
  }) {
    // Initialize store - use Redis if available, fallback to memory
    this.store = options?.store ?? this.createDefaultStore()

    // Merge tool limits with defaults
    this.toolLimits = { ...DEFAULT_TOOL_LIMITS }
    if (options?.toolLimits) {
      for (const [key, value] of Object.entries(options.toolLimits)) {
        this.toolLimits[key] = value
      }
    }

    // Merge global limit with defaults
    this.globalLimit = {
      ...DEFAULT_GLOBAL_LIMIT,
      ...options?.globalLimit,
    }
  }

  /**
   * Create the default rate limit store
   * Uses Redis if REDIS_URL is set, otherwise in-memory
   */
  private createDefaultStore(): RateLimitStore {
    if (process.env.REDIS_URL) {
      return new RedisRateLimitStore()
    }
    return new MemoryRateLimitStore()
  }

  /**
   * Get the rate limit configuration for a tool
   * Returns a default configuration for unknown tools
   */
  getToolLimit(toolName: string): RateLimitConfig {
    return (
      this.toolLimits[toolName] ?? {
        maxRequests: 100,
        windowMs: 60 * 1000, // Default: 100 req/min
      }
    )
  }

  /**
   * Get the global rate limit configuration
   */
  getGlobalLimit(): RateLimitConfig {
    return this.globalLimit
  }

  /**
   * Check if a request is allowed under rate limits
   *
   * @param containerTag - The container tag (user/context identifier)
   * @param toolName - The MCP tool being called
   * @returns Rate limit result with allowed status and metadata
   */
  async checkLimit(containerTag: string, toolName: string): Promise<RateLimitResult> {
    const now = Date.now()
    const tag = containerTag || 'default'

    // Check tool-specific limit first
    const toolLimit = this.getToolLimit(toolName)
    const toolKey = `${this.keyPrefix}tool:${tag}:${toolName}`
    const toolEntry = await this.store.increment(toolKey, toolLimit.windowMs)

    const toolRemaining = Math.max(0, toolLimit.maxRequests - toolEntry.count)
    const toolResetIn = Math.ceil((toolEntry.resetTime - now) / 1000)

    if (toolEntry.count > toolLimit.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetIn: toolResetIn,
        limit: toolLimit.maxRequests,
        limitType: 'tool',
      }
    }

    // Check global limit
    const globalKey = `${this.keyPrefix}global:${tag}`
    const globalEntry = await this.store.increment(globalKey, this.globalLimit.windowMs)

    const globalRemaining = Math.max(0, this.globalLimit.maxRequests - globalEntry.count)
    const globalResetIn = Math.ceil((globalEntry.resetTime - now) / 1000)

    if (globalEntry.count > this.globalLimit.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetIn: globalResetIn,
        limit: this.globalLimit.maxRequests,
        limitType: 'global',
      }
    }

    // Request is allowed - return the more restrictive remaining count
    return {
      allowed: true,
      remaining: Math.min(toolRemaining, globalRemaining),
      resetIn: Math.min(toolResetIn, globalResetIn),
      limit: toolLimit.maxRequests,
    }
  }

  /**
   * Get current rate limit status without incrementing counters
   *
   * @param containerTag - The container tag (user/context identifier)
   * @param toolName - The MCP tool to check
   * @returns Current rate limit status
   */
  async getStatus(containerTag: string, toolName: string): Promise<RateLimitResult> {
    const now = Date.now()
    const tag = containerTag || 'default'

    // Get tool-specific status
    const toolLimit = this.getToolLimit(toolName)
    const toolKey = `${this.keyPrefix}tool:${tag}:${toolName}`
    const toolEntry = await this.store.get(toolKey)

    let toolRemaining = toolLimit.maxRequests
    let toolResetIn = 0

    if (toolEntry && toolEntry.resetTime > now) {
      toolRemaining = Math.max(0, toolLimit.maxRequests - toolEntry.count)
      toolResetIn = Math.ceil((toolEntry.resetTime - now) / 1000)
    }

    // Get global status
    const globalKey = `${this.keyPrefix}global:${tag}`
    const globalEntry = await this.store.get(globalKey)

    let globalRemaining = this.globalLimit.maxRequests
    let globalResetIn = 0

    if (globalEntry && globalEntry.resetTime > now) {
      globalRemaining = Math.max(0, this.globalLimit.maxRequests - globalEntry.count)
      globalResetIn = Math.ceil((globalEntry.resetTime - now) / 1000)
    }

    // Check if either limit is exceeded (or at capacity - next request would be blocked)
    // Use >= because when count equals maxRequests, the next request would be blocked
    if (toolEntry && toolEntry.count >= toolLimit.maxRequests && toolEntry.resetTime > now) {
      return {
        allowed: false,
        remaining: 0,
        resetIn: toolResetIn,
        limit: toolLimit.maxRequests,
        limitType: 'tool',
      }
    }

    if (globalEntry && globalEntry.count >= this.globalLimit.maxRequests && globalEntry.resetTime > now) {
      return {
        allowed: false,
        remaining: 0,
        resetIn: globalResetIn,
        limit: this.globalLimit.maxRequests,
        limitType: 'global',
      }
    }

    return {
      allowed: true,
      remaining: Math.min(toolRemaining, globalRemaining),
      resetIn: Math.max(toolResetIn, globalResetIn),
      limit: toolLimit.maxRequests,
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let rateLimiterInstance: MCPRateLimiter | null = null

/**
 * Get or create the global MCP rate limiter instance
 */
export function getMCPRateLimiter(): MCPRateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new MCPRateLimiter()
  }
  return rateLimiterInstance
}

/**
 * Create a rate limit error response for MCP
 *
 * @param result - The rate limit result
 * @param toolName - The tool that was rate limited
 * @returns MCP-compatible error response
 */
export function createRateLimitErrorResponse(
  result: RateLimitResult,
  toolName: string
): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const limitTypeMessage =
    result.limitType === 'global' ? 'Global rate limit exceeded' : `Rate limit exceeded for ${toolName}`

  return {
    content: [
      {
        type: 'text',
        text: `${limitTypeMessage}. Try again in ${result.resetIn} seconds. (Limit: ${result.limit} requests)`,
      },
    ],
    isError: true,
  }
}
