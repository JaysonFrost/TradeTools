import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { createTradeClipPipeline } from '../../src/main/services/trades/tradeClipPipeline'
import { createSimulatedClosedTrade } from '../../src/main/services/trades/simulatedTradePipeline'

describe('tradeClipPipeline', () => {
  it('saves OBS replay, trims it into the dated clip folder, and writes metadata json', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'trade-clipper-data-'))
    const replayDir = await mkdtemp(join(tmpdir(), 'trade-clipper-obs-'))
    const replayPath = join(replayDir, 'Replay 2026-05-13 03-51-12.mp4')
    await writeFile(replayPath, 'fake video')

    const requestedAtMs = Date.parse('2026-05-13T03:51:10.000Z')
    const replaySavedAtMs = Date.parse('2026-05-13T03:51:12.000Z')
    await import('node:fs/promises').then(({ utimes }) => utimes(replayPath, new Date(replaySavedAtMs), new Date(replaySavedAtMs)))

    const runFfmpeg = vi.fn(async (args: string[]) => {
      await writeFile(args.at(-1) ?? '', 'trimmed video')
    })
    const pipeline = createTradeClipPipeline({
      getSettings: async () => ({
        language: 'ru',
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
        },
        access: {
          subscriptionRequired: true,
          telegramBotRequired: true,
          discordGuildGateEnabled: true,
          adminPanelEnabled: true
        }
      }),
      saveReplayBuffer: vi.fn(async () => ({ ok: true, message: 'OBS Replay Buffer сохранён', requestedAtMs })),
      runFfmpeg
    })

    const trade = createSimulatedClosedTrade(Date.parse('2026-05-13T03:51:10.000Z'))
    const clip = await pipeline.createClipForClosedTrade(trade)

    expect(clip.fileName).toBe('2026-05-13_03-49-21_BINANCE_FUTURES_BTCUSDT_LONG.mp4')
    expect(clip.videoPath).toBe(join(dataDir, 'clips/2026-05-13/2026-05-13_03-49-21_BINANCE_FUTURES_BTCUSDT_LONG.mp4'))
    expect(runFfmpeg).toHaveBeenCalledWith(['-y', '-ss', '1686.000', '-to', '1800.000', '-i', replayPath, '-c', 'copy', clip.videoPath])

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
        startSeconds: 1686,
        endSeconds: 1800,
        durationSeconds: 114
      }
    })
  })
})
