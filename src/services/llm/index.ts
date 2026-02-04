/**
 * LLM Provider Module
 *
 * Factory functions and exports for LLM-based memory extraction.
 * Provides a unified interface for multiple LLM providers.
 */

import { getLogger } from '../../utils/logger.js';
import { config as appConfig } from '../../config/index.js';
import { isLLMFeatureEnabled } from '../../config/feature-flags.js';
import type {
  LLMProvider,
  LLMProviderType,
  OpenAILLMConfig,
  AnthropicLLMConfig,
  MockLLMConfig,
  LLMConfig,
  CacheConfig,
} from './types.js';
import { OpenAILLMProvider, createOpenAIProvider } from './openai.js';
import { AnthropicLLMProvider, createAnthropicProvider } from './anthropic.js';
import { MockLLMProvider, createMockProvider } from './mock.js';

const logger = getLogger('LLMFactory');

// ============================================================================
// Re-exports
// ============================================================================

// Types
export * from './types.js';

// Base
export { BaseLLMProvider, LLMError, DEFAULT_LLM_CONFIG, DEFAULT_CACHE_CONFIG } from './base.js';

// Providers
export { OpenAILLMProvider, createOpenAIProvider } from './openai.js';
export { AnthropicLLMProvider, createAnthropicProvider } from './anthropic.js';
export { MockLLMProvider, createMockProvider } from './mock.js';

// Prompts (for testing/customization)
export {
  MEMORY_EXTRACTION_SYSTEM_PROMPT,
  MEMORY_EXTRACTION_EXAMPLES,
  RELATIONSHIP_DETECTION_SYSTEM_PROMPT,
  RELATIONSHIP_DETECTION_EXAMPLES,
  generateExtractionPrompt,
  generateRelationshipPrompt,
  parseExtractionResponse,
  parseRelationshipResponse,
} from './prompts.js';

// Specialized Services (for memory service TODOs)
export {
  MemoryClassifierService,
  getMemoryClassifier,
  resetMemoryClassifier,
} from './memory-classifier.service.js';
export type { ClassificationResult, ClassifierConfig } from './memory-classifier.service.js';

export {
  ContradictionDetectorService,
  getContradictionDetector,
  resetContradictionDetector,
} from './contradiction-detector.service.js';
export type { ContradictionResult, DetectorConfig } from './contradiction-detector.service.js';

export {
  MemoryExtensionDetectorService,
  getMemoryExtensionDetector,
  resetMemoryExtensionDetector,
} from './memory-extension-detector.service.js';
export type {
  ExtensionResult,
  ExtensionDetectorConfig,
} from './memory-extension-detector.service.js';

// ============================================================================
// Environment Variable Names
// ============================================================================

const ENV_VARS = {
  LLM_PROVIDER: 'LLM_PROVIDER',
  OPENAI_API_KEY: 'OPENAI_API_KEY',
  OPENAI_MODEL: 'OPENAI_MODEL',
  OPENAI_BASE_URL: 'OPENAI_BASE_URL',
  ANTHROPIC_API_KEY: 'ANTHROPIC_API_KEY',
  ANTHROPIC_MODEL: 'ANTHROPIC_MODEL',
  LLM_CACHE_ENABLED: 'LLM_CACHE_ENABLED',
  LLM_CACHE_TTL_MS: 'LLM_CACHE_TTL_MS',
} as const;

// ============================================================================
// Factory Configuration
// ============================================================================

export interface LLMFactoryConfig {
  /** Preferred provider type */
  provider?: LLMProviderType;

  /** OpenAI-specific config */
  openai?: Partial<OpenAILLMConfig>;

  /** Anthropic-specific config */
  anthropic?: Partial<AnthropicLLMConfig>;

  /** Mock provider config */
  mock?: MockLLMConfig;

  /** Cache configuration */
  cache?: Partial<CacheConfig>;

  /** Whether to fallback to regex if no LLM available */
  fallbackToRegex?: boolean;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an LLM provider based on configuration
 */
export function createLLMProvider(config: LLMFactoryConfig = {}): LLMProvider {
  const providerType = config.provider ?? getDefaultProviderType();

  logger.debug('Creating LLM provider', { type: providerType });

  switch (providerType) {
    case 'openai': {
      const openaiConfig = getOpenAIConfig(config);
      return createOpenAIProvider(openaiConfig);
    }

    case 'anthropic': {
      const anthropicConfig = getAnthropicConfig(config);
      return createAnthropicProvider(anthropicConfig);
    }

    case 'mock': {
      return createMockProvider(config.mock ?? {});
    }

    default: {
      logger.warn(`Unknown provider type: ${providerType}, falling back to mock`);
      return createMockProvider({});
    }
  }
}

/**
 * Get the default provider type based on available API keys
 */
export function getDefaultProviderType(): LLMProviderType {
  // Check environment variable first
  const envProvider = process.env[ENV_VARS.LLM_PROVIDER]?.toLowerCase();
  if (envProvider === 'openai' || envProvider === 'anthropic' || envProvider === 'mock') {
    return envProvider;
  }

  // Check for API keys
  const hasOpenAI = !!(process.env[ENV_VARS.OPENAI_API_KEY] || appConfig.openaiApiKey);
  const hasAnthropic = !!process.env[ENV_VARS.ANTHROPIC_API_KEY];

  if (hasOpenAI) {
    return 'openai';
  }

  if (hasAnthropic) {
    return 'anthropic';
  }

  // No API keys - return mock for graceful degradation
  logger.info('No LLM API keys found, using mock provider');
  return 'mock';
}

/**
 * Get OpenAI configuration from environment and provided config
 */
function getOpenAIConfig(factoryConfig: LLMFactoryConfig): OpenAILLMConfig {
  const apiKey =
    factoryConfig.openai?.apiKey ??
    process.env[ENV_VARS.OPENAI_API_KEY] ??
    appConfig.openaiApiKey ??
    '';

  return {
    apiKey,
    model: factoryConfig.openai?.model ?? process.env[ENV_VARS.OPENAI_MODEL] ?? 'gpt-4o-mini',
    baseUrl: factoryConfig.openai?.baseUrl ?? process.env[ENV_VARS.OPENAI_BASE_URL],
    maxTokens: factoryConfig.openai?.maxTokens ?? 2000,
    temperature: factoryConfig.openai?.temperature ?? 0.1,
    timeoutMs: factoryConfig.openai?.timeoutMs ?? 30000,
    maxRetries: factoryConfig.openai?.maxRetries ?? 3,
    retryDelayMs: factoryConfig.openai?.retryDelayMs ?? 1000,
  };
}

/**
 * Get Anthropic configuration from environment and provided config
 */
function getAnthropicConfig(factoryConfig: LLMFactoryConfig): AnthropicLLMConfig {
  const apiKey = factoryConfig.anthropic?.apiKey ?? process.env[ENV_VARS.ANTHROPIC_API_KEY] ?? '';

  return {
    apiKey,
    model:
      factoryConfig.anthropic?.model ??
      process.env[ENV_VARS.ANTHROPIC_MODEL] ??
      'claude-3-haiku-20240307',
    maxTokens: factoryConfig.anthropic?.maxTokens ?? 2000,
    temperature: factoryConfig.anthropic?.temperature ?? 0.1,
    timeoutMs: factoryConfig.anthropic?.timeoutMs ?? 30000,
    maxRetries: factoryConfig.anthropic?.maxRetries ?? 3,
    retryDelayMs: factoryConfig.anthropic?.retryDelayMs ?? 1000,
  };
}

/**
 * Check if any LLM provider is available
 */
export function isLLMAvailable(): boolean {
  if (!isLLMFeatureEnabled()) {
    return false;
  }
  const hasOpenAI = !!(process.env[ENV_VARS.OPENAI_API_KEY] || appConfig.openaiApiKey);
  const hasAnthropic = !!process.env[ENV_VARS.ANTHROPIC_API_KEY];
  return hasOpenAI || hasAnthropic;
}

/**
 * Get list of available provider types
 */
export function getAvailableProviders(): LLMProviderType[] {
  if (!isLLMFeatureEnabled()) {
    return ['mock'];
  }
  const providers: LLMProviderType[] = ['mock'];

  if (process.env[ENV_VARS.OPENAI_API_KEY] || appConfig.openaiApiKey) {
    providers.push('openai');
  }

  if (process.env[ENV_VARS.ANTHROPIC_API_KEY]) {
    providers.push('anthropic');
  }

  return providers;
}

// ============================================================================
// Singleton Instance
// ============================================================================

let _llmProviderInstance: LLMProvider | null = null;

/**
 * Get the singleton LLM provider instance
 */
export function getLLMProvider(config?: LLMFactoryConfig): LLMProvider {
  if (!_llmProviderInstance) {
    _llmProviderInstance = createLLMProvider(config);
  }
  return _llmProviderInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetLLMProvider(): void {
  _llmProviderInstance = null;
}

/**
 * Set a custom LLM provider instance (useful for testing)
 */
export function setLLMProvider(provider: LLMProvider): void {
  _llmProviderInstance = provider;
}

/**
 * Proxy-based lazy singleton for backwards compatibility
 */
export const llmProvider = new Proxy({} as LLMProvider, {
  get(_, prop) {
    return getLLMProvider()[prop as keyof LLMProvider];
  },
});
