import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultSettings } from '../../src/main/services/settings/settings'
import { createTradeClipPipeline } from '../../src/main/services/trades/tradeClipPipeline'
import { createSimulatedClosedTrade } from '../../src/main/services/trades/simulatedTradePipeline'
import { buildClipOutputPaths } from '../../src/main/services/video/clipPaths'

const legacyVideoProviderName = ['You', 'Tube'].join('')
const legacyVideoProviderKey = ['you', 'tube'].join('')
const legacyPublishMethodPrefix = ['upload', 'Clip', 'To'].join('')

describe('tradeClipPipeline', () => {
  it('saves OBS replay, trims it into the dated clip folder, and writes metadata json', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-data-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-obs-'))
    const replayPath = join(replayDir, 'Replay 2026-05-13 03-51-12.mp4')
    await writeFile(replayPath, 'fake video')

    const requestedAtMs = new Date(2026, 4, 13, 3, 51, 10).getTime()
    const replaySavedAtMs = new Date(2026, 4, 13, 3, 51, 12).getTime()
    await import('node:fs/promises').then(({ utimes }) => utimes(replayPath, new Date(replaySavedAtMs), new Date(replaySavedAtMs)))

    const runFfmpeg = vi.fn(async (args: string[]) => {
      await writeFile(args.at(-1) ?? '', 'trimmed video')
    })
    const getVideoDurationSeconds = vi.fn(async (path: string) => path === replayPath ? 120 : 114)
    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...createDefaultSettings(dataDir),
        clip: {
          paddingBeforeSeconds: 3,
          paddingAfterSeconds: 5,
          replayBufferSeconds: 1800,
          replaySourceDir: replayDir,
          outputDir: dataDir
        },
        obs: {
          host: '127.0.0.1',
          port: 4455,
          passwordConfigured: true
        }
      }),
      saveReplayBuffer: vi.fn(async () => ({ ok: true, message: 'OBS Replay Buffer сохранён', requestedAtMs })),
      runFfmpeg,
      getVideoDurationSeconds
    })

    const trade = createSimulatedClosedTrade(new Date(2026, 4, 13, 3, 51, 10).getTime())
    const clip = await pipeline.createClipForClosedTrade(trade)

    expect(clip.title).toBe('BTCUSDT Binance 13.05.26 03:49:21')
    expect(clip.fileName).toBe('BTCUSDT Binance 13.05.26 03-49-21.mp4')
    expect(clip.videoPath).toBe(join(dataDir, '2026-05-13/BTCUSDT Binance 13.05.26 03-49-21.mp4'))
    expect(getVideoDurationSeconds).toHaveBeenCalledWith(replayPath)
    const ffmpegArgs = runFfmpeg.mock.calls[0][0]
    expect(ffmpegArgs.slice(0, -1)).toEqual([
      '-y',
      '-fflags',
      '+genpts',
      '-ss',
      '6.000',
      '-t',
      '114.000',
      '-i',
      replayPath,
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-fps_mode',
      'cfr',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-avoid_negative_ts',
      'make_zero',
      '-movflags',
      '+faststart'
    ])
    expect(ffmpegArgs.at(-1)).toContain(`${clip.videoPath}.tmp-`)

    const metadata = JSON.parse(await readFile(clip.metadataPath, 'utf8')) as Record<string, unknown>
    expect(metadata).toMatchObject({
      status: 'pending-review',
      replayPath,
      videoPath: clip.videoPath,
      trade: {
        symbol: 'BTCUSDT',
        side: 'LONG'
      },
      trim: {
        startSeconds: 6,
        endSeconds: 120,
        durationSeconds: 114
      },
      replayDurationSeconds: 120,
      replaySavedAtMs
    })
  })

  it('uses the exact replay path returned by OBS instead of rescanning the configured folder', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-data-exact-path-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-empty-replays-'))
    const actualReplayDir = await mkdtemp(join(tmpdir(), 'TradeTools-actual-replays-'))
    const replayPath = join(actualReplayDir, 'Replay 2026-05-13 08-21-25.mp4')
    await writeFile(replayPath, 'fake video')
    const saveTimeMs = new Date(2026, 4, 13, 8, 21, 25).getTime()
    await import('node:fs/promises').then(({ utimes }) => utimes(replayPath, new Date(saveTimeMs), new Date(saveTimeMs)))

    const runFfmpeg = vi.fn(async (args: string[]) => {
      await writeFile(args.at(-1) ?? '', 'trimmed video')
    })
    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...createDefaultSettings(dataDir),
        clip: {
          paddingBeforeSeconds: 3,
          paddingAfterSeconds: 5,
          replayBufferSeconds: 1800,
          replaySourceDir: replayDir,
          outputDir: dataDir
        }
      }),
      saveReplayBuffer: vi.fn(async () => ({
        ok: true,
        message: 'OBS Replay Buffer сохранён, свежий файл найден',
        requestedAtMs: saveTimeMs,
        replayPath
      })),
      runFfmpeg,
      getVideoDurationSeconds: vi.fn(async (path: string) => path === replayPath ? 120 : 120)
    })

    const clip = await pipeline.createClipForClosedTrade(createSimulatedClosedTrade(new Date(2026, 4, 13, 8, 21, 25).getTime()))

    expect(runFfmpeg).toHaveBeenCalledWith(expect.arrayContaining(['-i', replayPath]))
    expect(runFfmpeg.mock.calls[0][0].at(-1)).toContain(`${clip.videoPath}.tmp-`)
  })

  it('exposes local review queue actions without a direct external publishing action', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-local-metadata-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-local-replays-'))
    const replayPath = join(replayDir, 'Replay 2026-05-13 09-00-00.mp4')
    await writeFile(replayPath, 'fake video')
    const saveTimeMs = new Date(2026, 4, 13, 9, 0, 0).getTime()
    await import('node:fs/promises').then(({ utimes }) => utimes(replayPath, new Date(saveTimeMs), new Date(saveTimeMs)))

    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...createDefaultSettings(dataDir),
        clip: {
          paddingBeforeSeconds: 3,
          paddingAfterSeconds: 5,
          replayBufferSeconds: 1800,
          replaySourceDir: replayDir,
          outputDir: dataDir
        }
      }),
      saveReplayBuffer: vi.fn(async () => ({
        ok: true,
        message: 'OBS Replay Buffer сохранён, свежий файл найден',
        requestedAtMs: saveTimeMs,
        replayPath
      })),
      runFfmpeg: vi.fn(async (args: string[]) => {
        await writeFile(args.at(-1) ?? '', 'trimmed video')
      }),
      getVideoDurationSeconds: vi.fn(async (path: string) => path === replayPath ? 120 : 120)
    })
    const clip = await pipeline.createClipForClosedTrade(createSimulatedClosedTrade(saveTimeMs))

    expect(`${legacyPublishMethodPrefix}${legacyVideoProviderName}` in pipeline).toBe(false)
    const metadata = JSON.parse(await readFile(clip.metadataPath, 'utf8')) as Record<string, unknown>
    expect(metadata).not.toHaveProperty(`${legacyVideoProviderKey}VideoId`)
    expect(metadata).not.toHaveProperty(`${legacyVideoProviderKey}Url`)
    expect(metadata).not.toHaveProperty('uploadedAtMs')
  })

  it('removes a clip from the review queue without deleting the local video', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-delete-queue-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-delete-replays-'))
    const replayPath = join(replayDir, 'Replay 2026-05-13 10-00-00.mp4')
    await writeFile(replayPath, 'fake video')
    const saveTimeMs = new Date(2026, 4, 13, 10, 0, 0).getTime()
    await import('node:fs/promises').then(({ utimes }) => utimes(replayPath, new Date(saveTimeMs), new Date(saveTimeMs)))

    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...createDefaultSettings(dataDir),
        clip: {
          paddingBeforeSeconds: 3,
          paddingAfterSeconds: 5,
          replayBufferSeconds: 1800,
          replaySourceDir: replayDir,
          outputDir: dataDir
        }
      }),
      saveReplayBuffer: vi.fn(async () => ({
        ok: true,
        message: 'OBS Replay Buffer сохранён, свежий файл найден',
        requestedAtMs: saveTimeMs,
        replayPath
      })),
      runFfmpeg: vi.fn(async (args: string[]) => {
        await writeFile(args.at(-1) ?? '', 'trimmed video')
      }),
      getVideoDurationSeconds: vi.fn(async (path: string) => path === replayPath ? 120 : 120)
    })
    const clip = await pipeline.createClipForClosedTrade(createSimulatedClosedTrade(saveTimeMs))

    await expect(pipeline.deleteClipFromQueue(clip.metadataPath)).resolves.toEqual({
      ok: true,
      metadataPath: clip.metadataPath
    })
    await expect(access(clip.metadataPath)).rejects.toThrow()
    await expect(access(clip.videoPath)).resolves.toBeUndefined()
    await expect(pipeline.listPendingClips()).resolves.toEqual([])
  })

  it('renames a queued clip video file and updates metadata', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-rename-queue-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-rename-replays-'))
    const replayPath = join(replayDir, 'Replay 2026-05-13 10-30-00.mp4')
    await writeFile(replayPath, 'fake video')
    const saveTimeMs = new Date(2026, 4, 13, 10, 30, 0).getTime()
    await import('node:fs/promises').then(({ utimes }) => utimes(replayPath, new Date(saveTimeMs), new Date(saveTimeMs)))

    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...createDefaultSettings(dataDir),
        clip: {
          paddingBeforeSeconds: 3,
          paddingAfterSeconds: 5,
          replayBufferSeconds: 1800,
          replaySourceDir: replayDir,
          outputDir: dataDir
        }
      }),
      saveReplayBuffer: vi.fn(async () => ({
        ok: true,
        message: 'OBS Replay Buffer сохранён, свежий файл найден',
        requestedAtMs: saveTimeMs,
        replayPath
      })),
      runFfmpeg: vi.fn(async (args: string[]) => {
        await writeFile(args.at(-1) ?? '', 'trimmed video')
      }),
      getVideoDurationSeconds: vi.fn(async (path: string) => path === replayPath ? 120 : 120)
    })
    const clip = await pipeline.createClipForClosedTrade(createSimulatedClosedTrade(saveTimeMs))

    const renamed = await pipeline.renameClipFile({
      metadataPath: clip.metadataPath,
      fileName: 'My custom: clip name.mp4'
    })

    expect(renamed.clip.fileName).toBe('My custom- clip name.mp4')
    expect(renamed.clip.title).toBe('My custom- clip name')
    expect(renamed.clip.videoPath).toBe(join(dataDir, '2026-05-13/My custom- clip name.mp4'))
    await expect(access(clip.videoPath)).rejects.toThrow()
    await expect(access(renamed.clip.videoPath)).resolves.toBeUndefined()
    const metadata = JSON.parse(await readFile(clip.metadataPath, 'utf8')) as Record<string, unknown>
    expect(metadata).toMatchObject({
      fileName: 'My custom- clip name.mp4',
      title: 'My custom- clip name',
      videoPath: renamed.clip.videoPath
    })
    await expect(pipeline.listPendingClips()).resolves.toMatchObject([{
      fileName: 'My custom- clip name.mp4'
    }])
  })

  it('still lists clips created in the old nested clips folder', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-legacy-nested-clips-'))
    const legacyDayDir = join(dataDir, 'clips', '2026-05-13')
    const videoPath = join(legacyDayDir, 'Legacy clip.mp4')
    const metadataPath = join(legacyDayDir, 'Legacy clip.json')
    await mkdir(legacyDayDir, { recursive: true })
    await writeFile(videoPath, 'legacy video')
    await writeFile(metadataPath, JSON.stringify({
      id: 'legacy-clip',
      status: 'pending-review',
      title: 'Legacy clip',
      fileName: 'Legacy clip.mp4',
      videoPath,
      metadataPath,
      symbol: 'BTCUSDT',
      side: 'LONG',
      exchange: 'Binance',
      marketType: 'Futures',
      entryTimeMs: 1,
      exitTimeMs: 2,
      durationSeconds: 1,
      createdAtMs: 3
    }), 'utf8')

    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...createDefaultSettings(dataDir),
        clip: {
          paddingBeforeSeconds: 3,
          paddingAfterSeconds: 5,
          replayBufferSeconds: 1800,
          replaySourceDir: dataDir,
          outputDir: dataDir
        }
      }),
      saveReplayBuffer: vi.fn(async () => ({ ok: false, message: 'not used', requestedAtMs: 0 }))
    })

    await expect(pipeline.listPendingClips()).resolves.toMatchObject([{
      id: 'legacy-clip',
      videoPath
    }])
  })

  it('rejects stale replay files when the trade is outside the measured recording window', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-stale-replay-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-stale-replays-'))
    const replayPath = join(replayDir, 'Replay 2026-05-13 11-00-00.mp4')
    await writeFile(replayPath, 'fake video')
    const saveTimeMs = Date.parse('2026-05-13T11:00:00.000Z')
    await import('node:fs/promises').then(({ utimes }) => utimes(replayPath, new Date(saveTimeMs), new Date(saveTimeMs)))

    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...createDefaultSettings(dataDir),
        clip: {
          paddingBeforeSeconds: 3,
          paddingAfterSeconds: 5,
          replayBufferSeconds: 1800,
          replaySourceDir: replayDir,
          outputDir: dataDir
        }
      }),
      saveReplayBuffer: vi.fn(async () => ({
        ok: true,
        message: 'OBS Replay Buffer сохранён, свежий файл найден',
        requestedAtMs: saveTimeMs,
        replayPath
      })),
      runFfmpeg: vi.fn(),
      getVideoDurationSeconds: vi.fn(async () => 120)
    })
    const staleTrade = {
      ...createSimulatedClosedTrade(saveTimeMs),
      entryTimeMs: Date.parse('2026-05-13T10:20:00.000Z'),
      exitTimeMs: Date.parse('2026-05-13T10:21:00.000Z')
    }

    await expect(pipeline.createClipForClosedTrade(staleTrade)).rejects.toThrow('Сделка не попадает в окно OBS Replay Buffer')
  })

  it('rejects ffmpeg output when the rendered clip duration is too short', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-short-output-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-short-output-replays-'))
    const replayPath = join(replayDir, 'Replay 2026-05-13 12-00-00.mp4')
    await writeFile(replayPath, 'fake video')
    const saveTimeMs = Date.parse('2026-05-13T12:00:00.000Z')
    await import('node:fs/promises').then(({ utimes }) => utimes(replayPath, new Date(saveTimeMs), new Date(saveTimeMs)))

    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...createDefaultSettings(dataDir),
        clip: {
          paddingBeforeSeconds: 3,
          paddingAfterSeconds: 5,
          replayBufferSeconds: 1800,
          replaySourceDir: replayDir,
          outputDir: dataDir
        }
      }),
      saveReplayBuffer: vi.fn(async () => ({
        ok: true,
        message: 'OBS Replay Buffer сохранён, свежий файл найден',
        requestedAtMs: saveTimeMs,
        replayPath
      })),
      runFfmpeg: vi.fn(async (args: string[]) => {
        await writeFile(args.at(-1) ?? '', 'bad')
      }),
      getVideoDurationSeconds: vi.fn(async (path: string) => path === replayPath ? 120 : 0.2)
    })

    await expect(pipeline.createClipForClosedTrade(createSimulatedClosedTrade(saveTimeMs))).rejects.toThrow('ffmpeg создал слишком короткий клип')
  })

  it('rejects low-FPS OBS replays before rendering a broken clip', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-low-fps-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-low-fps-replays-'))
    const replayPath = join(replayDir, 'Replay 2026-05-13 12-30-00.mp4')
    await writeFile(replayPath, 'low fps replay')
    const saveTimeMs = Date.parse('2026-05-13T12:30:00.000Z')
    await import('node:fs/promises').then(({ utimes }) => utimes(replayPath, new Date(saveTimeMs), new Date(saveTimeMs)))
    const runFfmpeg = vi.fn()

    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...createDefaultSettings(dataDir),
        clip: {
          paddingBeforeSeconds: 3,
          paddingAfterSeconds: 5,
          replayBufferSeconds: 1800,
          replaySourceDir: replayDir,
          outputDir: dataDir
        }
      }),
      saveReplayBuffer: vi.fn(async () => ({
        ok: true,
        message: 'OBS Replay Buffer сохранён, свежий файл найден',
        requestedAtMs: saveTimeMs,
        replayPath
      })),
      runFfmpeg,
      getVideoDetails: vi.fn(async () => ({
        durationSeconds: 120,
        averageFrameRate: 2.7
      }))
    })

    await expect(pipeline.createClipForClosedTrade(createSimulatedClosedTrade(saveTimeMs))).rejects.toThrow('OBS replay-файл содержит только 2.7 fps')
    expect(runFfmpeg).not.toHaveBeenCalled()
  })

  it('keeps an existing valid clip when a duplicate render produces an invalid mp4', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-atomic-output-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-atomic-output-replays-'))
    const replayPath = join(replayDir, 'Replay 2026-05-14 21-00-38.mp4')
    const saveTimeMs = Date.parse('2026-05-14T18:00:38.000Z')
    const trade = {
      ...createSimulatedClosedTrade(saveTimeMs),
      id: 'binance-futures-AIGENSYNUSDT-1778781632034',
      symbol: 'AIGENSYNUSDT',
      entryTimeMs: Date.parse('2026-05-14T18:00:32.034Z'),
      exitTimeMs: Date.parse('2026-05-14T18:00:35.902Z')
    }
    const paths = buildClipOutputPaths(dataDir, trade)
    await writeFile(replayPath, 'valid replay')
    await import('node:fs/promises').then(({ utimes }) => utimes(replayPath, new Date(saveTimeMs), new Date(saveTimeMs)))
    await mkdir(paths.dayFolder, { recursive: true })
    await writeFile(paths.videoPath, 'existing valid clip')

    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...createDefaultSettings(dataDir),
        clip: {
          paddingBeforeSeconds: 3,
          paddingAfterSeconds: 5,
          replayBufferSeconds: 1800,
          replaySourceDir: replayDir,
          outputDir: dataDir
        }
      }),
      saveReplayBuffer: vi.fn(async () => ({
        ok: true,
        message: 'OBS Replay Buffer сохранён, свежий файл найден',
        requestedAtMs: saveTimeMs,
        replayPath
      })),
      runFfmpeg: vi.fn(async (args: string[]) => {
        await writeFile(args.at(-1) ?? '', 'invalid duplicate render')
      }),
      getVideoDurationSeconds: vi.fn(async (path: string) => {
        if (path === replayPath) return 27
        throw new Error('ffprobe exited with code 1: moov atom not found')
      })
    })

    await expect(pipeline.createClipForClosedTrade(trade)).rejects.toThrow('ffprobe exited with code 1')
    await expect(readFile(paths.videoPath, 'utf8')).resolves.toBe('existing valid clip')
  })
})
