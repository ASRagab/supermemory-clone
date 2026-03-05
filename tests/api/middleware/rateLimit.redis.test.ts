import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const redisMockState = vi.hoisted(() => ({
  status: 'ready' as 'ready' | 'connecting' | 'reconnecting' | 'end',
  getValue: null as string | null,
}))

vi.mock('ioredis', () => {
  class MockRedis {
    status = redisMockState.status

    on(_event: string, _callback: (arg: unknown) => void): void {
      // No-op for tests
    }

    async disconnect(): Promise<void> {
      return Promise.resolve()
    }

    async get(_key: string): Promise<string | null> {
      return redisMockState.getValue
    }

    async set(_key: string, _value: string, ..._args: (string | number)[]): Promise<'OK' | null> {
      return 'OK'
    }

    multi() {
      return {
        incr() {
          return this
        },
        pexpireat() {
          return this
        },
        async exec() {
          return [
            [null, 1],
            [null, 1],
          ] as Array<[Error | null, unknown]>
        },
      }
    }
  }

  return { default: MockRedis }
})

import { RedisRateLimitStore } from '../../../src/api/middleware/rateLimit.js'

describe('RedisRateLimitStore JSON hardening', () => {
  const originalRedisUrl = process.env.REDIS_URL

  beforeEach(() => {
    process.env.REDIS_URL = 'redis://localhost:6379'
    redisMockState.status = 'ready'
    redisMockState.getValue = null
  })

  afterEach(async () => {
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL
    } else {
      process.env.REDIS_URL = originalRedisUrl
    }
  })

  it('should ignore malformed JSON payloads from Redis', async () => {
    redisMockState.getValue = '{not-json'
    const store = new RedisRateLimitStore()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const entry = await store.get('bad-json')
    expect(entry).toBeUndefined()

    await store.destroy()
  })

  it('should ignore JSON payloads that are not valid rate-limit entries', async () => {
    redisMockState.getValue = '"plain-string"'
    const store = new RedisRateLimitStore()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const entry = await store.get('invalid-shape')
    expect(entry).toBeUndefined()

    await store.destroy()
  })
})
