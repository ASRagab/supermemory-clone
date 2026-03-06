import { homedir } from 'node:os'
import { resolve } from 'node:path'

import { renderSuccessOutput } from './output.js'
import { prepareRuntimeTarball } from './runtime-source.js'
import { runCanonicalInstaller, writeInstallManifest } from './run-install.js'
import type { CliIo, InstallMode, McpScope, ParsedCliArgs } from './types.js'
import { ensureInstallDirectory, readRuntimePackageMetadata, unpackRuntimeTarball } from './unpack.js'

const DEFAULT_INSTALL_DIR = '~/.supermemory'
const DEFAULT_RUNTIME_VERSION = 'latest'
const DEFAULT_IO: CliIo = {
  stderr: (message) => process.stderr.write(`${message}\n`),
  stdout: (message) => process.stdout.write(message),
}

function usage(): string {
  return `Usage: npx -y @twelvehart/supermemory@latest <mode> [options]

Modes:
  agent
  api
  full

Options:
  --dir <path>              Target install directory (default: ${DEFAULT_INSTALL_DIR})
  --env-file <path>         Env file passed through to scripts/install.sh
  --skip-api-keys           Skip API key prompts and note degraded extraction quality
  --mcp <scope>             Register Claude MCP in project, user, or local scope
  --skip-docker             Skip docker startup inside scripts/install.sh
  --skip-api-start          Skip API auto-start for api/full installs
  --runtime-version <tag>   Runtime version to install (default: ${DEFAULT_RUNTIME_VERSION})
  --source-path <path>      Local runtime package path for maintainer testing
  --update                  Reuse a non-empty target directory
  -h, --help                Show this help
`
}

function isInstallMode(value: string): value is InstallMode {
  return value === 'agent' || value === 'api' || value === 'full'
}

function isMcpScope(value: string): value is McpScope {
  return value === 'project' || value === 'user' || value === 'local'
}

export function parseCliArgs(argv: string[], cwd = process.cwd()): ParsedCliArgs {
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    throw new Error(usage())
  }

  const [modeCandidate, ...rest] = argv
  if (!modeCandidate || !isInstallMode(modeCandidate)) {
    throw new Error(`Expected an install mode (agent, api, or full).\n\n${usage()}`)
  }

  const parsed: ParsedCliArgs = {
    cwd,
    mode: modeCandidate,
    runtimeVersion: DEFAULT_RUNTIME_VERSION,
    skipApiKeys: false,
    skipApiStart: false,
    skipDocker: false,
    targetDir: resolve(homedir(), '.supermemory'),
    update: false,
  }

  for (let index = 0; index < rest.length; index += 1) {
    const currentArg = rest[index]

    switch (currentArg) {
      case '--dir':
        index += 1
        {
          const dirValue = rest[index]
          if (!dirValue) {
            throw new Error('Missing value for --dir')
          }
          parsed.targetDir = resolve(cwd, dirValue)
        }
        break
      case '--env-file':
        index += 1
        {
          const envFileValue = rest[index]
          if (!envFileValue) {
            throw new Error('Missing value for --env-file')
          }
          parsed.envFile = resolve(cwd, envFileValue)
        }
        break
      case '--skip-api-keys':
        parsed.skipApiKeys = true
        break
      case '--mcp':
        index += 1
        {
          const mcpScopeValue = rest[index]
          if (!mcpScopeValue || !isMcpScope(mcpScopeValue)) {
            throw new Error('Missing or invalid value for --mcp (expected: project, user, or local)')
          }
          parsed.mcpScope = mcpScopeValue
        }
        break
      case '--skip-docker':
        parsed.skipDocker = true
        break
      case '--skip-api-start':
        parsed.skipApiStart = true
        break
      case '--runtime-version':
        index += 1
        {
          const runtimeVersionValue = rest[index]
          if (!runtimeVersionValue) {
            throw new Error('Missing value for --runtime-version')
          }
          parsed.runtimeVersion = runtimeVersionValue
        }
        break
      case '--source-path':
        index += 1
        {
          const sourcePathValue = rest[index]
          if (!sourcePathValue) {
            throw new Error('Missing value for --source-path')
          }
          parsed.sourcePath = sourcePathValue
        }
        break
      case '--update':
        parsed.update = true
        break
      default:
        throw new Error(`Unknown argument: ${currentArg}`)
    }
  }

  return parsed
}

export function executeInstall(args: ParsedCliArgs, io: CliIo = DEFAULT_IO, stdio: 'inherit' | 'pipe' = 'inherit'): void {
  ensureInstallDirectory(args.targetDir, args.update)

  const runtimeTarball = prepareRuntimeTarball(args.runtimeVersion, args.sourcePath, args.cwd)
  try {
    unpackRuntimeTarball(runtimeTarball.tarballPath, args.targetDir)
    const runtimePackage = readRuntimePackageMetadata(args.targetDir)
    const summary = runCanonicalInstaller(args, stdio)
    writeInstallManifest(args.targetDir, args.mode, runtimePackage, summary)
    io.stdout(renderSuccessOutput(args, summary))
  } finally {
    runtimeTarball.cleanup()
  }
}

export function runCli(argv: string[], io: CliIo = DEFAULT_IO, stdio: 'inherit' | 'pipe' = 'inherit'): void {
  const args = parseCliArgs(argv)
  executeInstall(args, io, stdio)
}
