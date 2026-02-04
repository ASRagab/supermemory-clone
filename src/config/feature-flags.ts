/**
 * Feature Flags for Memory Service Behavior
 *
 * Defaults are local/offline-friendly: LLM and embedding paths are disabled
 * unless explicitly enabled via environment variables.
 */

const ENV_FLAGS = {
  MEMORY_ENABLE_LLM: 'MEMORY_ENABLE_LLM',
  MEMORY_ENABLE_EMBEDDINGS: 'MEMORY_ENABLE_EMBEDDINGS',
} as const;

function isFlagEnabled(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  return raw.toLowerCase() === 'true' || raw === '1';
}

export function isLLMFeatureEnabled(): boolean {
  return isFlagEnabled(ENV_FLAGS.MEMORY_ENABLE_LLM);
}

export function isEmbeddingRelationshipsEnabled(): boolean {
  return isFlagEnabled(ENV_FLAGS.MEMORY_ENABLE_EMBEDDINGS);
}

