import { access, readFile, rename } from 'node:fs/promises'

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf-8')
  return JSON.parse(raw) as T
}

export async function archiveFileWithSuffix(filePath: string, suffix: string = '.migrated'): Promise<string> {
  const archiveBasePath = `${filePath}${suffix}`
  const archivePath = (await pathExists(archiveBasePath)) ? `${archiveBasePath}.${Date.now()}` : archiveBasePath
  await rename(filePath, archivePath)
  return archivePath
}
