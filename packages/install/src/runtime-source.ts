import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { RuntimeTarball } from './types.js'

interface PackResult {
  filename?: string
}

function parsePackResult(rawOutput: string): PackResult {
  const parsed = JSON.parse(rawOutput) as unknown
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('npm pack did not return a pack result array')
  }

  const [firstResult] = parsed
  if (!firstResult || typeof firstResult !== 'object') {
    throw new Error('npm pack returned an invalid pack result')
  }

  return firstResult as PackResult
}

function packSpecifier(runtimeVersion: string, sourcePath?: string, cwd = process.cwd()): RuntimeTarball {
  const packDestination = join(tmpdir(), `supermemory-install-pack-${process.pid}-${Date.now()}`)
  mkdirSync(packDestination, { recursive: true })

  const specifier = sourcePath ? resolve(cwd, sourcePath) : `@supermemory/runtime@${runtimeVersion}`
  if (sourcePath && !existsSync(specifier)) {
    throw new Error(`Local runtime source path does not exist: ${specifier}`)
  }

  const rawOutput = execFileSync('npm', ['pack', specifier, '--json', '--pack-destination', packDestination], {
    encoding: 'utf8',
  })

  const result = parsePackResult(rawOutput)
  if (!result.filename) {
    throw new Error('npm pack did not report a tarball filename')
  }

  return {
    cleanup: () => {
      if (existsSync(packDestination)) {
        rmSync(packDestination, { recursive: true, force: true })
      }
    },
    sourceType: sourcePath ? 'local' : 'npm',
    specifier,
    tarballPath: join(packDestination, result.filename),
  }
}

export function prepareRuntimeTarball(runtimeVersion: string, sourcePath?: string, cwd = process.cwd()): RuntimeTarball {
  return packSpecifier(runtimeVersion, sourcePath, cwd)
}
