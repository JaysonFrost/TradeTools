import { EventEmitter } from 'node:events'
import { access, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultSettings } from '../../src/main/services/settings/settings'
import { createTradeClipPipeline, waitForFfmpegProcessExit } from '../../src/main/services/trades/tradeClipPipeline'
import { createSimulatedClosedTrade } from '../../src/main/services/trades/simulatedTradePipeline'
import { buildClipOutputPaths } from '../../src/main/services/video/clipPaths'
import { calculateFfmpegRenderThreads } from '../../src/main/services/video/ffmpegCommand'

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
    const updateTmmTradeVideoPath = vi.fn(async () => true)
    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...createDefaultSettings(dataDir),
        recording: {
          ...createDefaultSettings(dataDir).recording,
          videoEncoder: 'cpu' as const
        },
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
      getVideoDurationSeconds,
      findTmmTradeUrl: vi.fn(async () => 'https://tradermake.money/app2/account/my-trades/42'),
      updateTmmTradeVideoPath
    })

    const trade = createSimulatedClosedTrade(new Date(2026, 4, 13, 3, 51, 10).getTime())
    const clip = await pipeline.createClipForClosedTrade(trade)

    expect(clip.title).toBe('BTCUSDT Binance 13.05.26 03:49:21')
    expect(clip.fileName).toBe('BTCUSDT Binance 13.05.26 03-49-21.mp4')
    expect(clip.videoPath).toBe(join(dataDir, '2026-05-13/BTCUSDT Binance 13.05.26 03-49-21.mp4'))
    expect(getVideoDurationSeconds).toHaveBeenCalledWith(replayPath)
    const ffmpegArgs = runFfmpeg.mock.calls[0][0]
    const renderThreads = String(calculateFfmpegRenderThreads())
    expect(ffmpegArgs.slice(0, -1)).toEqual([
      '-y',
      '-threads',
      renderThreads,
      '-filter_threads',
      '1',
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
      '-threads',
      renderThreads,
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
    expect(updateTmmTradeVideoPath).toHaveBeenCalledWith(
      'https://tradermake.money/app2/account/my-trades/42',
      clip.videoPath
    )

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
      replaySavedAtMs,
      tmmTradeUrl: 'https://tradermake.money/app2/account/my-trades/42',
      tmmVideoPath: clip.videoPath
    })
    await expect(pipeline.listPendingClips()).resolves.toEqual([expect.objectContaining({
      tmmTradeUrl: 'https://tradermake.money/app2/account/my-trades/42'
    })])
  })

  it('passes the selected recording encoder into ordinary clip rendering', async () => {
    const source = await readFile(new URL('../../src/main/services/trades/tradeClipPipeline.ts', import.meta.url), 'utf8')

    expect(source).toContain('videoEncoder: settings.recording.videoEncoder')
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

    const tmmTradeUrl = 'https://tradermake.money/app2/account/my-trades/73'
    const updateTmmTradeVideoPath = vi.fn(async () => true)
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
      getVideoDurationSeconds: vi.fn(async (path: string) => path === replayPath ? 120 : 120),
      findTmmTradeUrl: vi.fn(async () => tmmTradeUrl),
      updateTmmTradeVideoPath
    })
    const clip = await pipeline.createClipForClosedTrade(createSimulatedClosedTrade(saveTimeMs))

    const renamed = await pipeline.renameClipFile({
      metadataPath: clip.metadataPath,
      fileName: 'My custom: clip name.mp4'
    })

    expect(renamed.clip.fileName).toBe('My custom- clip name.mp4')
    expect(renamed.clip.title).toBe('My custom- clip name')
    expect(renamed.clip.videoPath).toBe(join(dataDir, '2026-05-13/My custom- clip name.mp4'))
    expect(updateTmmTradeVideoPath).toHaveBeenLastCalledWith(tmmTradeUrl, renamed.clip.videoPath)
    await expect(access(clip.videoPath)).rejects.toThrow()
    await expect(access(renamed.clip.videoPath)).resolves.toBeUndefined()
    const metadata = JSON.parse(await readFile(clip.metadataPath, 'utf8')) as Record<string, unknown>
    expect(metadata).toMatchObject({
      fileName: 'My custom- clip name.mp4',
      title: 'My custom- clip name',
      videoPath: renamed.clip.videoPath,
      tmmVideoPath: renamed.clip.videoPath
    })
    await expect(pipeline.listPendingClips()).resolves.toMatchObject([{
      fileName: 'My custom- clip name.mp4'
    }])
  })

  it('retries a TMM video path update during synchronization until it succeeds', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-tmm-video-retry-'))
    const dayDir = join(dataDir, '2026-08-06')
    const videoPath = join(dayDir, 'BTCUSDT retry.mp4')
    const metadataPath = join(dayDir, 'BTCUSDT retry.json')
    const tmmTradeUrl = 'https://tradermake.money/app2/account/my-trades/91'
    const trade = createSimulatedClosedTrade(Date.parse('2026-08-06T13:19:00.000Z'))
    await mkdir(dayDir, { recursive: true })
    await writeFile(videoPath, 'video')
    await writeFile(metadataPath, JSON.stringify({
      id: 'retry-clip',
      status: 'pending-review',
      title: 'BTCUSDT retry',
      fileName: 'BTCUSDT retry.mp4',
      videoPath,
      metadataPath,
      symbol: trade.symbol,
      side: trade.side,
      exchange: trade.exchange,
      marketType: trade.marketType,
      entryTimeMs: trade.entryTimeMs,
      exitTimeMs: trade.exitTimeMs,
      durationSeconds: 60,
      createdAtMs: trade.exitTimeMs,
      tmmTradeUrl,
      trade
    }), 'utf8')
    const updateTmmTradeVideoPath = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...createDefaultSettings(dataDir),
        clip: {
          ...createDefaultSettings(dataDir).clip,
          outputDir: dataDir
        }
      }),
      saveReplayBuffer: vi.fn(async () => ({ ok: false, message: 'not used', requestedAtMs: 0 })),
      updateTmmTradeVideoPath
    })

    await expect(pipeline.syncTmmTradeLinks()).resolves.toEqual({ checkedCount: 0, matchedCount: 0 })
    expect(JSON.parse(await readFile(metadataPath, 'utf8'))).not.toHaveProperty('tmmVideoPath')

    await expect(pipeline.syncTmmTradeLinks()).resolves.toEqual({ checkedCount: 0, matchedCount: 0 })
    expect(updateTmmTradeVideoPath).toHaveBeenCalledTimes(2)
    expect(updateTmmTradeVideoPath).toHaveBeenLastCalledWith(tmmTradeUrl, videoPath)
    expect(JSON.parse(await readFile(metadataPath, 'utf8'))).toMatchObject({ tmmVideoPath: videoPath })
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
    await expect(access(replayPath)).rejects.toThrow()
    await expect(stat(clip.metadataPath)).resolves.toBeDefined()
    const metadata = JSON.parse(await readFile(clip.metadataPath, 'utf8'))
    expect(metadata.replayPath).toBe(clip.videoPath)
    expect(metadata.trim).toEqual({ startSeconds: 0, endSeconds: 131, durationSeconds: 131 })
  })

  it('rejects a ready built-in clip whose video ends before the trade and padding', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-short-ready-clip-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-short-ready-replay-'))
    const replayPath = join(replayDir, 'truncated-long-trade.mp4')
    const entryTimeMs = 1_786_057_767_524
    const exitTimeMs = 1_786_057_835_795
    const trade = {
      ...createSimulatedClosedTrade(exitTimeMs),
      id: 'terminal-BEATUSDT-long-trade',
      symbol: 'BEATUSDT',
      entryTimeMs,
      exitTimeMs
    }
    await writeFile(replayPath, 'truncated ready clip')

    const defaultSettings = createDefaultSettings(dataDir)
    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...defaultSettings,
        recording: {
          ...defaultSettings.recording,
          mode: 'window'
        },
        clip: {
          ...defaultSettings.clip,
          paddingBeforeSeconds: 3,
          paddingAfterSeconds: 2,
          outputDir: dataDir
        }
      }),
      saveReplayBuffer: vi.fn(async () => ({
        ok: true,
        message: 'Встроенный replay сохранён',
        requestedAtMs: exitTimeMs,
        replayPath,
        readyClip: true
      })),
      getVideoDetails: vi.fn(async () => ({
        durationSeconds: 51.5,
        averageFrameRate: 30
      }))
    })

    await expect(pipeline.createClipForClosedTrade(trade)).rejects.toThrow(/51\.50с.*73\.27с/)

    const paths = buildClipOutputPaths(dataDir, trade)
    await expect(access(paths.videoPath)).rejects.toThrow()
    await expect(access(paths.metadataPath)).rejects.toThrow()
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

  it('waits for the ffmpeg process to exit after cancellation', async () => {
    const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> }
    child.kill = vi.fn(() => true)
    const controller = new AbortController()
    const completion = waitForFfmpegProcessExit(
      child as unknown as Parameters<typeof waitForFfmpegProcessExit>[0],
      controller.signal
    )
    let outcome = 'pending'
    const observedCompletion = completion.then(
      () => { outcome = 'resolved' },
      () => { outcome = 'rejected' }
    )

    controller.abort()
    await Promise.resolve()

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(outcome).toBe('pending')

    child.emit('error', new Error('termination still in progress'))
    await Promise.resolve()
    expect(outcome).toBe('pending')

    child.emit('close', null)
    await expect(completion).rejects.toThrow('Сохранение клипа отменено')
    await observedCompletion
    expect(outcome).toBe('rejected')
  })

  it('removes the temporary output when cancellation arrives during final validation', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-cancel-before-commit-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-cancel-replay-'))
    const replayPath = join(replayDir, 'ready.mp4')
    const entryTimeMs = Date.parse('2026-08-07T12:10:05.000Z')
    const trade = {
      ...createSimulatedClosedTrade(entryTimeMs + 3_000, 3_000),
      id: 'cancel-before-commit',
      entryTimeMs,
      exitTimeMs: entryTimeMs + 3_000
    }
    const paths = buildClipOutputPaths(dataDir, trade)
    const controller = new AbortController()
    await writeFile(replayPath, 'ready built-in clip')
    const defaultSettings = createDefaultSettings(dataDir)
    let probeCount = 0
    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...defaultSettings,
        recording: { ...defaultSettings.recording, mode: 'window' },
        clip: {
          ...defaultSettings.clip,
          paddingBeforeSeconds: 3,
          paddingAfterSeconds: 5,
          outputDir: dataDir
        }
      }),
      saveReplayBuffer: vi.fn(async () => ({
        ok: true,
        message: 'Встроенный replay сохранён',
        requestedAtMs: trade.exitTimeMs,
        replayPath,
        readyClip: true
      })),
      getVideoDetails: vi.fn(async () => {
        probeCount += 1
        if (probeCount === 2) controller.abort()
        return { durationSeconds: 11, averageFrameRate: 30 }
      })
    })

    await expect(pipeline.createClipForClosedTrade(trade, { signal: controller.signal }))
      .rejects.toThrow('Сохранение клипа отменено')
    await expect(access(paths.videoPath)).rejects.toThrow()
    await expect(access(paths.metadataPath)).rejects.toThrow()
    const dayEntries = await readdir(paths.dayFolder).catch(() => [])
    expect(dayEntries.some((name) => name.includes('.tmp-'))).toBe(false)
  })

  it('rolls back final video and metadata when cancellation arrives after rename', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-late-cancel-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-late-cancel-replay-'))
    const replayPath = join(replayDir, 'ready.mp4')
    const entryTimeMs = new Date(2026, 7, 7, 12, 12, 5).getTime()
    const trade = {
      ...createSimulatedClosedTrade(entryTimeMs + 3_000, 3_000),
      id: 'late-cancel-after-rename',
      entryTimeMs,
      exitTimeMs: entryTimeMs + 3_000
    }
    const paths = buildClipOutputPaths(dataDir, trade)
    const controller = new AbortController()
    await writeFile(replayPath, 'ready built-in clip')
    const defaultSettings = createDefaultSettings(dataDir)
    let resolveTmmLookup: (url: string | undefined) => void = () => undefined
    const tmmLookup = new Promise<string | undefined>((resolve) => {
      resolveTmmLookup = resolve
    })
    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...defaultSettings,
        recording: { ...defaultSettings.recording, mode: 'window' },
        clip: {
          ...defaultSettings.clip,
          paddingBeforeSeconds: 3,
          paddingAfterSeconds: 5,
          outputDir: dataDir
        }
      }),
      saveReplayBuffer: vi.fn(async () => ({
        ok: true,
        message: 'Встроенный replay сохранён',
        requestedAtMs: trade.exitTimeMs,
        replayPath,
        readyClip: true
      })),
      getVideoDetails: vi.fn(async () => ({ durationSeconds: 11, averageFrameRate: 30 })),
      findTmmTradeUrl: vi.fn(() => tmmLookup)
    })

    const completion = pipeline.createClipForClosedTrade(trade, { signal: controller.signal })
    let finalVideoVisible = false
    for (let attempt = 0; attempt < 100 && !finalVideoVisible; attempt += 1) {
      finalVideoVisible = await access(paths.videoPath).then(() => true).catch(() => false)
      if (!finalVideoVisible) await new Promise<void>((resolve) => setTimeout(resolve, 2))
    }
    expect(finalVideoVisible).toBe(true)

    controller.abort()
    resolveTmmLookup('https://tradermake.money/app2/account/my-trades/late-cancel')

    await expect(completion).rejects.toThrow('Сохранение клипа отменено')
    await expect(access(paths.videoPath)).rejects.toThrow()
    await expect(access(paths.metadataPath)).rejects.toThrow()
  })

  it('has a clear commit point before deleting the consumed replay', async () => {
    const source = await readFile(resolve('src/main/services/trades/tradeClipPipeline.ts'), 'utf8')
    const replayCleanupStart = source.indexOf("if ((settings.recording.mode === 'obs' || readyClip)")
    const successfulReturn = source.indexOf('return item', replayCleanupStart)
    const replayCleanup = source.slice(replayCleanupStart, successfulReturn)

    expect(replayCleanup).toContain('await unlink(replayPath)')
    expect(replayCleanup).not.toContain('throwIfAborted')
  })

  it('keeps parallel same-symbol same-second clips in separate readable files', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-parallel-paths-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-parallel-replays-'))
    const replayPaths = [join(replayDir, 'one.mp4'), join(replayDir, 'two.mp4')]
    await Promise.all([
      writeFile(replayPaths[0], 'first clip'),
      writeFile(replayPaths[1], 'second clip')
    ])
    const entryTimeMs = new Date(2026, 7, 7, 12, 15, 10, 250).getTime()
    const baseTrade = {
      ...createSimulatedClosedTrade(entryTimeMs + 3_000, 3_000),
      symbol: 'BEATUSDT',
      entryTimeMs,
      exitTimeMs: entryTimeMs + 3_000
    }
    const trades = [
      { ...baseTrade, id: 'parallel-one' },
      { ...baseTrade, id: 'parallel-two' }
    ]
    const defaultSettings = createDefaultSettings(dataDir)
    let replayIndex = 0
    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        ...defaultSettings,
        recording: { ...defaultSettings.recording, mode: 'window' },
        clip: {
          ...defaultSettings.clip,
          paddingBeforeSeconds: 3,
          paddingAfterSeconds: 5,
          outputDir: dataDir
        }
      }),
      saveReplayBuffer: vi.fn(async () => {
        const replayPath = replayPaths[replayIndex++]
        return {
          ok: true,
          message: 'Встроенный replay сохранён',
          requestedAtMs: baseTrade.exitTimeMs,
          replayPath,
          readyClip: true
        }
      }),
      getVideoDetails: vi.fn(async () => ({ durationSeconds: 11, averageFrameRate: 30 }))
    })

    const clips = await Promise.all(trades.map((trade) => pipeline.createClipForClosedTrade(trade)))

    expect(new Set(clips.map((clip) => clip.videoPath)).size).toBe(2)
    expect(clips.map((clip) => clip.fileName).sort()).toEqual([
      'BEATUSDT Binance 07.08.26 12-15-10 (2).mp4',
      'BEATUSDT Binance 07.08.26 12-15-10.mp4'
    ])
    await Promise.all(clips.flatMap((clip) => [access(clip.videoPath), access(clip.metadataPath)]))
  })

  it('uses the enqueue-time recording settings while a job waits in the scheduler', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'TradeTools-settings-snapshot-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'TradeTools-settings-snapshot-replay-'))
    const replayPath = join(replayDir, 'ready.mp4')
    const entryTimeMs = new Date(2026, 7, 7, 12, 20, 10).getTime()
    const trade = {
      ...createSimulatedClosedTrade(entryTimeMs + 3_000, 3_000),
      id: 'settings-snapshot',
      entryTimeMs,
      exitTimeMs: entryTimeMs + 3_000
    }
    await writeFile(replayPath, 'ready built-in clip')
    const snapshot = createDefaultSettings(dataDir)
    snapshot.recording.mode = 'window'
    snapshot.clip.outputDir = dataDir
    snapshot.clip.paddingBeforeSeconds = 3
    snapshot.clip.paddingAfterSeconds = 5
    const liveSettings = createDefaultSettings(dataDir)
    liveSettings.recording.mode = 'obs'
    const getSettings = vi.fn(async () => liveSettings)
    const saveReplayBuffer = vi.fn(async () => ({
      ok: true as const,
      message: 'Встроенный replay сохранён',
      requestedAtMs: trade.exitTimeMs,
      replayPath,
      readyClip: true
    }))
    const pipeline = createTradeClipPipeline({
      getSettings,
      saveReplayBuffer,
      getVideoDetails: vi.fn(async () => ({ durationSeconds: 11, averageFrameRate: 30 }))
    })

    const clip = await pipeline.createClipForClosedTrade(trade, { settings: snapshot })

    expect(getSettings).not.toHaveBeenCalled()
    expect(saveReplayBuffer).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ recording: expect.objectContaining({ mode: 'window' }) })
    }))
    expect(clip.videoPath.startsWith(dataDir)).toBe(true)
  })
})
