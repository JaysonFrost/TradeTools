import { access, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
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

  it('removes the consumed OBS replay after the final clip is written', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-data-remove-obs-replay-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-remove-obs-replay-'))
    const replayPath = join(replayDir, 'Replay 2026-05-13 08-30-00.mp4')
    await writeFile(replayPath, 'fake video')
    const saveTimeMs = Date.parse('2026-05-13T08:30:00.000Z')
    await import('node:fs/promises').then(({ utimes }) => utimes(replayPath, new Date(saveTimeMs), new Date(saveTimeMs)))
    const defaultSettings = createDefaultSettings(dataDir)
    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...defaultSettings,
        recording: {
          ...defaultSettings.recording,
          mode: 'obs'
        },
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

    await expect(access(clip.videoPath)).resolves.toBeUndefined()
    await expect(access(replayPath)).rejects.toThrow()
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

  it('deletes a queued clip video file and removes it from the review queue', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-delete-file-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-delete-file-replays-'))
    const replayPath = join(replayDir, 'Replay 2026-05-13 10-15-00.mp4')
    await writeFile(replayPath, 'fake video')
    const saveTimeMs = new Date(2026, 4, 13, 10, 15, 0).getTime()
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

    await expect(pipeline.deleteClipFile(clip.metadataPath)).resolves.toEqual({
      ok: true,
      metadataPath: clip.metadataPath,
      videoPath: clip.videoPath
    })
    await expect(access(clip.metadataPath)).rejects.toThrow()
    await expect(access(clip.videoPath)).rejects.toThrow()
    await expect(pipeline.listPendingClips()).resolves.toEqual([])
  })

  it('adds a finished free recording to the review queue', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-free-recording-queue-'))
    const dayDir = join(dataDir, '2026-06-15')
    const videoPath = join(dayDir, 'Запись стаканов 15.06.26 12-00-00 - 15.06.26 12-01-00.mp4')
    await mkdir(dayDir, { recursive: true })
    await writeFile(videoPath, 'free recording video')
    const startedAtMs = Date.parse('2026-06-15T12:00:00.000Z')
    const endedAtMs = Date.parse('2026-06-15T12:01:00.000Z')
    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...createDefaultSettings(dataDir),
        clip: {
          ...createDefaultSettings(dataDir).clip,
          outputDir: dataDir
        }
      }),
      saveReplayBuffer: vi.fn(async () => ({ ok: false, message: 'not used', requestedAtMs: 0 })),
      getVideoDetails: vi.fn(async () => ({
        durationSeconds: 60,
        averageFrameRate: 30
      }))
    })

    const clip = await pipeline.addFreeRecordingToQueue({
      videoPath,
      fileName: 'Запись стаканов 15.06.26 12-00-00 - 15.06.26 12-01-00.mp4',
      startedAtMs,
      endedAtMs,
      durationSeconds: 60
    })

    expect(clip.title).toBe('Запись стаканов 15.06.26 12-00-00 - 15.06.26 12-01-00')
    expect(clip.symbol).toBe('FREE')
    await expect(pipeline.listPendingClips()).resolves.toMatchObject([{
      id: clip.id,
      videoPath,
      durationSeconds: 60
    }])
    await expect(access(clip.metadataPath)).resolves.toBeUndefined()
  })

  it('clears all queued metadata while keeping video files on disk', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-clear-queue-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-clear-queue-replays-'))
    const replayPath = join(replayDir, 'Replay 2026-05-13 10-20-00.mp4')
    await writeFile(replayPath, 'fake video')
    const saveTimeMs = new Date(2026, 4, 13, 10, 20, 0).getTime()
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

    await expect(pipeline.clearQueue()).resolves.toEqual({
      ok: true,
      removedCount: 1,
      deletedFileCount: 0
    })
    await expect(access(clip.metadataPath)).rejects.toThrow()
    await expect(access(clip.videoPath)).resolves.toBeUndefined()
    await expect(pipeline.listPendingClips()).resolves.toEqual([])
  })

  it('deletes every queued video file and clears the queue', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-delete-queue-files-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-delete-queue-files-replays-'))
    const replayPath = join(replayDir, 'Replay 2026-05-13 10-25-00.mp4')
    await writeFile(replayPath, 'fake video')
    const saveTimeMs = new Date(2026, 4, 13, 10, 25, 0).getTime()
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

    await expect(pipeline.deleteQueueFiles()).resolves.toEqual({
      ok: true,
      removedCount: 1,
      deletedFileCount: 1
    })
    await expect(access(clip.metadataPath)).rejects.toThrow()
    await expect(access(clip.videoPath)).rejects.toThrow()
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

  it('accepts very short rendered clips when ffmpeg output closely matches the requested trim', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-tiny-output-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-tiny-output-replays-'))
    const replayPath = join(replayDir, 'Replay 2026-05-13 12-10-00.mp4')
    await writeFile(replayPath, 'tiny video')
    const saveTimeMs = Date.parse('2026-05-13T12:10:00.000Z')
    await import('node:fs/promises').then(({ utimes }) => utimes(replayPath, new Date(saveTimeMs), new Date(saveTimeMs)))

    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...createDefaultSettings(dataDir),
        clip: {
          paddingBeforeSeconds: 0,
          paddingAfterSeconds: 0,
          replayBufferSeconds: 60,
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
        await writeFile(args.at(-1) ?? '', 'tiny')
      }),
      getVideoDetails: vi.fn(async (path: string) => path === replayPath
        ? { durationSeconds: 10, averageFrameRate: 60 }
        : { durationSeconds: 0.93, averageFrameRate: 60 })
    })
    const tinyTrade = {
      ...createSimulatedClosedTrade(saveTimeMs, 934),
      exitTimeMs: saveTimeMs
    }

    await expect(pipeline.createClipForClosedTrade(tinyTrade)).resolves.toMatchObject({
      symbol: tinyTrade.symbol,
      durationSeconds: 1
    })
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
        recording: {
          ...createDefaultSettings(dataDir).recording,
          mode: 'obs'
        },
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

  it('copies an already prepared built-in recorder clip without a second ffmpeg render', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-window-ready-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-window-ready-replays-'))
    const replayPath = join(replayDir, 'window-ready.mp4')
    const saveTimeMs = Date.parse('2026-05-14T18:00:38.000Z')
    const trade = {
      ...createSimulatedClosedTrade(saveTimeMs),
      id: 'terminal-BTCUSDT-1778781632034',
      entryTimeMs: Date.parse('2026-05-14T17:58:32.000Z'),
      exitTimeMs: Date.parse('2026-05-14T18:00:35.000Z')
    }
    await writeFile(replayPath, 'ready built-in clip')
    await import('node:fs/promises').then(({ utimes }) => utimes(replayPath, new Date(saveTimeMs), new Date(saveTimeMs)))

    const runFfmpeg = vi.fn()
    const defaultSettings = createDefaultSettings(dataDir)
    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...defaultSettings,
        recording: {
          ...defaultSettings.recording,
          mode: 'window'
        },
        clip: {
          paddingBeforeSeconds: 3,
          paddingAfterSeconds: 5,
          replayBufferSeconds: 600,
          replaySourceDir: replayDir,
          outputDir: dataDir
        }
      }),
      saveReplayBuffer: vi.fn(async () => ({
        ok: true,
        message: 'Встроенный replay сохранён',
        requestedAtMs: saveTimeMs,
        replayPath,
        readyClip: true
      })),
      runFfmpeg,
      getVideoDetails: vi.fn(async () => ({
        durationSeconds: 131,
        averageFrameRate: 30
      }))
    })

    const clip = await pipeline.createClipForClosedTrade(trade)

    expect(runFfmpeg).not.toHaveBeenCalled()
    expect(await readFile(clip.videoPath, 'utf8')).toBe('ready built-in clip')
    await expect(stat(clip.metadataPath)).resolves.toBeDefined()
    const metadata = JSON.parse(await readFile(clip.metadataPath, 'utf8'))
    expect(metadata.replayPath).toBe(clip.videoPath)
    expect(metadata.trim).toEqual({ startSeconds: 0, endSeconds: 131, durationSeconds: 131 })
  })

  it('passes the selected capture target to built-in replay export and records it in metadata', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-targeted-clip-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-targeted-replays-'))
    const replayPath = join(replayDir, 'screen-ready.mp4')
    const saveTimeMs = Date.parse('2026-06-17T18:00:10.000Z')
    const captureTarget = { id: 'screen:1', name: 'Экран 1', type: 'screen' as const, displayId: '1' }
    await writeFile(replayPath, 'ready built-in clip')
    await import('node:fs/promises').then(({ utimes }) => utimes(replayPath, new Date(saveTimeMs), new Date(saveTimeMs)))
    const defaultSettings = createDefaultSettings(dataDir)
    const saveReplayBuffer = vi.fn(async () => ({
      ok: true,
      message: 'Встроенный replay сохранён',
      requestedAtMs: saveTimeMs,
      replayPath,
      readyClip: true
    }))
    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...defaultSettings,
        recording: {
          ...defaultSettings.recording,
          mode: 'window',
          sourceType: 'screen',
          captureTargets: [captureTarget],
          saveTargetMode: 'selected',
          saveTargetId: captureTarget.id
        },
        clip: {
          ...defaultSettings.clip,
          outputDir: dataDir
        }
      }),
      saveReplayBuffer,
      getVideoDetails: vi.fn(async () => ({
        durationSeconds: 10,
        averageFrameRate: 30
      }))
    })

    const clip = await (pipeline.createClipForClosedTrade as any)(createSimulatedClosedTrade(saveTimeMs, 3_000), { captureTarget })

    expect(saveReplayBuffer).toHaveBeenCalledWith(expect.objectContaining({ captureTarget }))
    expect(clip.fileName).toContain('Экран 1')
    const metadata = JSON.parse(await readFile(clip.metadataPath, 'utf8'))
    expect(metadata.captureTarget).toEqual(captureTarget)
    expect(metadata.trade.recordingTarget).toEqual(captureTarget)
  })

  it('creates a manual buffer clip without a fake BTC trade', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-manual-buffer-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-manual-buffer-replays-'))
    const replayPath = join(replayDir, 'manual-buffer.mp4')
    const requestedAtMs = Date.parse('2026-06-17T18:10:00.000Z')
    const captureTarget = { id: 'screen:2', name: 'Экран 2', type: 'screen' as const, displayId: '2' }
    await writeFile(replayPath, 'manual buffer clip')
    await import('node:fs/promises').then(({ utimes }) => utimes(replayPath, new Date(requestedAtMs), new Date(requestedAtMs)))
    const defaultSettings = createDefaultSettings(dataDir)
    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...defaultSettings,
        recording: {
          ...defaultSettings.recording,
          mode: 'window',
          sourceType: 'screen',
          captureTargets: [captureTarget],
          saveTargetMode: 'selected',
          saveTargetId: captureTarget.id
        },
        clip: {
          ...defaultSettings.clip,
          replayBufferSeconds: 60,
          outputDir: dataDir
        }
      }),
      saveReplayBuffer: vi.fn(async () => ({
        ok: true,
        message: 'Встроенный replay сохранён',
        requestedAtMs,
        replayPath,
        readyClip: true
      })),
      getVideoDetails: vi.fn(async () => ({
        durationSeconds: 60,
        averageFrameRate: 30
      })),
      now: () => requestedAtMs
    })

    const clip = await (pipeline as any).createManualBufferClip({ requestedAtMs, captureTarget })

    expect(clip.title).toContain('Буфер')
    expect(clip.title).toContain('Экран 2')
    expect(clip.title).not.toContain('BTC')
    expect(clip.symbol).toBe('BUFFER')
    const metadata = JSON.parse(await readFile(clip.metadataPath, 'utf8'))
    expect(metadata.trade).toMatchObject({
      exchange: 'TradeTools',
      marketType: 'Manual buffer',
      symbol: 'BUFFER',
      side: 'BUFFER'
    })
    expect(metadata.captureTarget).toEqual(captureTarget)
  })

  it('keeps an existing valid clip when a duplicate render produces an invalid mp4', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-atomic-output-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-atomic-output-replays-'))
    const replayPath = join(replayDir, 'Replay 2026-05-14 21-00-38.mp4')
    const saveTimeMs = Date.parse('2026-05-14T18:00:38.000Z')
    const trade = {
      ...createSimulatedClosedTrade(saveTimeMs),
      id: 'terminal-AIGENSYNUSDT-1778781632034',
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
