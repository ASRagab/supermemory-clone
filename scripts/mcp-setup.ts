#!/usr/bin/env tsx
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { delimiter, resolve } from 'node:path';
import pkg from 'pg';
import { loadEnvFile } from '../src/config/env.js';
import {
  checkClaudeMcpRegistration,
  type ClaudeMcpScope,
} from './claude-mcp-config.js';

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

function validateScope(scope: string): ClaudeMcpScope {
  if (scope === 'user' || scope === 'project' || scope === 'local') {
    return scope;
  }

  throw new Error(`Invalid scope: ${scope} (expected: user, project, or local)`);
}

function formatRegistrationCommand(scope: ClaudeMcpScope, entryPoint: string): string {
  return `claude mcp add supermemory --scope ${scope} -- node ${JSON.stringify(entryPoint)}`;
}

function formatRemovalCommand(scope: ClaudeMcpScope): string {
  return `claude mcp remove --scope ${scope} supermemory`;
}

function createCommandEnv(): NodeJS.ProcessEnv {
  const preferredPaths = [`${homedir()}/.local/bin`, '/usr/local/bin'];
  const currentPath = process.env.PATH ?? '';
  const mergedPath = [...preferredPaths, currentPath]
    .filter(Boolean)
    .join(delimiter);

  return {
    ...process.env,
    PATH: mergedPath,
  };
}

function commandExists(name: string): boolean {
  try {
    execSync(`command -v ${name}`, {
      env: createCommandEnv(),
      stdio: 'ignore',
      shell: '/bin/zsh',
    });
    return true;
  } catch {
    return false;
  }
}

function askScope(): Promise<ClaudeMcpScope> {
  return ask('\nRegister for "user", "project", or "local" scope? [user] ').then((answer) => {
    const normalized = answer.toLowerCase();
    if (!normalized) return 'user';
    return validateScope(normalized);
  });
}

function parseArgs(): {
  envFile?: string;
  nonInteractive: boolean;
  registerMcp: boolean;
  scope?: ClaudeMcpScope;
  skipMcp: boolean;
} {
  const args = process.argv.slice(2);
  let envFile: string | undefined;
  let nonInteractive = false;
  let registerMcp = false;
  let scope: ClaudeMcpScope | undefined;
  let skipMcp = false;

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

    if (arg === '--scope') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('--scope requires a value');
      }
      scope = validateScope(value.toLowerCase());
      index += 1;
      continue;
    }

    if (arg.startsWith('--scope=')) {
      scope = validateScope(arg.slice('--scope='.length).toLowerCase());
      continue;
    }

    if (arg === '--register-mcp') {
      registerMcp = true;
      continue;
    }

    if (arg === '--skip-mcp' || arg === '--skip-claude') {
      skipMcp = true;
      continue;
    }

    if (arg === '--non-interactive') {
      nonInteractive = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { envFile, scope, registerMcp, skipMcp, nonInteractive };
}

async function run(): Promise<void> {
  const { envFile, nonInteractive, registerMcp, scope, skipMcp } = parseArgs();
  console.log('Supermemory MCP Setup\n');

  // Load .env if present
  let env: Record<string, string> = {};
  const envResolution = loadEnvFile({ cliEnvFile: envFile });
  if (envResolution.exists && existsSync(envResolution.path)) {
    env = parseEnv(readFileSync(envResolution.path, 'utf-8'));
    for (const [k, v] of Object.entries(env)) {
      if (!process.env[k]) process.env[k] = v;
    }
    console.log(`[OK] Using env file: ${envResolution.path}`);
  } else if (envResolution.explicit) {
    console.log(`[WARN] Env file not found at ${envResolution.path}; falling back to current process environment`);
  }

  // Step 1: Check for built MCP entry point
  const entryPoint = resolve('dist/mcp/index.js');
  if (!existsSync(entryPoint)) {
    console.log(`Build output not found at ${entryPoint}`);
    const answer = await ask('Run "npm run build" now? [Y/n] ');
    if (answer === '' || answer.toLowerCase() === 'y') {
      console.log('Building...');
      try {
        execSync('npm run build', { env: createCommandEnv(), stdio: 'inherit' });
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

  if (!commandExists('claude')) {
    console.error(
      '\nCould not find the "claude" CLI.\nInstall Claude Code first: https://docs.anthropic.com/en/docs/claude-code'
    );
    process.exit(1);
  }

  if (skipMcp) {
    console.log('[WARN] Skipping MCP registration by request');
    return;
  }

  let selectedScope = scope;
  if (!selectedScope && !nonInteractive) {
    selectedScope = await askScope();
  }

  if (!selectedScope) {
    console.log('[WARN] Non-interactive mode requires --scope or --register-mcp to perform Claude MCP registration');
    return;
  }

  if (nonInteractive && !registerMcp && !scope) {
    console.log('[WARN] Non-interactive mode skipped Claude MCP registration because no explicit scope or --register-mcp flag was provided');
    return;
  }

  const registrationCheck = checkClaudeMcpRegistration({
    scope: selectedScope,
    name: 'supermemory',
    expectedCommand: 'node',
    expectedArgs: [entryPoint],
  });

  if (registrationCheck.status === 'match') {
    console.log(`[OK] Supermemory is already registered in ${selectedScope} scope with the expected command path`);
    return;
  }

  const cmd = formatRegistrationCommand(selectedScope, entryPoint);
  if (registrationCheck.status === 'mismatch') {
    const removeCmd = formatRemovalCommand(selectedScope);
    console.log(`[INFO] Existing ${selectedScope} scope registration does not match the current build output; repairing with: ${removeCmd} && ${cmd}`);
    try {
      execSync(removeCmd, { env: createCommandEnv(), stdio: 'inherit', shell: '/bin/zsh' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`\nCould not remove the existing ${selectedScope} scope registration: ${msg}`);
      process.exit(1);
    }
  } else {
    console.log(`[INFO] No ${selectedScope} scope registration found; registering with: ${cmd}`);
  }

  try {
    execSync(`claude mcp add supermemory --scope ${selectedScope} -- node ${JSON.stringify(entryPoint)}`, {
      env: createCommandEnv(),
      stdio: 'inherit',
      shell: '/bin/zsh',
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`\nRegistration failed: ${msg}`);
    process.exit(1);
  }

  // Step 5: Success
  console.log('\nSupermemory MCP server registered successfully!');
  console.log(`Scope: ${selectedScope}`);
  console.log('\nVerify with:  claude mcp get supermemory');
}

run().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
