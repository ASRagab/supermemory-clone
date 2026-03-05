#!/usr/bin/env tsx
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export type ClaudeMcpScope = 'user' | 'project' | 'local';

type JsonObject = Record<string, unknown>;

export interface ClaudeMcpRegistrationEntry {
  scope: ClaudeMcpScope;
  sourcePath: string;
  command: string;
  args: string[];
  type: string;
}

export interface ClaudeMcpRegistrationCheck {
  status: 'missing' | 'match' | 'mismatch';
  scope: ClaudeMcpScope;
  projectKey: string;
  expectedCommand: string;
  expectedArgs: string[];
  entries: ClaudeMcpRegistrationEntry[];
}

interface CheckOptions {
  expectedArgs: string[];
  expectedCommand: string;
  homeDir?: string;
  name: string;
  projectDir?: string;
  scope: ClaudeMcpScope;
}

const HOME_CONFIG_CANDIDATES = ['.claude/settings.json', '.claude.json'] as const;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonObject(path: string): JsonObject | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function resolveRealPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function normalizeComparableValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (trimmed.startsWith('-')) {
    return trimmed;
  }

  const absoluteCandidate = trimmed.startsWith('/') ? trimmed : resolve(trimmed);
  if (existsSync(absoluteCandidate)) {
    return resolveRealPath(absoluteCandidate);
  }

  return trimmed;
}

function getHomeConfigPaths(homeDir = homedir()): string[] {
  const resolvedHome = resolve(homeDir);
  return HOME_CONFIG_CANDIDATES.map((relativePath) => join(resolvedHome, relativePath));
}

export function getClaudeProjectKey(projectDir = process.cwd()): string {
  return resolveRealPath(projectDir);
}

function getEntryFromHomeConfig(
  configPath: string,
  scope: ClaudeMcpScope,
  name: string,
  projectKey: string
): ClaudeMcpRegistrationEntry | null {
  const config = readJsonObject(configPath);
  if (!config) {
    return null;
  }

  let serverConfig: JsonObject | null = null;
  if (scope === 'user') {
    const mcpServers = isObject(config.mcpServers) ? config.mcpServers : null;
    serverConfig = mcpServers && isObject(mcpServers[name]) ? (mcpServers[name] as JsonObject) : null;
  } else {
    const projects = isObject(config.projects) ? config.projects : null;
    const projectConfig = projects && isObject(projects[projectKey]) ? (projects[projectKey] as JsonObject) : null;
    const mcpServers = projectConfig && isObject(projectConfig.mcpServers) ? projectConfig.mcpServers : null;
    serverConfig = mcpServers && isObject(mcpServers[name]) ? (mcpServers[name] as JsonObject) : null;
  }

  if (!serverConfig) {
    return null;
  }

  return {
    scope,
    sourcePath: configPath,
    command: typeof serverConfig.command === 'string' ? serverConfig.command : '',
    args: Array.isArray(serverConfig.args)
      ? serverConfig.args.filter((arg): arg is string => typeof arg === 'string')
      : [],
    type: typeof serverConfig.type === 'string' ? serverConfig.type : '',
  };
}

function getEntryFromProjectConfig(
  projectDir: string,
  name: string
): ClaudeMcpRegistrationEntry | null {
  const configPath = join(resolve(projectDir), '.mcp.json');
  const config = readJsonObject(configPath);
  if (!config) {
    return null;
  }

  const mcpServers = isObject(config.mcpServers) ? config.mcpServers : null;
  const serverConfig = mcpServers && isObject(mcpServers[name]) ? (mcpServers[name] as JsonObject) : null;
  if (!serverConfig) {
    return null;
  }

  return {
    scope: 'project',
    sourcePath: configPath,
    command: typeof serverConfig.command === 'string' ? serverConfig.command : '',
    args: Array.isArray(serverConfig.args)
      ? serverConfig.args.filter((arg): arg is string => typeof arg === 'string')
      : [],
    type: typeof serverConfig.type === 'string' ? serverConfig.type : '',
  };
}

function getRegistrationEntries(
  scope: ClaudeMcpScope,
  name: string,
  projectDir: string,
  homeDir?: string
): ClaudeMcpRegistrationEntry[] {
  if (scope === 'project') {
    const projectEntry = getEntryFromProjectConfig(projectDir, name);
    return projectEntry ? [projectEntry] : [];
  }

  const projectKey = getClaudeProjectKey(projectDir);
  return getHomeConfigPaths(homeDir)
    .map((configPath) => getEntryFromHomeConfig(configPath, scope, name, projectKey))
    .filter((entry): entry is ClaudeMcpRegistrationEntry => entry !== null);
}

export function findClaudeMcpRegistrations(
  name: string,
  projectDir = process.cwd(),
  homeDir?: string
): ClaudeMcpRegistrationEntry[] {
  const scopes: ClaudeMcpScope[] = ['project', 'local', 'user'];
  return scopes.flatMap((scope) => getRegistrationEntries(scope, name, projectDir, homeDir));
}

function isExpectedRegistration(
  entry: ClaudeMcpRegistrationEntry,
  expectedCommand: string,
  expectedArgs: string[]
): boolean {
  if (entry.type && entry.type !== 'stdio') {
    return false;
  }

  if (entry.command !== expectedCommand) {
    return false;
  }

  const normalizedExpectedArgs = expectedArgs.map(normalizeComparableValue);
  const normalizedActualArgs = entry.args.map(normalizeComparableValue);

  if (normalizedExpectedArgs.length !== normalizedActualArgs.length) {
    return false;
  }

  return normalizedExpectedArgs.every((arg, index) => arg === normalizedActualArgs[index]);
}

export function checkClaudeMcpRegistration(options: CheckOptions): ClaudeMcpRegistrationCheck {
  const projectDir = resolve(options.projectDir ?? process.cwd());
  const projectKey = getClaudeProjectKey(projectDir);
  const entries = getRegistrationEntries(options.scope, options.name, projectDir, options.homeDir);
  const expectedArgs = options.expectedArgs.map(normalizeComparableValue);

  if (entries.length === 0) {
    return {
      status: 'missing',
      scope: options.scope,
      projectKey,
      expectedCommand: options.expectedCommand,
      expectedArgs,
      entries: [],
    };
  }

  if (entries.some((entry) => isExpectedRegistration(entry, options.expectedCommand, expectedArgs))) {
    return {
      status: 'match',
      scope: options.scope,
      projectKey,
      expectedCommand: options.expectedCommand,
      expectedArgs,
      entries,
    };
  }

  return {
    status: 'mismatch',
    scope: options.scope,
    projectKey,
    expectedCommand: options.expectedCommand,
    expectedArgs,
    entries,
  };
}

function parseScope(value: string): ClaudeMcpScope {
  if (value === 'user' || value === 'project' || value === 'local') {
    return value;
  }
  throw new Error(`Invalid scope: ${value}`);
}

function parseCliArgs(): CheckOptions {
  const args = process.argv.slice(2);
  if (args[0] !== 'check') {
    throw new Error('Usage: claude-mcp-config.ts check --scope <scope> --name <name> --command <command> [--arg <value>]');
  }

  let scope: ClaudeMcpScope | undefined;
  let name = '';
  let expectedCommand = '';
  const expectedArgs: string[] = [];
  let projectDir: string | undefined;
  let homeDir: string | undefined;

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--scope') {
      scope = parseScope(args[index + 1] ?? '');
      index += 1;
      continue;
    }

    if (arg === '--name') {
      name = args[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (arg === '--command') {
      expectedCommand = args[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (arg === '--arg') {
      expectedArgs.push(args[index + 1] ?? '');
      index += 1;
      continue;
    }

    if (arg === '--project-dir') {
      projectDir = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--home-dir') {
      homeDir = args[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!scope || !name || !expectedCommand) {
    throw new Error('Missing required arguments for check');
  }

  return { scope, name, expectedCommand, expectedArgs, projectDir, homeDir };
}

function runCli(): void {
  const result = checkClaudeMcpRegistration(parseCliArgs());
  console.log(JSON.stringify(result));

  switch (result.status) {
    case 'match':
      process.exit(0);
    case 'missing':
      process.exit(10);
    case 'mismatch':
      process.exit(11);
  }
}

const executedPath = process.argv[1];
if (executedPath) {
  const currentPath = resolveRealPath(executedPath);
  const modulePath = resolveRealPath(new URL(import.meta.url).pathname);
  if (currentPath === modulePath) {
    try {
      runCli();
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(2);
    }
  }
}
