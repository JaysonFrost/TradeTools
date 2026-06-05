import { describe, expect, it } from 'vitest'
import { createSimulatedClosedTrade, planSimulatedClip } from '../../src/main/services/trades/simulatedTradePipeline'

describe('simulatedTradePipeline', () => {
  it('creates a deterministic closed trade for local pipeline tests', () => {
    const trade = createSimulatedClosedTrade(new Date(2026, 4, 13, 3, 51, 10).getTime())

    expect(trade.symbol).toBe('BTCUSDT')
    expect(trade.side).toBe('LONG')
    expect(trade.status).toBe('closed')
    expect(trade.exitTimeMs - trade.entryTimeMs).toBe(109000)
  })

  it('plans output paths and trim args for a simulated clip', () => {
    const trade = createSimulatedClosedTrade(new Date(2026, 4, 13, 3, 51, 10).getTime())
    const plan = planSimulatedClip({
      dataDir: '/Users/igor/TradeClips',
      replayPath: '/tmp/replay.mp4',
      replaySavedAtMs: new Date(2026, 4, 13, 3, 51, 12).getTime(),
      replayDurationSeconds: 1800,
      paddingBeforeSeconds: 3,
      paddingAfterSeconds: 5,
      trade
    })

    expect(plan.videoPath).toContain('BTCUSDT Binance 13.05.26 03:49:21.mp4')
    expect(plan.ffmpegArgs).toEqual([
      '-y',
      '-ss',
      '1686.000',
      '-t',
      '114.000',
      '-i',
      '/tmp/replay.mp4',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      plan.videoPath
    ])
  })
})
