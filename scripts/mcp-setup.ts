#!/usr/bin/env tsx
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import pkg from 'pg';

const { Client } = pkg;

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

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function run(): Promise<void> {
  console.log('Supermemory MCP Setup\n');

  // Load .env if present
  let env: Record<string, string> = {};
  if (existsSync('.env')) {
    env = parseEnv(readFileSync('.env', 'utf-8'));
    for (const [k, v] of Object.entries(env)) {
      if (!process.env[k]) process.env[k] = v;
    }
  }

  // Step 1: Check for built MCP entry point
  const entryPoint = resolve('dist/mcp/index.js');
  if (!existsSync(entryPoint)) {
    console.log(`Build output not found at ${entryPoint}`);
    const answer = await ask('Run "npm run build" now? [Y/n] ');
    if (answer === '' || answer.toLowerCase() === 'y') {
      console.log('Building...');
      try {
        execSync('npm run build', { stdio: 'inherit' });
      } catch {
        console.error('Build failed. Fix errors and try again.');
        process.exit(1);
      }
    } else {
      console.log('Skipping build. The MCP server may not work without a build.');
    }
  } else {
    console.log('[OK] Build output found');
  }

  // Step 2: Quick Postgres connectivity check
  const databaseUrl = env.DATABASE_URL || process.env.DATABASE_URL || '';
  if (databaseUrl) {
    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      await client.query('SELECT 1');
      console.log('[OK] PostgreSQL connection successful');
    } catch (error) {
      console.log(
        `[WARN] PostgreSQL connection failed: ${error instanceof Error ? error.message : String(error)}`
      );
      console.log('       The MCP server needs Postgres at runtime. Check DATABASE_URL.');
    } finally {
      await client.end().catch(() => undefined);
    }
  } else {
    console.log('[WARN] DATABASE_URL not set. The MCP server will need it at runtime.');
  }

  // Step 3: Ask for registration scope
  const scopeAnswer = await ask('\nRegister for "user" (all projects) or "project" (this project only)? [user] ');
  const scope = scopeAnswer.toLowerCase() === 'project' ? 'project' : 'user';

  // Step 4: Register with Claude Code
  const cmd = `claude mcp add supermemory --scope ${scope} -- node ${entryPoint}`;
  console.log(`\nRunning: ${cmd}\n`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      console.error(
        '\nCould not find the "claude" CLI.\nInstall Claude Code first: https://docs.anthropic.com/en/docs/claude-code'
      );
    } else {
      console.error(`\nRegistration failed: ${msg}`);
    }
    process.exit(1);
  }

  // Step 5: Success
  console.log('\nSupermemory MCP server registered successfully!');
  console.log(`Scope: ${scope}`);
  console.log('\nVerify with:  claude mcp list');
}

run().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
