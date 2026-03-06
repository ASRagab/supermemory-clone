#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

interface PackFileEntry {
  path?: string
}

interface PackResult {
  files?: PackFileEntry[]
}

const REQUIRED_PATHS = [
  '.env.example',
  'Dockerfile',
  'docker-compose.prod.yml',
  'docker-compose.yml',
  'package.json',
  'scripts/doctor.ts',
  'scripts/install.sh',
  'scripts/mcp-setup.ts',
  'drizzle/0000_dapper_the_professor.sql',
  'src/index.ts',
  'src/db/schema.ts',
  'src/mcp/index.ts',
  'tsconfig.json',
] as const

const FORBIDDEN_PATTERNS = [
  /^coverage\//,
  /^data\//,
  /^packages\//,
  /^tests\//,
  /^2026-03-05-npx-first-installer-/,
] as const

function parsePackResult(rawOutput: string): PackResult {
  const parsed = JSON.parse(rawOutput) as unknown
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('npm pack --json did not return a pack result array')
  }

  const [firstResult] = parsed
  if (!firstResult || typeof firstResult !== 'object') {
    throw new Error('npm pack --json returned an invalid pack result')
  }

  return firstResult as PackResult
}

function collectPackPaths(result: PackResult): string[] {
  const packPaths = result.files
    ?.map((entry) => entry.path)
    .filter((path): path is string => typeof path === 'string')
    .sort()

  if (!packPaths || packPaths.length === 0) {
    throw new Error('npm pack --json did not report packaged file paths')
  }

  return packPaths
}

function assertRequiredPaths(packPaths: string[]): void {
  const missingPaths = REQUIRED_PATHS.filter((requiredPath) => !packPaths.includes(requiredPath))
  if (missingPaths.length > 0) {
    throw new Error(`Runtime package is missing required files: ${missingPaths.join(', ')}`)
  }
}

function assertForbiddenPaths(packPaths: string[]): void {
  const forbiddenPaths = packPaths.filter((packPath) =>
    FORBIDDEN_PATTERNS.some((pattern) => pattern.test(packPath))
  )

  if (forbiddenPaths.length > 0) {
    throw new Error(`Runtime package includes forbidden files: ${forbiddenPaths.join(', ')}`)
  }
}

export function validateRuntimePack(repoRoot = resolve(import.meta.dirname, '..')): string[] {
  const packDestination = join(tmpdir(), `supermemory-runtime-pack-${process.pid}-${Date.now()}`)

  try {
    const rawOutput = execFileSync(
      'npm',
      ['pack', '--json', '--dry-run', '--pack-destination', packDestination],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      }
    )

    const packPaths = collectPackPaths(parsePackResult(rawOutput))
    assertRequiredPaths(packPaths)
    assertForbiddenPaths(packPaths)

    return packPaths
  } finally {
    if (existsSync(packDestination)) {
      rmSync(packDestination, { recursive: true, force: true })
    }
  }
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  const packPaths = validateRuntimePack()
  console.log(`Runtime package validated (${packPaths.length} files)`)
}
