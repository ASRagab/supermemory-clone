import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(import.meta.dirname, '../..')
const tsxBin = resolve(repoRoot, 'node_modules/.bin/tsx')

describe('installer bin entrypoint', () => {
  it('prints usage when invoked through the executable wrapper', async () => {
    await expect(
      execFileAsync(tsxBin, ['packages/install/src/bin.ts', '--help'], {
        cwd: repoRoot,
      })
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Usage: npx -y @twelvehart/supermemory@latest <mode> [options]'),
    })
  })
})
