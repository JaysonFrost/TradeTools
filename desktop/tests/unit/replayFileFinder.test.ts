import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { findNewestReplayFile } from '../../src/main/services/video/replayFileFinder'

describe('replayFileFinder', () => {
  it('finds the newest OBS replay video created after the save request', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trade-clipper-replays-'))
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
    const dir = await mkdtemp(join(tmpdir(), 'trade-clipper-replays-empty-'))
    const oldReplay = join(dir, 'old.mp4')
    await writeFile(oldReplay, 'old')
    const oldTime = new Date(Date.parse('2026-05-13T03:51:00.000Z'))
    await import('node:fs/promises').then(({ utimes }) => utimes(oldReplay, oldTime, oldTime))

    await expect(findNewestReplayFile({
      directory: dir,
      afterMs: Date.parse('2026-05-13T03:51:10.000Z')
    })).resolves.toBeUndefined()
  })
})
