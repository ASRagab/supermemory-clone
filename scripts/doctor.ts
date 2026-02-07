#!/usr/bin/env tsx
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import pkg from 'pg';
import Redis from 'ioredis';

const { Client } = pkg;

type CheckResult = {
  ok: boolean;
  level: 'error' | 'warn' | 'info';
  message: string;
};

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
  const prefix = result.level === 'error' ? 'FAIL' : result.level === 'warn' ? 'WARN' : 'OK';
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
  if (!databaseUrl) {
    results.push({ ok: false, level: 'error', message: 'DATABASE_URL is not set' });
  } else if (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://')) {
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

  if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) {
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
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
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
