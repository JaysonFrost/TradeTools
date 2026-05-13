import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

export type ReplayFileSearchInput = {
  directory: string
  afterMs: number
}

const replayExtensions = new Set(['.mp4', '.mkv', '.mov', '.flv', '.ts'])

const extensionOf = (fileName: string): string => {
  const index = fileName.lastIndexOf('.')
  return index >= 0 ? fileName.slice(index).toLowerCase() : ''
}

export const findNewestReplayFile = async (input: ReplayFileSearchInput): Promise<string | undefined> => {
  const entries = await readdir(input.directory, { withFileTypes: true })
  const files = await Promise.all(entries
    .filter((entry) => entry.isFile() && replayExtensions.has(extensionOf(entry.name)))
    .map(async (entry) => {
      const path = join(input.directory, entry.name)
      const fileStat = await stat(path)
      return { path, mtimeMs: fileStat.mtimeMs }
    }))

  return files
    .filter((file) => file.mtimeMs >= input.afterMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path
}
