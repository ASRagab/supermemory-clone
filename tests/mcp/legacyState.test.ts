import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { archiveFileWithSuffix, pathExists, readJsonFile } from '../../src/mcp/legacyState.js'

describe('MCP legacy state filesystem helpers', () => {
  it('should report path existence accurately', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'legacy-state-'))
    const filePath = join(dir, 'state.json')

    expect(await pathExists(filePath)).toBe(false)

    await writeFile(filePath, '{}', 'utf-8')
    expect(await pathExists(filePath)).toBe(true)
  })

  it('should parse JSON files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'legacy-state-'))
    const filePath = join(dir, 'state.json')
    await writeFile(filePath, '{"version":1}', 'utf-8')

    const parsed = await readJsonFile<{ version: number }>(filePath)
    expect(parsed.version).toBe(1)
  })

  it('should throw on invalid JSON files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'legacy-state-'))
    const filePath = join(dir, 'state.json')
    await writeFile(filePath, '{invalid-json', 'utf-8')

    await expect(readJsonFile(filePath)).rejects.toThrow()
  })

  it('should archive files using .migrated suffix by default', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'legacy-state-'))
    const filePath = join(dir, 'state.json')
    await writeFile(filePath, '{"legacy":true}', 'utf-8')

    const archivedPath = await archiveFileWithSuffix(filePath)

    expect(archivedPath).toBe(`${filePath}.migrated`)
    expect(await pathExists(filePath)).toBe(false)
    expect(await pathExists(archivedPath)).toBe(true)
    expect(await readFile(archivedPath, 'utf-8')).toBe('{"legacy":true}')
  })

  it('should avoid clobbering existing archive files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'legacy-state-'))
    const filePath = join(dir, 'state.json')
    const existingArchivePath = `${filePath}.migrated`

    await writeFile(filePath, '{"legacy":true}', 'utf-8')
    await writeFile(existingArchivePath, '{"already":"archived"}', 'utf-8')

    const archivedPath = await archiveFileWithSuffix(filePath)

    expect(archivedPath.startsWith(`${existingArchivePath}.`)).toBe(true)
    expect(await pathExists(archivedPath)).toBe(true)
    expect(await readFile(archivedPath, 'utf-8')).toBe('{"legacy":true}')
    expect(await readFile(existingArchivePath, 'utf-8')).toBe('{"already":"archived"}')
  })
})
