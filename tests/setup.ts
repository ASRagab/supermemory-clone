/**
 * Vitest Test Setup
 *
 * Global test configuration and setup for all tests.
 */

import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'

// Global test timeout
vi.setConfig({ testTimeout: 10000 })

// Mock environment variables for tests
beforeAll(() => {
  // Ensure consistent test environment
  process.env.NODE_ENV = 'test'

  // Disable auth so CSRF and other middleware tests aren't blocked
  process.env.AUTH_ENABLED = 'false'

  // Ensure no OpenAI API key for embedding tests (use local embeddings)
  delete process.env.OPENAI_API_KEY

  // PostgreSQL test connection string
  if (!process.env.TEST_POSTGRES_URL) {
    process.env.TEST_POSTGRES_URL = 'postgresql://supermemory:supermemory_secret@localhost:5432/supermemory'
  }

  // Set DATABASE_URL to PostgreSQL for all tests
  process.env.DATABASE_URL =
    process.env.TEST_POSTGRES_URL || 'postgresql://supermemory:supermemory_secret@localhost:5432/supermemory'

  // Allow CSRF requests without Origin/Referer headers in test environment
  process.env.CSRF_ALLOW_MISSING_ORIGIN = 'true'
})

afterAll(() => {
  // Cleanup after all tests
  vi.restoreAllMocks()
})

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  // Cleanup after each test
})

// Global test utilities
export const createMockDate = (dateString: string): Date => new Date(dateString)

export const waitFor = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// Assertion helpers
export const expectToBeWithinRange = (value: number, min: number, max: number): void => {
  if (value < min || value > max) {
    throw new Error(`Expected ${value} to be within range [${min}, ${max}]`)
  }
}
