import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { findNewestReplayFile, snapshotReplayFiles, waitForNewestReplayFile } from '../../src/main/services/video/replayFileFinder'

describe('replayFileFinder', () => {
  it('finds the newest OBS replay video created after the save request', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'TradeTools-replays-'))
    const oldReplay = join(dir, 'old.mp4')
    const newestReplay = join(dir, 'Replay 2026-05-13 03-51-10.mkv')
    const ignoredText = join(dir, 'notes.txt')

    await writeFile(oldReplay, 'old')
    await writeFile(newestReplay, 'new')
    await writeFile(ignoredText, 'ignore')

    const beforeSaveMs = Date.parse('2026-05-13T03:51:10.000Z')
    const oldTime = new Date(beforeSaveMs - 10_000)
    const newTime = new Date(beforeSaveMs + 2_000)
    await Promise.all([
      import('node:fs/promises').then(({ utimes }) => utimes(oldReplay, oldTime, oldTime)),
      import('node:fs/promises').then(({ utimes }) => utimes(newestReplay, newTime, newTime))
    ])

    await expect(findNewestReplayFile({ directory: dir, afterMs: beforeSaveMs })).resolves.toBe(newestReplay)
  })

  it('returns undefined when OBS has not written a fresh replay yet', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'TradeTools-replays-empty-'))
    const oldReplay = join(dir, 'old.mp4')
    await writeFile(oldReplay, 'old')
    const oldTime = new Date(Date.parse('2026-05-13T03:51:00.000Z'))
    await import('node:fs/promises').then(({ utimes }) => utimes(oldReplay, oldTime, oldTime))

    await expect(findNewestReplayFile({
      directory: dir,
      afterMs: Date.parse('2026-05-13T03:51:10.000Z')
    })).resolves.toBeUndefined()
  })

  it('waits for OBS to finish writing a fresh replay file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'TradeTools-replays-wait-'))
    const replayPath = join(dir, 'Replay 2026-05-13 03-51-15.mp4')
    const afterMs = Date.parse('2026-05-13T03:51:10.000Z')
    let slept = false

    await expect(waitForNewestReplayFile({
      directory: dir,
      afterMs,
      timeoutMs: 1_000,
      pollIntervalMs: 100,
      sleep: async () => {
        if (slept) return
        slept = true
        await writeFile(replayPath, 'new replay')
        const replayTime = new Date(afterMs + 5_000)
        await import('node:fs/promises').then(({ utimes }) => utimes(replayPath, replayTime, replayTime))
      }
    })).resolves.toBe(replayPath)
  })

  it('accepts OBS files whose filesystem timestamp is slightly before the save request', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'TradeTools-replays-rounded-mtime-'))
    const replayPath = join(dir, 'Replay 2026-05-13 08-21-25.mp4')
    const afterMs = Date.parse('2026-05-13T08:21:25.800Z')
    await writeFile(replayPath, 'new replay')
    const roundedMtime = new Date(Date.parse('2026-05-13T08:21:25.000Z'))
    await import('node:fs/promises').then(({ utimes }) => utimes(replayPath, roundedMtime, roundedMtime))

    await expect(findNewestReplayFile({ directory: dir, afterMs })).resolves.toBe(replayPath)
  })

  it('finds a new replay in a nested OBS folder even when its mtime is older than the save request', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'TradeTools-replays-nested-'))
    const nestedDir = join(dir, 'processed')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(nestedDir))
    const beforeSnapshot = await snapshotReplayFiles(dir)
    const replayPath = join(nestedDir, 'Replay 2026-05-13 08-21-25.mp4')
    const afterMs = Date.parse('2026-05-13T08:21:30.000Z')

    await writeFile(replayPath, 'new replay')
    await import('node:fs/promises').then(({ utimes }) => utimes(
      replayPath,
      new Date(Date.parse('2026-05-13T08:21:20.000Z')),
      new Date(Date.parse('2026-05-13T08:21:20.000Z'))
    ))

    await expect(findNewestReplayFile({
      directory: dir,
      afterMs,
      previousSnapshot: beforeSnapshot
    })).resolves.toBe(replayPath)
  })
})
