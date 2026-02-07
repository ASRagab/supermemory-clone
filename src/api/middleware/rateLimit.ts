import { Context, MiddlewareHandler } from 'hono';
import { ErrorCodes } from '../../types/api.types.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger('rate-limit');

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * Rate limit store interface for pluggable backends
 */
export interface RateLimitStore {
  get(key: string): Promise<RateLimitEntry | undefined>;
  set(key: string, entry: RateLimitEntry, ttlMs: number): Promise<void>;
  increment(key: string, windowMs: number): Promise<RateLimitEntry>;
}

/**
 * In-memory rate limit store for development/single-instance deployments
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, RateLimitEntry>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Cleanup old entries periodically
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store.entries()) {
        if (entry.resetTime <= now) {
          this.store.delete(key);
        }
      }
    }, 60 * 1000);
  }

  async get(key: string): Promise<RateLimitEntry | undefined> {
    const entry = this.store.get(key);
    if (entry && entry.resetTime > Date.now()) {
      return entry;
    }
    return undefined;
  }

  async set(key: string, entry: RateLimitEntry, _ttlMs: number): Promise<void> {
    this.store.set(key, entry);
  }

  async increment(key: string, windowMs: number): Promise<RateLimitEntry> {
    const now = Date.now();
    let entry = this.store.get(key);

    if (!entry || entry.resetTime <= now) {
      entry = {
        count: 1,
        resetTime: now + windowMs,
      };
    } else {
      entry.count++;
    }

    this.store.set(key, entry);
    return entry;
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}

/**
 * Redis rate limit store for distributed deployments
 *
 * Requires REDIS_URL environment variable to be set.
 * Falls back to memory store if Redis is not available.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private redis: RedisClient | null = null;
  private readonly keyPrefix = 'ratelimit:';
  private fallback: MemoryRateLimitStore;
  private connectionFailed = false;

  constructor() {
    this.fallback = new MemoryRateLimitStore();
    this.initRedis();
  }

  private async initRedis(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      logger.warn('REDIS_URL not set, using in-memory store');
      return;
    }

    try {
      // Dynamic import to avoid requiring ioredis in all environments
      // We catch the import error and fall back to in-memory store
      const redisModule = await import('ioredis').catch(() => {
        logger.warn('ioredis module not installed, using in-memory store');
        return null;
      });

      if (!redisModule) {
        return;
      }

      // ioredis exports the class as default - use type assertion for dynamic import
      const RedisConstructor = (redisModule.default || redisModule) as unknown as new (url: string) => RedisClient;
      const client = new RedisConstructor(redisUrl);
      this.redis = client;

      client.on('error', (err: unknown) => {
        const errMsg =
          err && typeof err === 'object' && 'message' in err
            ? (err as { message: string }).message
            : 'Unknown error';
        logger.error('Redis error', { error: errMsg });
        this.connectionFailed = true;
      });

      client.on('connect', () => {
        logger.info('Connected to Redis');
        this.connectionFailed = false;
      });

      // ioredis connects automatically on construction
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.warn('Redis connection failed, using in-memory fallback', { error: message });
      this.connectionFailed = true;
    }
  }

  private isAvailable(): boolean {
    return this.redis !== null && !this.connectionFailed && this.redis.status === 'ready';
  }

  async get(key: string): Promise<RateLimitEntry | undefined> {
    if (!this.isAvailable()) {
      return this.fallback.get(key);
    }

    try {
      const data = await this.redis!.get(this.keyPrefix + key);
      if (data) {
        return JSON.parse(data) as RateLimitEntry;
      }
      return undefined;
    } catch (err) {
      logger.error('Redis get error', { key }, err instanceof Error ? err : undefined);
      return this.fallback.get(key);
    }
  }

  async set(key: string, entry: RateLimitEntry, ttlMs: number): Promise<void> {
    if (!this.isAvailable()) {
      return this.fallback.set(key, entry, ttlMs);
    }

    try {
      await this.redis!.set(this.keyPrefix + key, JSON.stringify(entry), 'PX', ttlMs);
    } catch (err) {
      logger.error('Redis set error', { key }, err instanceof Error ? err : undefined);
      await this.fallback.set(key, entry, ttlMs);
    }
  }

  async increment(key: string, windowMs: number): Promise<RateLimitEntry> {
    if (!this.isAvailable()) {
      return this.fallback.increment(key, windowMs);
    }

    try {
      const now = Date.now();
      const redisKey = this.keyPrefix + key;

      // Use Redis MULTI/EXEC for atomic increment with expiry
      const result = await this.redis!.multi()
        .incr(redisKey)
        .pexpireat(redisKey, now + windowMs)
        .exec();

      // ioredis returns [[null, result], [null, result]] format
      const count = (result?.[0]?.[1] as number) ?? 1;

      return {
        count,
        resetTime: now + windowMs,
      };
    } catch (err) {
      logger.error('Redis increment error', { key }, err instanceof Error ? err : undefined);
      return this.fallback.increment(key, windowMs);
    }
  }

  async destroy(): Promise<void> {
    this.fallback.destroy();
    if (this.redis) {
      try {
        await this.redis.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.redis = null;
    }
  }
}

// Type for ioredis client (minimal interface)
interface RedisClient {
  status: 'ready' | 'connecting' | 'reconnecting' | 'end';
  on(event: string, callback: (arg: unknown) => void): void;
  disconnect(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<'OK' | null>;
  incr(key: string): RedisChainable;
  pexpireat(key: string, timestamp: number): RedisChainable;
  multi(): RedisChainable;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}

// Type for ioredis chainable commands
interface RedisChainable {
  incr(key: string): RedisChainable;
  pexpireat(key: string, timestamp: number): RedisChainable;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (c: Context) => string;
  store?: RateLimitStore;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100,
};

// Global store instance - uses Redis if available, falls back to memory
let globalStore: RateLimitStore | null = null;

/**
 * Get or create the global rate limit store.
 * Uses Redis if REDIS_URL is set, otherwise uses in-memory store.
 */
function getGlobalStore(): RateLimitStore {
  if (!globalStore) {
    if (process.env.REDIS_URL) {
      globalStore = new RedisRateLimitStore();
    } else {
      globalStore = new MemoryRateLimitStore();
    }
  }
  return globalStore;
}

/**
 * Rate limiting middleware.
 * Limits requests to maxRequests per windowMs per client.
 *
 * Supports Redis for distributed deployments (set REDIS_URL env var).
 * Falls back to in-memory store for single-instance deployments.
 */
export const rateLimitMiddleware = (config: Partial<RateLimitConfig> = {}): MiddlewareHandler => {
  const { windowMs, maxRequests, keyGenerator } = { ...DEFAULT_CONFIG, ...config };
  const store = config.store ?? getGlobalStore();

  return async (c: Context, next) => {
    // Generate a unique key for the client
    const key = keyGenerator ? keyGenerator(c) : getClientKey(c);

    const now = Date.now();

    // Increment counter atomically
    const entry = await store.increment(key, windowMs);

    // Calculate remaining requests and time
    const remaining = Math.max(0, maxRequests - entry.count);
    const resetSeconds = Math.ceil((entry.resetTime - now) / 1000);

    // Set rate limit headers
    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(resetSeconds));

    // Check if rate limit exceeded
    if (entry.count > maxRequests) {
      c.header('Retry-After', String(resetSeconds));

      return c.json(
        {
          error: {
            code: ErrorCodes.RATE_LIMITED,
            message: `Rate limit exceeded. Try again in ${resetSeconds} seconds`,
          },
          status: 429,
        },
        429
      );
    }

    return next();
  };
};

/**
 * Generates a unique key for rate limiting based on the client.
 * Uses API key if available, otherwise falls back to IP address.
 */
function getClientKey(c: Context): string {
  // Try to use the authenticated user's API key
  const auth = c.get('auth');
  if (auth?.apiKey) {
    return `api:${auth.apiKey}`;
  }

  // Fall back to IP address
  const forwarded = c.req.header('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown';
  return `ip:${ip}`;
}

/**
 * Creates a rate limiter with custom settings per endpoint.
 */
export const createRateLimiter = (
  maxRequests: number,
  windowMs: number = 60000
): MiddlewareHandler => {
  return rateLimitMiddleware({ maxRequests, windowMs });
};

// Pre-configured rate limiters for different use cases
export const standardRateLimit = rateLimitMiddleware(); // 100 req/min
export const strictRateLimit = rateLimitMiddleware({ maxRequests: 20 }); // 20 req/min
export const searchRateLimit = rateLimitMiddleware({ maxRequests: 50 }); // 50 req/min
export const uploadRateLimit = rateLimitMiddleware({ maxRequests: 10 }); // 10 req/min
