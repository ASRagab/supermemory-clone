import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { prepareRuntimeTarball } from '../../packages/install/src/runtime-source.ts'
import { unpackRuntimeTarball } from '../../packages/install/src/unpack.ts'

const createdDirs: string[] = []

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  createdDirs.push(dir)
  return dir
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const nextDir = createdDirs.pop()
    if (nextDir) {
      rmSync(nextDir, { recursive: true, force: true })
    }
  }
})

describe('runtime uninstall purge', () => {
  it('purges generated artifacts from an unpacked runtime install and leaves the directory reinstallable', () => {
    const installDir = createTempDir('supermemory-runtime-purge-')
    const runtimeTarball = prepareRuntimeTarball('latest', '.', process.cwd())

    try {
      unpackRuntimeTarball(runtimeTarball.tarballPath, installDir)
    } finally {
      runtimeTarball.cleanup()
    }

    mkdirSync(join(installDir, 'node_modules'), { recursive: true })
    mkdirSync(join(installDir, 'dist'), { recursive: true })
    mkdirSync(join(installDir, 'coverage'), { recursive: true })
    writeFileSync(join(installDir, '.env'), 'OPENAI_API_KEY=test\n')
    writeFileSync(join(installDir, '.env.local'), 'OPENAI_API_KEY=test-local\n')

    execFileSync('bash', ['./scripts/install.sh', 'uninstall', '--purge', '--skip-mcp', '--non-interactive'], {
      cwd: installDir,
      env: {
        ...process.env,
        PATH: process.env.PATH ?? '',
      },
      stdio: 'pipe',
    })

    expect(existsSync(join(installDir, 'node_modules'))).toBe(false)
    expect(existsSync(join(installDir, 'dist'))).toBe(false)
    expect(existsSync(join(installDir, 'coverage'))).toBe(false)
    expect(existsSync(join(installDir, '.env'))).toBe(false)
    expect(existsSync(join(installDir, '.env.local'))).toBe(false)
    expect(existsSync(resolve(installDir, 'scripts/install.sh'))).toBe(true)
  })
})
