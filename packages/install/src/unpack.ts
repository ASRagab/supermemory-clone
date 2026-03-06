import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { RuntimePackageMetadata } from './types.js'

export function ensureInstallDirectory(targetDir: string, update: boolean): void {
  const resolvedTargetDir = resolve(targetDir)

  if (existsSync(resolvedTargetDir)) {
    const existingEntries = readdirSync(resolvedTargetDir)
    if (existingEntries.length > 0 && !update) {
      throw new Error(`Install directory is not empty: ${resolvedTargetDir}. Re-run with --update to reuse it.`)
    }
  } else {
    mkdirSync(resolvedTargetDir, { recursive: true })
  }
}

export function unpackRuntimeTarball(tarballPath: string, targetDir: string): void {
  execFileSync('tar', ['-xzf', tarballPath, '-C', targetDir, '--strip-components=1'])
}

export function readRuntimePackageMetadata(targetDir: string): RuntimePackageMetadata {
  const packageJsonPath = join(resolve(targetDir), 'package.json')
  const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Partial<RuntimePackageMetadata>

  if (!parsed.name || !parsed.version) {
    throw new Error(`Installed runtime package metadata is invalid: ${packageJsonPath}`)
  }

  return {
    name: parsed.name,
    version: parsed.version,
  }
}
