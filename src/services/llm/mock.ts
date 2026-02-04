/**
 * Mock LLM Provider
 *
 * A testing provider that returns predefined responses or generates
 * simple rule-based extractions. Useful for testing without API calls.
 */

import { getLogger } from '../../utils/logger.js';
import { BaseLLMProvider, LLMError } from './base.js';
import type {
  MockLLMConfig,
  LLMProviderType,
  ExtractedMemory,
  DetectedRelationship,
  ExtractionOptions,
  RelationshipDetectionOptions,
} from './types.js';
import { LLMErrorCode } from './types.js';
import type { MemoryType, Entity } from '../../types/index.js';

const logger = getLogger('MockProvider');

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_MOCK_CONFIG: MockLLMConfig = {
  maxTokens: 2000,
  temperature: 0.1,
  timeoutMs: 1000,
  maxRetries: 1,
  retryDelayMs: 100,
  simulatedLatencyMs: 100,
  simulateErrors: false,
  errorRate: 0.1,
};

// ============================================================================
// Rule-Based Extraction Patterns
// ============================================================================

const TYPE_PATTERNS: Array<{ pattern: RegExp; type: MemoryType }> = [
  { pattern: /\b(?:prefer|like|love|enjoy|hate|dislike|favorite)\b/i, type: 'preference' },
  { pattern: /\b(?:can|able to|know how to|expert|skilled|proficient)\b/i, type: 'skill' },
  { pattern: /\b(?:happened|occurred|event|meeting|yesterday|tomorrow)\b/i, type: 'event' },
  {
    pattern: /\b(?:married|spouse|friend|colleague|works for|works with)\b/i,
    type: 'relationship',
  },
  { pattern: /\b(?:currently|right now|working on|in progress)\b/i, type: 'context' },
  { pattern: /\b(?:note|reminder|todo|remember to)\b/i, type: 'note' },
  { pattern: /\b(?:is|are|was|were|has|have)\b/i, type: 'fact' },
];

const ENTITY_PATTERNS: Array<{ pattern: RegExp; type: Entity['type'] }> = [
  { pattern: /\b(?:Mr\.|Mrs\.|Ms\.|Dr\.)\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g, type: 'person' },
  { pattern: /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g, type: 'person' },
  { pattern: /\b(?:Inc\.|Corp\.|LLC|Ltd\.|Company)\b/gi, type: 'organization' },
  { pattern: /\b(?:Google|Microsoft|Apple|Amazon|Meta)\b/gi, type: 'organization' },
  { pattern: /\b(?:New York|London|Paris|Tokyo|San Francisco)\b/gi, type: 'place' },
  { pattern: /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, type: 'date' },
];

// ============================================================================
// Mock Provider Implementation
// ============================================================================

export class MockLLMProvider extends BaseLLMProvider {
  readonly type: LLMProviderType = 'mock';

  private readonly mockResponses?: ExtractedMemory[][];
  private readonly mockJsonResponses?: Array<string | Record<string, unknown>>;
  private readonly simulatedLatencyMs: number;
  private readonly simulateErrors: boolean;
  private readonly errorRate: number;
  private responseIndex: number = 0;
  private jsonResponseIndex: number = 0;
  private lastJsonTask?: { systemPrompt: string; userPrompt: string };

  constructor(config: MockLLMConfig = {}) {
    super({
      ...DEFAULT_MOCK_CONFIG,
      ...config,
    });

    this.mockResponses = config.mockResponses;
    this.mockJsonResponses = config.mockJsonResponses;
    this.simulatedLatencyMs = config.simulatedLatencyMs ?? DEFAULT_MOCK_CONFIG.simulatedLatencyMs!;
    this.simulateErrors = config.simulateErrors ?? DEFAULT_MOCK_CONFIG.simulateErrors!;
    this.errorRate = config.errorRate ?? DEFAULT_MOCK_CONFIG.errorRate!;

    logger.debug('Mock provider initialized', {
      hasMockResponses: !!this.mockResponses,
      simulatedLatencyMs: this.simulatedLatencyMs,
      simulateErrors: this.simulateErrors,
    });
  }

  // ============================================================================
  // Availability Check
  // ============================================================================

  isAvailable(): boolean {
    return true; // Mock is always available
  }

  // ============================================================================
  // Memory Extraction
  // ============================================================================

  protected async doExtractMemories(
    text: string,
    options: ExtractionOptions
  ): Promise<{
    memories: ExtractedMemory[];
    rawResponse?: string;
    tokensUsed?: { prompt: number; completion: number; total: number };
  }> {
    // Simulate latency
    await this.simulateLatency();

    // Simulate errors if configured
    if (this.simulateErrors && Math.random() < this.errorRate) {
      throw new LLMError('Simulated error', LLMErrorCode.PROVIDER_UNAVAILABLE, 'mock', true);
    }

    // Return mock responses if provided
    if (this.mockResponses && this.mockResponses.length > 0) {
      const memories = this.mockResponses[this.responseIndex % this.mockResponses.length]!;
      this.responseIndex++;
      return {
        memories,
        rawResponse: JSON.stringify({ memories }),
        tokensUsed: { prompt: 100, completion: 50, total: 150 },
      };
    }

    // Generate rule-based extraction
    const memories = this.ruleBasedExtraction(text, options);

    return {
      memories,
      rawResponse: JSON.stringify({ memories }),
      tokensUsed: {
        prompt: Math.ceil(text.length / 4),
        completion: memories.length * 50,
        total: Math.ceil(text.length / 4) + memories.length * 50,
      },
    };
  }

  // ============================================================================
  // Relationship Detection
  // ============================================================================

  protected async doDetectRelationships(
    newMemory: { id: string; content: string; type: MemoryType },
    existingMemories: Array<{ id: string; content: string; type: MemoryType }>,
    options: RelationshipDetectionOptions
  ): Promise<{
    relationships: DetectedRelationship[];
    supersededMemoryIds: string[];
  }> {
    // Simulate latency
    await this.simulateLatency();

    // Simulate errors if configured
    if (this.simulateErrors && Math.random() < this.errorRate) {
      throw new LLMError('Simulated error', LLMErrorCode.PROVIDER_UNAVAILABLE, 'mock', true);
    }

    // Simple rule-based relationship detection
    const relationships: DetectedRelationship[] = [];
    const supersededMemoryIds: string[] = [];

    for (const existing of existingMemories) {
      const similarity = this.calculateSimilarity(newMemory.content, existing.content);

      if (similarity < 0.3) {
        continue;
      }

      // Check for update indicators
      const updatePatterns = [/now|actually|instead|changed|updated/i];
      const isUpdate = updatePatterns.some((p) => p.test(newMemory.content));

      if (isUpdate && similarity > 0.5) {
        relationships.push({
          sourceMemoryId: newMemory.id,
          targetMemoryId: existing.id,
          type: 'updates',
          confidence: similarity,
          reason: 'Content suggests update to existing information',
        });
        supersededMemoryIds.push(existing.id);
        continue;
      }

      // Check for extension indicators
      const extensionPatterns = [/also|additionally|furthermore|moreover/i];
      const isExtension = extensionPatterns.some((p) => p.test(newMemory.content));

      if (isExtension && similarity > 0.4) {
        relationships.push({
          sourceMemoryId: newMemory.id,
          targetMemoryId: existing.id,
          type: 'extends',
          confidence: similarity,
          reason: 'Content extends existing information',
        });
        continue;
      }

      // Default to related if similar enough
      if (similarity >= (options.minConfidence ?? 0.5)) {
        relationships.push({
          sourceMemoryId: newMemory.id,
          targetMemoryId: existing.id,
          type: 'related',
          confidence: similarity,
          reason: 'Semantically related content',
        });
      }
    }

    // Apply limits
    const maxRels = options.maxRelationships ?? relationships.length;
    return {
      relationships: relationships.slice(0, maxRels),
      supersededMemoryIds,
    };
  }

  // ============================================================================
  // Generic JSON Task
  // ============================================================================

  protected async doGenerateJson(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{
    rawResponse: string;
    tokensUsed?: { prompt: number; completion: number; total: number };
  }> {
    await this.simulateLatency();

    if (this.simulateErrors && Math.random() < this.errorRate) {
      throw new LLMError('Simulated error', LLMErrorCode.PROVIDER_UNAVAILABLE, 'mock', true);
    }

    this.lastJsonTask = { systemPrompt, userPrompt };

    if (this.mockJsonResponses && this.mockJsonResponses.length > 0) {
      const response =
        this.mockJsonResponses[this.jsonResponseIndex % this.mockJsonResponses.length]!;
      this.jsonResponseIndex++;
      const rawResponse = typeof response === 'string' ? response : JSON.stringify(response);
      return {
        rawResponse,
        tokensUsed: { prompt: 80, completion: 40, total: 120 },
      };
    }

    return {
      rawResponse: JSON.stringify({ ok: true }),
      tokensUsed: { prompt: 80, completion: 40, total: 120 },
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private async simulateLatency(): Promise<void> {
    if (this.simulatedLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulatedLatencyMs));
    }
  }

  private ruleBasedExtraction(text: string, options: ExtractionOptions): ExtractedMemory[] {
    // Split into sentences
    const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length >= 10);

    const memories: ExtractedMemory[] = [];
    const maxMemories = options.maxMemories ?? 10;

    for (const sentence of sentences) {
      if (memories.length >= maxMemories) {
        break;
      }

      const type = this.classifyType(sentence);
      const entities = this.extractEntities(sentence);
      const keywords = this.extractKeywords(sentence);
      const confidence = this.calculateConfidence(sentence, type);

      if (options.minConfidence && confidence < options.minConfidence) {
        continue;
      }

      memories.push({
        content: sentence.trim(),
        type,
        confidence,
        entities,
        keywords,
      });
    }

    return memories;
  }

  private classifyType(text: string): MemoryType {
    for (const { pattern, type } of TYPE_PATTERNS) {
      if (pattern.test(text)) {
        return type;
      }
    }
    return 'note';
  }

  private extractEntities(text: string): Entity[] {
    const entities: Entity[] = [];
    const seen = new Set<string>();

    for (const { pattern, type } of ENTITY_PATTERNS) {
      const matches = text.matchAll(new RegExp(pattern.source, pattern.flags));
      for (const match of matches) {
        const name = match[0].trim();
        const normalized = name.toLowerCase();

        if (!seen.has(normalized) && name.length > 1) {
          seen.add(normalized);
          entities.push({
            name,
            type,
            mentions: 1,
          });
        }
      }
    }

    return entities;
  }

  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'from',
      'as',
      'is',
      'was',
      'are',
      'were',
      'been',
      'be',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'shall',
      'can',
      'need',
      'it',
      'this',
      'that',
      'these',
      'those',
      'i',
      'you',
      'he',
      'she',
      'we',
      'they',
      'my',
      'your',
      'his',
      'her',
      'our',
      'their',
      'its',
    ]);

    const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    const keywords = words.filter((word) => !stopWords.has(word));

    return [...new Set(keywords)].slice(0, 10);
  }

  private calculateConfidence(text: string, type: MemoryType): number {
    let confidence = 0.6;

    // Longer sentences with more detail
    if (text.length > 100) confidence += 0.1;
    if (text.length > 200) confidence += 0.1;

    // Type-specific patterns boost confidence
    for (const { pattern, type: patternType } of TYPE_PATTERNS) {
      if (patternType === type && pattern.test(text)) {
        confidence += 0.1;
        break;
      }
    }

    return Math.min(confidence, 0.95);
  }

  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  // ============================================================================
  // Test Helpers
  // ============================================================================

  /**
   * Set mock responses for testing
   */
  setMockResponses(responses: ExtractedMemory[][]): void {
    (this as unknown as { mockResponses: ExtractedMemory[][] }).mockResponses = responses;
    this.responseIndex = 0;
  }

  /**
   * Reset response index
   */
  resetResponseIndex(): void {
    this.responseIndex = 0;
    this.jsonResponseIndex = 0;
  }

  /**
   * Get current response index
   */
  getResponseIndex(): number {
    return this.responseIndex;
  }

  /**
   * Get last JSON task prompts (for testing)
   */
  getLastJsonTask(): { systemPrompt: string; userPrompt: string } | undefined {
    return this.lastJsonTask;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a mock LLM provider
 */
export function createMockProvider(config: MockLLMConfig = {}): MockLLMProvider {
  return new MockLLMProvider(config);
}
