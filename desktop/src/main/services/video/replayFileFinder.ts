import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

export type ReplayFileSnapshot = Record<string, {
  mtimeMs: number
  size: number
}>

export type ReplayFileSearchInput = {
  directory: string
  afterMs: number
  preferredPath?: string
  freshnessToleranceMs?: number
  previousSnapshot?: ReplayFileSnapshot
}

export type ReplayFileWaitInput = ReplayFileSearchInput & {
  timeoutMs?: number
  pollIntervalMs?: number
  stablePollIntervalMs?: number
  sleep?: (durationMs: number) => Promise<void>
  signal?: AbortSignal
}

const replayExtensions = new Set(['.mp4', '.mkv', '.mov', '.flv', '.ts'])
const defaultFreshnessToleranceMs = 2_000
const defaultSearchDepth = 3
const defaultStablePollIntervalMs = 750

const extensionOf = (fileName: string): string => {
  const index = fileName.lastIndexOf('.')
  return index >= 0 ? fileName.slice(index).toLowerCase() : ''
}

const isFreshEnough = (mtimeMs: number, input: ReplayFileSearchInput): boolean => {
  const freshnessToleranceMs = input.freshnessToleranceMs ?? defaultFreshnessToleranceMs
  return mtimeMs >= input.afterMs - freshnessToleranceMs
}

const changedSinceSnapshot = (path: string, mtimeMs: number, size: number, snapshot?: ReplayFileSnapshot): boolean => {
  if (!snapshot) return false
  const previous = snapshot[path]
  return !previous || previous.mtimeMs !== mtimeMs || previous.size !== size
}

const isCandidateReplayFile = (path: string, mtimeMs: number, size: number, input: ReplayFileSearchInput): boolean => {
  return isFreshEnough(mtimeMs, input) || changedSinceSnapshot(path, mtimeMs, size, input.previousSnapshot)
}

const collectReplayFiles = async (directory: string, depth = 0): Promise<Array<{ path: string, mtimeMs: number, size: number }>> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)

    if (entry.isDirectory() && depth < defaultSearchDepth) {
      return collectReplayFiles(path, depth + 1).catch(() => [])
    }

    if (!entry.isFile() || !replayExtensions.has(extensionOf(entry.name))) return []

    const fileStat = await stat(path)
    return [{ path, mtimeMs: fileStat.mtimeMs, size: fileStat.size }]
  }))

  return nested.flat()
}

export const snapshotReplayFiles = async (directory: string): Promise<ReplayFileSnapshot> => {
  const files = await collectReplayFiles(directory)
  return Object.fromEntries(files.map((file) => [file.path, {
    mtimeMs: file.mtimeMs,
    size: file.size
  }]))
}

const findPreferredReplayFile = async (input: ReplayFileSearchInput): Promise<string | undefined> => {
  if (!input.preferredPath || !replayExtensions.has(extensionOf(input.preferredPath))) return undefined

  try {
    const fileStat = await stat(input.preferredPath)
    return fileStat.isFile() && isCandidateReplayFile(input.preferredPath, fileStat.mtimeMs, fileStat.size, input)
      ? input.preferredPath
      : undefined
  } catch {
    return undefined
  }
}

export const findNewestReplayFile = async (input: ReplayFileSearchInput): Promise<string | undefined> => {
  const preferredReplayPath = await findPreferredReplayFile(input)
  if (preferredReplayPath) return preferredReplayPath

  const files = await collectReplayFiles(input.directory)

  return files
    .filter((file) => isCandidateReplayFile(file.path, file.mtimeMs, file.size, input))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path
}

const defaultSleep = (durationMs: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, durationMs))

const waitForStableFile = async (path: string, input: ReplayFileWaitInput): Promise<boolean> => {
  const sleep = input.sleep ?? defaultSleep
  const stablePollIntervalMs = input.stablePollIntervalMs ?? defaultStablePollIntervalMs

  try {
    const first = await stat(path)
    if (!first.isFile() || first.size <= 0) return false

    await sleep(stablePollIntervalMs)
    if (input.signal?.aborted) return false

    const second = await stat(path)
    return second.isFile() && second.size === first.size && second.mtimeMs === first.mtimeMs
  } catch {
    return false
  }
}

export const waitForNewestReplayFile = async (input: ReplayFileWaitInput): Promise<string | undefined> => {
  const timeoutMs = input.timeoutMs ?? 30_000
  const pollIntervalMs = input.pollIntervalMs ?? 250
  const sleep = input.sleep ?? defaultSleep
  const startedAtMs = Date.now()

  while (!input.signal?.aborted && Date.now() - startedAtMs <= timeoutMs) {
    const replayPath = await findNewestReplayFile(input)
    if (replayPath && await waitForStableFile(replayPath, input)) return replayPath

    await sleep(pollIntervalMs)
  }

  return undefined
}
