import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  InstallManifest,
  InstallerRunSummary,
  InstallerStdio,
  ParsedCliArgs,
  RuntimePackageMetadata,
} from './types.js'

function getResultFilePath(): string {
  return join(tmpdir(), `supermemory-install-result-${process.pid}-${Date.now()}.json`)
}

function readInstallerVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  ) as { version?: string }

  if (!packageJson.version) {
    throw new Error('Installer package.json is missing a version')
  }

  return packageJson.version
}

function readSummary(resultFilePath: string, fallback: ParsedCliArgs): InstallerRunSummary {
  if (!existsSync(resultFilePath)) {
    return {
      action: fallback.update ? 'update' : 'install',
      installMode: fallback.mode,
      installDir: fallback.targetDir,
      envFile: fallback.envFile,
      apiStarted: false,
      connectivityOk: true,
      mcp: {
        scope: fallback.mcpScope,
        status: fallback.mcpScope ? 'unknown' : 'not_requested',
      },
      flags: {
        skipDocker: fallback.skipDocker,
        skipApiKeys: fallback.skipApiKeys,
        skipApiStart: fallback.skipApiStart,
        apiKeysWereSkipped: fallback.skipApiKeys,
      },
    }
  }

  return JSON.parse(readFileSync(resultFilePath, 'utf8')) as InstallerRunSummary
}

export function runCanonicalInstaller(args: ParsedCliArgs, stdio: InstallerStdio = 'inherit'): InstallerRunSummary {
  const resultFilePath = getResultFilePath()
  const installArgs = args.update ? ['update', '--mode', args.mode] : [args.mode]

  installArgs.push('--non-interactive')

  if (args.envFile) {
    installArgs.push('--env-file', args.envFile)
  }

  if (args.skipApiKeys) {
    installArgs.push('--skip-api-keys')
  }

  if (args.skipDocker) {
    installArgs.push('--skip-docker')
  }

  if (args.skipApiStart) {
    installArgs.push('--skip-api-start')
  }

  if (args.mcpScope) {
    installArgs.push('--register-mcp', '--scope', args.mcpScope)
  }

  const result = spawnSync('bash', ['./scripts/install.sh', ...installArgs], {
    cwd: args.targetDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      SUPERMEMORY_INSTALLER_BRIEF: '1',
      SUPERMEMORY_INSTALLER_RESULT_FILE: resultFilePath,
    },
    stdio,
  })

  const summary = readSummary(resultFilePath, args)
  rmSync(resultFilePath, { force: true })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const failureDetails =
      stdio === 'pipe'
        ? [result.stdout, result.stderr].filter((value) => Boolean(value)).join('\n').trim()
        : ''

    throw new Error(
      failureDetails
        ? `scripts/install.sh failed with exit code ${result.status}\n${failureDetails}`
        : `scripts/install.sh failed with exit code ${result.status}`
    )
  }

  return summary
}

export function writeInstallManifest(
  targetDir: string,
  installMode: ParsedCliArgs['mode'],
  runtimePackage: RuntimePackageMetadata,
  summary: InstallerRunSummary
): InstallManifest {
  const manifest: InstallManifest = {
    installerVersion: readInstallerVersion(),
    runtimeVersion: runtimePackage.version,
    installMode,
    targetDir,
    mcpScope: summary.mcp.scope,
    installedAt: new Date().toISOString(),
  }

  writeFileSync(join(targetDir, '.supermemory-install.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}
