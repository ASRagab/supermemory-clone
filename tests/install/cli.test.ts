import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { executeInstall, parseCliArgs } from '../../packages/install/src/cli.ts'

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

describe('installer cli', () => {
  it('parses mode mapping and option flags', () => {
    const parsed = parseCliArgs(
      [
        'full',
        '--dir',
        './supermemory',
        '--mcp',
        'project',
        '--skip-api-keys',
        '--runtime-version',
        '1.2.3',
        '--update',
      ],
      '/tmp/workspace'
    )

    expect(parsed.mode).toBe('full')
    expect(parsed.targetDir).toBe('/tmp/workspace/supermemory')
    expect(parsed.mcpScope).toBe('project')
    expect(parsed.skipApiKeys).toBe(true)
    expect(parsed.runtimeVersion).toBe('1.2.3')
    expect(parsed.update).toBe(true)
  })

  it('defaults installs to ~/.supermemory when --dir is omitted', () => {
    const parsed = parseCliArgs(['full'], '/tmp/workspace')

    expect(parsed.targetDir).toBe(resolve(homedir(), '.supermemory'))
  })

  it('installs from a local runtime fixture and writes the final-path manifest', () => {
    const cwd = createTempDir('supermemory-install-cwd-')
    const output: string[] = []
    const installDir = resolve(cwd, 'supermemory')
    const fixtureRuntime = resolve(process.cwd(), 'tests/install/fixtures/runtime-package')

    const parsed = parseCliArgs(
      ['full', '--dir', './supermemory', '--source-path', fixtureRuntime, '--mcp', 'project'],
      cwd
    )

    executeInstall(
      parsed,
      {
        stderr: (message) => output.push(`ERR:${message}`),
        stdout: (message) => output.push(message),
      },
      'pipe'
    )

    const manifest = JSON.parse(readFileSync(join(installDir, '.supermemory-install.json'), 'utf8')) as {
      installMode: string
      mcpScope: string
      runtimeVersion: string
    }

    const projectMcp = JSON.parse(readFileSync(join(installDir, '.mcp.json'), 'utf8')) as {
      mcpServers: { supermemory: { args: string[] } }
    }

    expect(manifest.installMode).toBe('full')
    expect(manifest.mcpScope).toBe('project')
    expect(manifest.runtimeVersion).toBe('9.9.9')
    expect(projectMcp.mcpServers.supermemory.args[0]).toBe(realpathSync(join(installDir, 'dist/mcp/index.js')))
    expect(output.join('\n')).toContain('1. cd ./supermemory')
    expect(output.join('\n')).toContain('2. Open Claude in this directory')
    expect(output.join('\n')).toContain('3. Ask Claude to use supermemory_add')
  })

  it('reuses a non-empty install directory when --update is passed', () => {
    const cwd = createTempDir('supermemory-install-update-')
    const installDir = resolve(cwd, 'supermemory')
    const fixtureRuntime = resolve(process.cwd(), 'tests/install/fixtures/runtime-package')

    executeInstall(
      parseCliArgs(['agent', '--dir', './supermemory', '--source-path', fixtureRuntime], cwd),
      {
        stderr: () => {},
        stdout: () => {},
      },
      'pipe'
    )

    executeInstall(
      parseCliArgs(['agent', '--dir', './supermemory', '--source-path', fixtureRuntime, '--update'], cwd),
      {
        stderr: () => {},
        stdout: () => {},
      },
      'pipe'
    )

    const manifest = JSON.parse(readFileSync(join(installDir, '.supermemory-install.json'), 'utf8')) as {
      installMode: string
      runtimeVersion: string
    }

    expect(manifest.installMode).toBe('agent')
    expect(manifest.runtimeVersion).toBe('9.9.9')
  })
})
