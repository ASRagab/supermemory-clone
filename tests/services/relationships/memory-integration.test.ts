/**
 * Tests for EnhancedMemoryService feature-flag defaults
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('EnhancedMemoryService feature flags', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('should disable embedding detection by default', async () => {
    delete process.env.MEMORY_ENABLE_EMBEDDINGS;
    vi.resetModules();

    const { DEFAULT_ENHANCED_CONFIG } = await import(
      '../../../src/services/relationships/memory-integration.js'
    );

    expect(DEFAULT_ENHANCED_CONFIG.useEmbeddingDetection).toBe(false);
    expect(DEFAULT_ENHANCED_CONFIG.autoIndexMemories).toBe(false);
  });

  it('should enable embedding detection when flag is on', async () => {
    process.env.MEMORY_ENABLE_EMBEDDINGS = 'true';
    vi.resetModules();

    const { DEFAULT_ENHANCED_CONFIG } = await import(
      '../../../src/services/relationships/memory-integration.js'
    );

    expect(DEFAULT_ENHANCED_CONFIG.useEmbeddingDetection).toBe(true);
    expect(DEFAULT_ENHANCED_CONFIG.autoIndexMemories).toBe(true);
  });
});

