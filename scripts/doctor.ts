#!/usr/bin/env tsx
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import pkg from 'pg';
import Redis from 'ioredis';
import { loadEnvFile } from '../src/config/env.js';
import { findClaudeMcpRegistrations } from './claude-mcp-config.js';

const { Client } = pkg;
type RedisLike = {
  on(event: 'error', listener: (error: unknown) => void): void;
  ping(): Promise<string>;
  quit(): Promise<'OK' | void>;
};

type CheckResult = {
  ok: boolean;
  level: 'error' | 'warn' | 'info';
  message: string;
};

type DoctorMode = 'agent' | 'api' | 'full';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseEnv(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    env[key] = value;
  }
  return env;
}

function printResult(result: CheckResult): void {
  const levelPrefix: Record<CheckResult['level'], string> = {
    error: 'FAIL',
    warn: 'WARN',
    info: 'OK',
  };
  const prefix = levelPrefix[result.level];
  console.log(`[${prefix}] ${result.message}`);
}

function validateMode(mode: string): DoctorMode {
  if (mode === 'agent' || mode === 'api' || mode === 'full') {
    return mode;
  }

  throw new Error(`Invalid mode: ${mode} (expected: agent, api, or full)`);
}

function getApiHealthUrl(env: Record<string, string>): string {
  const apiHostPort = env.API_HOST_PORT || env.API_PORT || '13000';
  return `http://127.0.0.1:${apiHostPort}/health`;
}

async function checkApiHealth(env: Record<string, string>): Promise<CheckResult> {
  const healthUrl = getApiHealthUrl(env);
  let lastError = 'unknown error';

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        return { ok: true, level: 'info', message: `API health endpoint reachable: ${healthUrl}` };
      }

      lastError = `returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < 10) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  return {
    ok: false,
    level: 'error',
    message: `API health check failed: ${healthUrl} (${lastError})`,
  };
}

function parseArgs(): { envFile?: string; mode: DoctorMode } {
  const args = process.argv.slice(2);
  let envFile: string | undefined;
  let mode: DoctorMode = 'agent';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--env-file') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('--env-file requires a value');
      }
      envFile = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--env-file=')) {
      envFile = arg.slice('--env-file='.length);
      continue;
    }

    if (arg === '--mode') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('--mode requires a value');
      }
      mode = validateMode(value.toLowerCase());
      index += 1;
      continue;
    }

    if (arg.startsWith('--mode=')) {
      mode = validateMode(arg.slice('--mode='.length).toLowerCase());
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { envFile, mode };
}

async function run(): Promise<void> {
  const { envFile, mode } = parseArgs();
  const results: CheckResult[] = [];
  const envResolution = loadEnvFile({ cliEnvFile: envFile });

  if (!envResolution.exists || !existsSync(envResolution.path)) {
    results.push({
      ok: false,
      level: 'error',
      message: `${envResolution.path} is missing (run \`npm run setup\` first or pass \`--env-file\`)`,
    });
    printResult(results[0]);
    process.exit(1);
  }

  results.push({
    ok: true,
    level: 'info',
    message: `Using env file: ${envResolution.path}`,
  });
  results.push({
    ok: true,
    level: 'info',
    message: `Doctor mode: ${mode}`,
  });

  const env = parseEnv(await readFile(envResolution.path, 'utf-8'));
  const openaiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
  const anthropicKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
  const llmProvider = env.LLM_PROVIDER || process.env.LLM_PROVIDER || '';
  const hasOpenAIKey = !!openaiKey && !openaiKey.startsWith('sk-your-');
  const hasAnthropicKey = !!anthropicKey && anthropicKey !== 'anthropic-your-api-key-here';

  const databaseUrl = env.DATABASE_URL || process.env.DATABASE_URL || '';
  const hasValidDatabaseUrl =
    databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://');
  if (!databaseUrl) {
    results.push({ ok: false, level: 'error', message: 'DATABASE_URL is not set' });
  } else if (!hasValidDatabaseUrl) {
    results.push({
      ok: false,
      level: 'error',
      message: 'DATABASE_URL must use postgres:// or postgresql://',
    });
  } else {
    results.push({ ok: true, level: 'info', message: 'DATABASE_URL format is valid' });
  }

  const authEnabled = (env.AUTH_ENABLED || 'false') === 'true';
  if (authEnabled) {
    const token = env.AUTH_TOKEN || '';
    if (token.length < 16) {
      results.push({
        ok: false,
        level: 'error',
        message: 'AUTH_ENABLED=true requires AUTH_TOKEN with at least 16 characters',
      });
    } else {
      results.push({ ok: true, level: 'info', message: 'AUTH configuration is valid' });
    }
  } else {
    results.push({
      ok: true,
      level: 'info',
      message: 'REST API auth disabled (AUTH_ENABLED=false)',
    });
  }

  const apiPort = Number(env.API_PORT || 3000);
  if (!Number.isInteger(apiPort) || apiPort <= 0 || apiPort > 65535) {
    results.push({ ok: false, level: 'error', message: 'API_PORT must be a valid TCP port' });
  } else {
    results.push({ ok: true, level: 'info', message: `API_PORT=${apiPort}` });
  }

  if (hasValidDatabaseUrl) {
    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      await client.query('SELECT 1');
      results.push({ ok: true, level: 'info', message: 'PostgreSQL connection successful' });
    } catch (error) {
      results.push({
        ok: false,
        level: 'error',
        message: `PostgreSQL connection failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  const redisUrl = env.REDIS_URL || process.env.REDIS_URL || '';
  if (!redisUrl) {
    results.push({
      ok: true,
      level: 'warn',
      message: 'REDIS_URL is unset; queue workers disabled, inline ingestion fallback will be used',
    });
  } else {
    const RedisClientConstructor = Redis as unknown as new (
      url: string,
      options: { maxRetriesPerRequest: number }
    ) => RedisLike;
    const redis = new RedisClientConstructor(redisUrl, { maxRetriesPerRequest: 1 });
    redis.on('error', () => undefined);
    try {
      const pong = await redis.ping();
      results.push({
        ok: pong === 'PONG',
        level: pong === 'PONG' ? 'info' : 'error',
        message: pong === 'PONG' ? 'Redis connection successful' : 'Redis ping failed',
      });
    } catch (error) {
      results.push({
        ok: false,
        level: 'warn',
        message: `Redis connection failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      await redis.quit().catch(() => undefined);
    }
  }

  const hasMcpBuild = existsSync('dist/mcp/index.js');
  const hasApiBuild = existsSync('dist/index.js');

  if (mode === 'agent' || mode === 'full') {
    if (hasMcpBuild) {
      results.push({ ok: true, level: 'info', message: 'MCP server build exists (dist/mcp/index.js)' });
    } else {
      results.push({
        ok: false,
        level: 'error',
        message: 'MCP server build is missing for agent/full mode (run `npm run build` first)',
      });
    }
  } else if (hasMcpBuild) {
    results.push({ ok: true, level: 'info', message: 'MCP server build exists (dist/mcp/index.js)' });
  } else {
    results.push({
      ok: true,
      level: 'warn',
      message: 'MCP server build not found (optional for API-only validation)',
    });
  }

  if (mode === 'api' || mode === 'full') {
    if (hasApiBuild) {
      results.push({ ok: true, level: 'info', message: 'API server build exists (dist/index.js)' });
    } else {
      results.push({
        ok: false,
        level: 'error',
        message: 'API server build is missing for api/full mode (run `npm run build` first)',
      });
    }

    results.push(await checkApiHealth(env));
  } else if (hasApiBuild) {
    results.push({ ok: true, level: 'info', message: 'API server build exists (dist/index.js)' });
  } else {
    results.push({
      ok: true,
      level: 'warn',
      message: 'API server build not found (optional for agent-only validation)',
    });
  }

  // .mcp.json check
  if (existsSync('.mcp.json')) {
    try {
      const mcpConfig = JSON.parse(await readFile('.mcp.json', 'utf-8')) as unknown;
      const mcpServers = isRecord(mcpConfig) && isRecord(mcpConfig.mcpServers) ? mcpConfig.mcpServers : null;
      if (mcpServers && isRecord(mcpServers.supermemory)) {
        results.push({ ok: true, level: 'info', message: '.mcp.json is valid with supermemory server configured' });
      } else {
        results.push({ ok: true, level: 'warn', message: '.mcp.json exists but missing supermemory server config' });
      }
    } catch {
      results.push({ ok: false, level: 'warn', message: '.mcp.json exists but is not valid JSON' });
    }
  } else {
    results.push({ ok: true, level: 'warn', message: '.mcp.json not found (optional for project-scope Claude auto-discovery)' });
  }

  // Claude Code MCP registration check
  try {
    const registrations = findClaudeMcpRegistrations('supermemory');
    if (registrations.length > 0) {
      const scopes = [...new Set(registrations.map((entry) => entry.scope))].join(', ');
      results.push({ ok: true, level: 'info', message: `MCP server registered in Claude Code (${scopes} scope)` });
    } else {
      results.push({
        ok: true,
        level: 'warn',
        message: 'MCP server not registered in Claude Code (optional; run `npm run mcp:setup` if you want Claude integration)',
      });
    }
  } catch {
    results.push({
      ok: true,
      level: 'warn',
      message: 'Claude Code config could not be inspected (optional for MCP registration check)',
    });
  }

  // Embedding API key check
  if (hasOpenAIKey) {
    results.push({ ok: true, level: 'info', message: 'OPENAI_API_KEY is configured' });
  } else if (hasAnthropicKey) {
    results.push({ ok: true, level: 'info', message: 'ANTHROPIC_API_KEY is configured' });
  } else if (llmProvider === 'openai' || llmProvider === 'anthropic') {
    results.push({
      ok: true,
      level: 'warn',
      message: `LLM_PROVIDER=${llmProvider} is set but no real provider key is configured; local fallback behavior will be used`,
    });
  } else {
    results.push({
      ok: true,
      level: 'warn',
      message: 'No provider API keys are configured (embeddings and LLM features will use local fallback behavior)',
    });
  }

  console.log('\nConfiguration checks:\n');
  results.forEach(printResult);

  const hasErrors = results.some((r) => !r.ok && r.level === 'error');
  if (hasErrors) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error('Doctor failed:', error);
  process.exit(1);
});
