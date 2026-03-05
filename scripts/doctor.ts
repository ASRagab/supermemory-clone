#!/usr/bin/env tsx
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import pkg from 'pg';
import Redis from 'ioredis';

const { Client } = pkg;
type RedisLike = {
  ping(): Promise<string>;
  quit(): Promise<'OK' | void>;
};

type CheckResult = {
  ok: boolean;
  level: 'error' | 'warn' | 'info';
  message: string;
};

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

async function run(): Promise<void> {
  const results: CheckResult[] = [];

  if (!existsSync('.env')) {
    results.push({
      ok: false,
      level: 'error',
      message: '.env is missing (run `npm run setup` first)',
    });
    printResult(results[0]);
    process.exit(1);
  }

  const env = parseEnv(await readFile('.env', 'utf-8'));

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

  // MCP build check
  if (existsSync('dist/mcp/index.js')) {
    results.push({ ok: true, level: 'info', message: 'MCP server build exists (dist/mcp/index.js)' });
  } else {
    results.push({
      ok: true,
      level: 'warn',
      message: 'MCP server not built (run `npm run build` first)',
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
    results.push({ ok: true, level: 'warn', message: '.mcp.json not found (optional for Claude Code auto-discovery)' });
  }

  // Claude Code MCP registration check
  try {
    const mcpList = execSync('claude mcp list 2>/dev/null', { encoding: 'utf-8', timeout: 5000 });
    if (mcpList.includes('supermemory')) {
      results.push({ ok: true, level: 'info', message: 'MCP server registered in Claude Code' });
    } else {
      results.push({
        ok: true,
        level: 'warn',
        message: 'MCP server not registered in Claude Code (run `npm run mcp:setup`)',
      });
    }
  } catch {
    results.push({
      ok: true,
      level: 'warn',
      message: 'Claude Code CLI not available (optional for MCP registration check)',
    });
  }

  // Embedding API key check
  const openaiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
  if (openaiKey && !openaiKey.startsWith('sk-your-')) {
    results.push({ ok: true, level: 'info', message: 'OPENAI_API_KEY is configured' });
  } else {
    results.push({
      ok: true,
      level: 'warn',
      message: 'OPENAI_API_KEY not set (embeddings and LLM features will be unavailable)',
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
