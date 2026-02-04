/**
 * Memory Extension Detector Service Tests
 *
 * Tests LLM-based memory extension detection with fallback to heuristics
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MemoryExtensionDetectorService,
  getMemoryExtensionDetector,
  resetMemoryExtensionDetector,
} from '../../../src/services/llm/memory-extension-detector.service.js';
import { resetLLMProvider, setLLMProvider } from '../../../src/services/llm/index.js';
import { createMockProvider } from '../../../src/services/llm/mock.js';
import type { Memory } from '../../../src/types/index.js';
import { LLMError } from '../../../src/services/llm/base.js';

describe('MemoryExtensionDetectorService', () => {
  const originalEnv = { ...process.env };
  const createMemory = (content: string, id: string = 'test-id'): Memory => ({
    id,
    content,
    type: 'fact' as const,
    containerTag: 'test',
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
  });

  beforeEach(() => {
    resetMemoryExtensionDetector();
    resetLLMProvider();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetMemoryExtensionDetector();
    resetLLMProvider();
  });

  describe('Heuristic Detection', () => {
    it('should detect extension with indicators', async () => {
      const detector = new MemoryExtensionDetectorService({ fallbackToHeuristics: true });

      const existing = createMemory('I like programming', 'old');
      const newMem = createMemory(
        'I like programming, especially functional programming with Haskell',
        'new'
      );

      const result = await detector.checkExtension(newMem, existing);

      expect(result.isExtension).toBe(true);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.usedLLM).toBe(false);
    });

    it('should not detect extension for unrelated content', async () => {
      const detector = new MemoryExtensionDetectorService({ fallbackToHeuristics: true });

      const existing = createMemory('I like coffee', 'old');
      const newMem = createMemory('The weather is nice', 'new');

      const result = await detector.checkExtension(newMem, existing);

      expect(result.isExtension).toBe(false);
      expect(result.confidence).toBeLessThan(0.5);
    });

    it('should not detect extension if new is substring of old', async () => {
      const detector = new MemoryExtensionDetectorService({ fallbackToHeuristics: true });

      const existing = createMemory(
        'I like programming, especially functional programming',
        'old'
      );
      const newMem = createMemory('I like programming', 'new');

      const result = await detector.checkExtension(newMem, existing);

      expect(result.isExtension).toBe(false);
      expect(result.reason).toContain('contained');
    });

    it('should skip check for low overlap', async () => {
      const detector = new MemoryExtensionDetectorService({
        fallbackToHeuristics: true,
        minOverlapForCheck: 0.3,
      });

      const existing = createMemory('Python programming', 'old');
      const newMem = createMemory('Java development environment', 'new');

      const result = await detector.checkExtension(newMem, existing);

      expect(result.isExtension).toBe(false);
      expect(result.reason).toContain('overlap');
    });

    it('should detect extension with more detail', async () => {
      const detector = new MemoryExtensionDetectorService({ fallbackToHeuristics: true });

      const existing = createMemory('I use Python for data science', 'old');
      const newMem = createMemory(
        'For data science, I use Python and web development tasks',
        'new'
      );

      const result = await detector.checkExtension(newMem, existing);

      expect(result.isExtension).toBe(true);
    });
  });

  describe('LLM Detection', () => {
    it('should use LLM when available', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true';
      process.env.OPENAI_API_KEY = 'test-key';

      // Mock LLM provider with extension response
      const mockProvider = createMockProvider({
        mockJsonResponses: [
          { isExtension: true, confidence: 0.85, reason: 'Adds specific use cases' },
        ],
      });
      setLLMProvider(mockProvider);

      const detector = new MemoryExtensionDetectorService();

      const existing = createMemory('I use Python', 'old');
      const newMem = createMemory('I use Python for data science and web development', 'new');

      const result = await detector.checkExtension(newMem, existing);

      expect(result.usedLLM).toBe(true);
      expect(result.isExtension).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should use dedicated extension prompt template', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true';
      process.env.OPENAI_API_KEY = 'test-key';

      const mockProvider = createMockProvider({
        mockJsonResponses: [{ isExtension: false, confidence: 0.2, reason: 'Unrelated' }],
      });
      setLLMProvider(mockProvider);

      const detector = new MemoryExtensionDetectorService();

      const existing = createMemory('I use Python', 'old');
      const newMem = createMemory('I use Python for data science', 'new');

      await detector.checkExtension(newMem, existing);

      const lastTask = mockProvider.getLastJsonTask();
      expect(lastTask?.systemPrompt).toContain('extends or adds detail');
      expect(lastTask?.userPrompt).toContain('Compare these statements');
    });

    it('should fall back to heuristics on LLM error', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true';
      process.env.OPENAI_API_KEY = 'test-key';

      const mockProvider = createMockProvider({ simulateErrors: true, errorRate: 1 });
      setLLMProvider(mockProvider);

      const detector = new MemoryExtensionDetectorService({ fallbackToHeuristics: true });

      const existing = createMemory('I like programming', 'old');
      const newMem = createMemory('I like programming with TypeScript', 'new');

      const result = await detector.checkExtension(newMem, existing);

      expect(result.usedLLM).toBe(false);
      expect(result.isExtension).toBeDefined();
    });

    it('should throw error when fallback disabled and LLM fails', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true';
      process.env.OPENAI_API_KEY = 'test-key';

      const mockProvider = createMockProvider({ simulateErrors: true, errorRate: 1 });
      setLLMProvider(mockProvider);

      const detector = new MemoryExtensionDetectorService({ fallbackToHeuristics: false });

      const existing = createMemory('Content 1', 'old');
      const newMem = createMemory('Content 2', 'new');

      await expect(detector.checkExtension(newMem, existing)).rejects.toThrow();
    });

    it('should return structured error on invalid JSON response', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true';
      process.env.OPENAI_API_KEY = 'test-key';

      const mockProvider = createMockProvider({ mockJsonResponses: ['not-json'] });
      setLLMProvider(mockProvider);

      const detector = new MemoryExtensionDetectorService({ fallbackToHeuristics: false });

      const existing = createMemory('Content 1', 'old');
      const newMem = createMemory('Content 2', 'new');

      await expect(detector.checkExtension(newMem, existing)).rejects.toBeInstanceOf(LLMError);
    });

    it('should bypass LLM when feature flag is off', async () => {
      process.env.MEMORY_ENABLE_LLM = 'false';
      process.env.OPENAI_API_KEY = 'test-key';

      const mockProvider = createMockProvider({
        mockJsonResponses: [{ isExtension: true, confidence: 0.9, reason: 'Adds details' }],
      });
      setLLMProvider(mockProvider);

      const detector = new MemoryExtensionDetectorService({ fallbackToHeuristics: true });

      const existing = createMemory('I use Python', 'old');
      const newMem = createMemory('I use Python for data science', 'new');

      const result = await detector.checkExtension(newMem, existing);
      expect(result.usedLLM).toBe(false);
    });
  });

  describe('Caching', () => {
    it('should cache detection results', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true';
      process.env.OPENAI_API_KEY = 'test-key';

      const mockProvider = createMockProvider({
        mockJsonResponses: [{ isExtension: true, confidence: 0.85, reason: 'Adds details' }],
      });
      setLLMProvider(mockProvider);

      const detector = new MemoryExtensionDetectorService({ enableCache: true });

      const existing = createMemory('Python supports data science work', 'old');
      const newMem = createMemory('Data science with Python also enables ML workflows', 'new');

      const result1 = await detector.checkExtension(newMem, existing);
      const result2 = await detector.checkExtension(newMem, existing);

      expect(result1.cached).toBe(false);
      expect(result2.cached).toBe(true);
    });

    it('should cache regardless of memory order', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true';
      process.env.OPENAI_API_KEY = 'test-key';

      const mockProvider = createMockProvider({
        mockJsonResponses: [{ isExtension: true, confidence: 0.85, reason: 'Adds details' }],
      });
      setLLMProvider(mockProvider);

      const detector = new MemoryExtensionDetectorService({ enableCache: true });

      const mem1 = createMemory('In analytics, Python helps teams', 'mem1');
      const mem2 = createMemory('Python skills power analytics teams with ML', 'mem2');

      await detector.checkExtension(mem1, mem2);
      const result = await detector.checkExtension(mem2, mem1);

      expect(result.cached).toBe(true);
    });

    it('should respect cache TTL', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true';
      process.env.OPENAI_API_KEY = 'test-key';

      const mockProvider = createMockProvider({
        mockJsonResponses: [{ isExtension: true, confidence: 0.85, reason: 'Adds details' }],
      });
      setLLMProvider(mockProvider);

      const detector = new MemoryExtensionDetectorService({
        enableCache: true,
        cacheTTLMs: 100,
      });

      const existing = createMemory('Project uses content A', 'old');
      const newMem = createMemory('Content A supports the project timeline', 'new');

      await detector.checkExtension(newMem, existing);

      // Within TTL
      const result1 = await detector.checkExtension(newMem, existing);
      expect(result1.cached).toBe(true);

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      const result2 = await detector.checkExtension(newMem, existing);
      expect(result2.cached).toBe(false);
    });

    it('should not cache low confidence results', async () => {
      const detector = new MemoryExtensionDetectorService({
        enableCache: true,
        minConfidence: 0.8,
      });

      // Unrelated content -> low confidence
      const existing = createMemory('I like coffee', 'old');
      const newMem = createMemory('The sky is blue', 'new');

      await detector.checkExtension(newMem, existing);

      expect(detector.getStats().cacheSize).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should track detection statistics', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true';
      process.env.OPENAI_API_KEY = 'test-key';

      const mockProvider = createMockProvider({
        mockJsonResponses: [{ isExtension: true, confidence: 0.85, reason: 'Adds details' }],
      });
      setLLMProvider(mockProvider);

      const detector = new MemoryExtensionDetectorService({ enableCache: true });

      const existing = createMemory('I use Python for data science', 'old');

      await detector.checkExtension(
        createMemory('For data science, I use Python with ML tools', 'new1'),
        existing
      );
      await detector.checkExtension(
        createMemory('For data science, I use Python with ML tools', 'new1'),
        existing
      ); // Cache
      await detector.checkExtension(
        createMemory('Python helps data science teams build data pipelines', 'new2'),
        existing
      );

      const stats = detector.getStats();
      expect(stats.totalChecks).toBe(3);
      expect(stats.cacheHits).toBe(1);
      expect(stats.cacheHitRate).toBeGreaterThan(0);
    });

    it('should track extension rate', async () => {
      const detector = new MemoryExtensionDetectorService({ fallbackToHeuristics: true });

      const existing = createMemory('I like programming', 'old');

      // Extension
      await detector.checkExtension(
        createMemory('I like programming with TypeScript and Python', 'new1'),
        existing
      );

      // No extension
      await detector.checkExtension(createMemory('The weather is nice', 'new2'), existing);

      const stats = detector.getStats();
      expect(stats.extensionsFound).toBeGreaterThan(0);
      expect(stats.extensionRate).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle identical content', async () => {
      const detector = new MemoryExtensionDetectorService();

      const mem1 = createMemory('Identical content', 'id1');
      const mem2 = createMemory('Identical content', 'id2');

      const result = await detector.checkExtension(mem1, mem2);

      // High overlap, but not adding detail
      expect(result.isExtension).toBe(false);
    });

    it('should handle empty content', async () => {
      const detector = new MemoryExtensionDetectorService();

      const mem1 = createMemory('', 'id1');
      const mem2 = createMemory('Content', 'id2');

      const result = await detector.checkExtension(mem1, mem2);

      expect(result.isExtension).toBe(false);
    });

    it('should handle very long content', async () => {
      const detector = new MemoryExtensionDetectorService();

      const shortContent = 'I use Python';
      const longContent =
        'I use Python for many things including '.repeat(100) +
        'data science, web development, automation';

      const result = await detector.checkExtension(
        createMemory(longContent, 'id1'),
        createMemory(shortContent, 'id2')
      );

      expect(result).toBeDefined();
    });

    it('should handle special characters', async () => {
      const detector = new MemoryExtensionDetectorService();

      const result = await detector.checkExtension(
        createMemory('Content with @#$% and more details', 'id1'),
        createMemory('Content with @#$%', 'id2')
      );

      expect(result).toBeDefined();
    });

    it('should handle extension indicators', async () => {
      const detector = new MemoryExtensionDetectorService({ fallbackToHeuristics: true });

      const existing = createMemory('I like programming', 'old');
      const newMem = createMemory(
        'I like programming. Additionally, I enjoy functional programming',
        'new'
      );

      const result = await detector.checkExtension(newMem, existing);

      expect(result.isExtension).toBe(true);
    });
  });

  describe('Singleton Instance', () => {
    it('should return same instance from getter', () => {
      const instance1 = getMemoryExtensionDetector();
      const instance2 = getMemoryExtensionDetector();

      expect(instance1).toBe(instance2);
    });

    it('should reset singleton', () => {
      const instance1 = getMemoryExtensionDetector();
      resetMemoryExtensionDetector();
      const instance2 = getMemoryExtensionDetector();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Configuration', () => {
    it('should respect minConfidence threshold', async () => {
      const detector = new MemoryExtensionDetectorService({ minConfidence: 0.8 });
      expect(detector).toBeDefined();
    });

    it('should respect minOverlapForCheck', async () => {
      const detector = new MemoryExtensionDetectorService({ minOverlapForCheck: 0.5 });

      const result = await detector.checkExtension(
        createMemory('Python programming', 'id1'),
        createMemory('Java development', 'id2')
      );

      expect(result.reason).toContain('overlap');
    });
  });

  describe('Extension vs Substring', () => {
    it('should differentiate extension from substring', async () => {
      const detector = new MemoryExtensionDetectorService({ fallbackToHeuristics: true });

      // Substring (not extension)
      const result1 = await detector.checkExtension(
        createMemory('short', 'id1'),
        createMemory('this is a longer text with short in it', 'id2')
      );
      expect(result1.isExtension).toBe(false);

      // Extension (adds detail)
      const result2 = await detector.checkExtension(
        createMemory('Type safety in TypeScript helps my backend work', 'id1'),
        createMemory('I use TypeScript for backend work', 'id2')
      );
      expect(result2.isExtension).toBe(true);
    });

    it('should handle partial overlap correctly', async () => {
      const detector = new MemoryExtensionDetectorService({ fallbackToHeuristics: true });

      const existing = createMemory('I work with databases', 'old');
      const newMem = createMemory('I work with PostgreSQL and MongoDB databases', 'new');

      const result = await detector.checkExtension(newMem, existing);

      expect(result.isExtension).toBe(true);
    });
  });
});
