/**
 * Heuristic Classification Tests
 *
 * Ensures shared heuristics are used across services and mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { classifyMemoryTypeHeuristically } from '../../../src/services/llm/heuristics.js';
import { createMemoryService, resetMemoryService } from '../../../src/services/memory.service.js';
import { createMockProvider } from '../../../src/services/llm/mock.js';
import { resetLLMProvider } from '../../../src/services/llm/index.js';

describe('Memory Type Heuristics', () => {
  beforeEach(() => {
    resetMemoryService();
    resetLLMProvider();
  });

  afterEach(() => {
    resetMemoryService();
    resetLLMProvider();
  });

  it('should classify fixtures consistently', () => {
    const fixtures = [
      { content: 'Paris is the capital of France.', type: 'fact' },
      { content: 'The meeting happened yesterday.', type: 'event' },
      { content: 'I prefer TypeScript over JavaScript.', type: 'preference' },
      { content: 'I can build full-stack applications.', type: 'skill' },
      { content: 'Sarah is my sister and colleague.', type: 'relationship' },
      { content: 'Currently working on the API design.', type: 'context' },
      { content: 'Note: remember to update the docs.', type: 'note' },
    ] as const;

    for (const fixture of fixtures) {
      const result = classifyMemoryTypeHeuristically(fixture.content);
      expect(result.type).toBe(fixture.type);
    }
  });

  it('should match memory service classification', () => {
    const service = createMemoryService();
    const content = 'I prefer TypeScript over JavaScript.';
    const heuristic = classifyMemoryTypeHeuristically(content);

    expect(service.classifyMemoryType(content)).toBe(heuristic.type);
  });

  it('should match mock provider extraction classification', async () => {
    const provider = createMockProvider({ simulatedLatencyMs: 0 });
    const content = 'I prefer TypeScript over JavaScript.';

    const result = await provider.extractMemories(content);
    const heuristic = classifyMemoryTypeHeuristically(content);

    expect(result.memories[0]?.type).toBe(heuristic.type);
  });
});
