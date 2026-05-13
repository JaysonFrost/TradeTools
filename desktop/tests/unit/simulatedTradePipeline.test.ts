import { describe, expect, it } from 'vitest'
import { createSimulatedClosedTrade, planSimulatedClip } from '../../src/main/services/trades/simulatedTradePipeline'

describe('simulatedTradePipeline', () => {
  it('creates a deterministic closed trade for local pipeline tests', () => {
    const trade = createSimulatedClosedTrade(Date.parse('2026-05-13T03:51:10.000Z'))

    expect(trade.symbol).toBe('BTCUSDT')
    expect(trade.side).toBe('LONG')
    expect(trade.status).toBe('closed')
    expect(trade.exitTimeMs - trade.entryTimeMs).toBe(109000)
  })

  it('plans output paths and trim args for a simulated clip', () => {
    const trade = createSimulatedClosedTrade(Date.parse('2026-05-13T03:51:10.000Z'))
    const plan = planSimulatedClip({
      dataDir: '/Users/igor/TradeClips',
      replayPath: '/tmp/replay.mp4',
      replaySavedAtMs: Date.parse('2026-05-13T03:51:12.000Z'),
      replayDurationSeconds: 1800,
      paddingBeforeSeconds: 3,
      paddingAfterSeconds: 5,
      trade
    })

    expect(plan.videoPath).toContain('2026-05-13_03-49-21_BINANCE_FUTURES_BTCUSDT_LONG.mp4')
    expect(plan.ffmpegArgs).toEqual(['-y', '-ss', '1686.000', '-to', '1800.000', '-i', '/tmp/replay.mp4', '-c', 'copy', plan.videoPath])
  })
})
