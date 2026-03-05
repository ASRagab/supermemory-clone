import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { config as dotenvConfig } from 'dotenv'

export type EnvFileSource = 'cli' | 'SUPERMEMORY_ENV_FILE' | '.env.local' | '.env'

export interface EnvFileResolution {
  path: string
  exists: boolean
  explicit: boolean
  source: EnvFileSource
}

function toAbsolutePath(candidate: string, cwd: string): string {
  return isAbsolute(candidate) ? candidate : resolve(cwd, candidate)
}

export function resolveEnvFile(options?: { cliEnvFile?: string; cwd?: string }): EnvFileResolution {
  const cwd = options?.cwd ?? process.cwd()

  if (options?.cliEnvFile) {
    const path = toAbsolutePath(options.cliEnvFile, cwd)
    return {
      path,
      exists: existsSync(path),
      explicit: true,
      source: 'cli',
    }
  }

  if (process.env.SUPERMEMORY_ENV_FILE) {
    const path = toAbsolutePath(process.env.SUPERMEMORY_ENV_FILE, cwd)
    return {
      path,
      exists: existsSync(path),
      explicit: true,
      source: 'SUPERMEMORY_ENV_FILE',
    }
  }

  const envLocalPath = resolve(cwd, '.env.local')
  if (existsSync(envLocalPath)) {
    return {
      path: envLocalPath,
      exists: true,
      explicit: false,
      source: '.env.local',
    }
  }

  const envPath = resolve(cwd, '.env')
  return {
    path: envPath,
    exists: existsSync(envPath),
    explicit: false,
    source: '.env',
  }
}

export function loadEnvFile(options?: { cliEnvFile?: string; cwd?: string; override?: boolean }): EnvFileResolution {
  const resolution = resolveEnvFile(options)

  if (resolution.exists) {
    dotenvConfig({
      path: resolution.path,
      override: options?.override ?? false,
    })
  }

  return resolution
}
