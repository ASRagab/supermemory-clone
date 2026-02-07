import { z } from 'zod';
import { config as dotenvConfig } from 'dotenv';
import { ConfigurationError } from '../utils/errors.js';

dotenvConfig();

const configSchema = z.object({
  // OpenAI (optional - local fallback available)
  openaiApiKey: z.string().optional(),
  embeddingModel: z.string().default('text-embedding-3-small'),
  embeddingDimensions: z.coerce.number().default(1536),

  // LLM Provider Configuration
  llmProvider: z
    .enum(['openai', 'anthropic', 'mock'])
    .optional()
    .describe('LLM provider for memory extraction'),
  anthropicApiKey: z.string().optional(),
  llmModel: z.string().optional().describe('Override default model for LLM extraction'),
  llmMaxTokens: z.coerce.number().default(2000),
  llmTemperature: z.coerce.number().default(0.1),
  llmTimeoutMs: z.coerce.number().default(30000),
  llmMaxRetries: z.coerce.number().default(3),

  // LLM Caching
  llmCacheEnabled: z
    .string()
    .optional()
    .transform((val) => val !== 'false')
    .default('true'),
  llmCacheTtlMs: z.coerce.number().default(900000), // 15 minutes

  // Database
  databaseUrl: z.string().default('./data/supermemory.db'),

  // Vector Store
  vectorStoreProvider: z.enum(['memory', 'sqlite-vss', 'chroma']).default('memory'),
  vectorDimensions: z.coerce.number().default(1536),
  vectorSqlitePath: z.string().default('./data/vectors.db'),
  chromaUrl: z.string().default('http://localhost:8000'),
  chromaCollection: z.string().default('supermemory_vectors'),

  // Server
  apiPort: z.coerce.number().default(3000),
  apiHost: z.string().default('localhost'),

  // Authentication (optional for MCP mode)
  apiSecretKey: z.string().optional(),

  // Rate Limiting
  rateLimitRequests: z.coerce.number().default(100),
  rateLimitWindowMs: z.coerce.number().default(60000),

  // Logging
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof configSchema>;

function isPostgresDatabaseUrl(url: string): boolean {
  return url.startsWith('postgresql://') || url.startsWith('postgres://');
}

function loadConfig(): Config {
  const result = configSchema.safeParse({
    openaiApiKey: process.env.OPENAI_API_KEY,
    embeddingModel: process.env.EMBEDDING_MODEL,
    embeddingDimensions: process.env.EMBEDDING_DIMENSIONS,

    // LLM Provider
    llmProvider: process.env.LLM_PROVIDER,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    llmModel: process.env.LLM_MODEL,
    llmMaxTokens: process.env.LLM_MAX_TOKENS,
    llmTemperature: process.env.LLM_TEMPERATURE,
    llmTimeoutMs: process.env.LLM_TIMEOUT_MS,
    llmMaxRetries: process.env.LLM_MAX_RETRIES,
    llmCacheEnabled: process.env.LLM_CACHE_ENABLED,
    llmCacheTtlMs: process.env.LLM_CACHE_TTL_MS,

    databaseUrl: process.env.DATABASE_URL,

    // Vector Store
    vectorStoreProvider: process.env.VECTOR_STORE_PROVIDER,
    vectorDimensions: process.env.VECTOR_DIMENSIONS,
    vectorSqlitePath: process.env.VECTOR_SQLITE_PATH,
    chromaUrl: process.env.CHROMA_URL,
    chromaCollection: process.env.CHROMA_COLLECTION,

    apiPort: process.env.API_PORT,
    apiHost: process.env.API_HOST,
    apiSecretKey: process.env.API_SECRET_KEY,
    rateLimitRequests: process.env.RATE_LIMIT_REQUESTS,
    rateLimitWindowMs: process.env.RATE_LIMIT_WINDOW_MS,
    logLevel: process.env.LOG_LEVEL,
  });

  if (!result.success) {
    console.error('Configuration validation failed:');
    result.error.issues.forEach((issue) => {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    });
    const fieldErrors: Record<string, string[]> = {};
    result.error.issues.forEach((issue) => {
      const path = issue.path.join('.') || '_root';
      if (!fieldErrors[path]) {
        fieldErrors[path] = [];
      }
      fieldErrors[path].push(issue.message);
    });
    throw new ConfigurationError('Invalid configuration', undefined, { fieldErrors });
  }

  const config = result.data;

  if (process.env.NODE_ENV !== 'test' && !isPostgresDatabaseUrl(config.databaseUrl)) {
    throw new ConfigurationError(
      'DATABASE_URL must use postgres:// or postgresql:// outside tests. SQLite is only allowed when NODE_ENV=test.',
      undefined,
      {
        fieldErrors: {
          databaseUrl: [
            'DATABASE_URL must use postgres:// or postgresql:// outside tests. SQLite is only allowed when NODE_ENV=test.',
          ],
        },
      }
    );
  }

  return config;
}

export const config = loadConfig();
