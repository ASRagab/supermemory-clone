import { describe, expect, it } from 'vitest'

import { validateRuntimePack } from '../../scripts/check-runtime-pack.ts'

describe('runtime package validation', () => {
  it('includes the required install payload and excludes repo-only artifacts', () => {
    const packPaths = validateRuntimePack()

    expect(packPaths).toContain('scripts/install.sh')
    expect(packPaths).toContain('scripts/mcp-setup.ts')
    expect(packPaths).toContain('src/mcp/index.ts')
    expect(packPaths).toContain('docker-compose.yml')
    expect(packPaths).not.toContain('tests/install/runtime-pack.test.ts')
    expect(packPaths.some((packPath) => packPath.startsWith('packages/'))).toBe(false)
  })
})
