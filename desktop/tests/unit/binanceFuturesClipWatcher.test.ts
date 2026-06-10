import { describe, expect, it, vi } from 'vitest'
import { createBinanceFuturesClipWatcher } from '../../src/main/services/exchanges/binanceFuturesClipWatcher'

describe('binanceFuturesClipWatcher', () => {
  it('creates a clip when a Binance Futures position closes', async () => {
    const createClipForClosedTrade = vi.fn().mockResolvedValue(undefined)
    const onActiveTradesChanged = vi.fn()
    const listPositions = vi.fn()
      .mockResolvedValueOnce([{ symbol: 'BTCUSDT', positionAmt: '0.5' }])
      .mockResolvedValueOnce([{ symbol: 'BTCUSDT', positionAmt: '0' }])
    const now = vi.fn()
      .mockReturnValueOnce(Date.parse('2026-05-13T12:00:00.000Z'))
      .mockReturnValueOnce(Date.parse('2026-05-13T12:04:00.000Z'))
    const watcher = createBinanceFuturesClipWatcher({
      listPositions,
      createClipForClosedTrade,
      onActiveTradesChanged,
      now
    })

    await watcher.pollOnce()
    await watcher.pollOnce()

    expect(createClipForClosedTrade).toHaveBeenCalledWith({
      id: 'binance-futures-BTCUSDT-1778673600000',
      exchange: 'BINANCE',
      marketType: 'FUTURES',
      symbol: 'BTCUSDT',
      side: 'LONG',
      status: 'closed',
      entryTimeMs: Date.parse('2026-05-13T12:00:00.000Z'),
      exitTimeMs: Date.parse('2026-05-13T12:04:00.000Z')
    })
    expect(onActiveTradesChanged).toHaveBeenCalledWith([{
      id: 'binance-futures-BTCUSDT-1778673600000',
      exchange: 'BINANCE',
      marketType: 'FUTURES',
      symbol: 'BTCUSDT',
      side: 'LONG',
      status: 'open',
      entryTimeMs: Date.parse('2026-05-13T12:00:00.000Z')
    }])
    expect(onActiveTradesChanged).toHaveBeenLastCalledWith([])
  })

  it('creates a clip from recent closed-trade history when the position poll already sees zero', async () => {
    const createClipForClosedTrade = vi.fn().mockResolvedValue(undefined)
    const closedTrade = {
      id: 'binance-futures-BTCUSDT-1778673600000',
      exchange: 'BINANCE',
      marketType: 'FUTURES',
      symbol: 'BTCUSDT',
      side: 'LONG',
      status: 'closed' as const,
      entryTimeMs: Date.parse('2026-05-13T12:00:00.000Z'),
      exitTimeMs: Date.parse('2026-05-13T12:04:00.000Z')
    }
    const watcher = createBinanceFuturesClipWatcher({
      listPositions: vi.fn().mockResolvedValue([{ symbol: 'BTCUSDT', positionAmt: '0' }]),
      listRecentClosedTrades: vi.fn().mockResolvedValue([closedTrade]),
      createClipForClosedTrade,
      now: () => Date.parse('2026-05-13T12:04:03.000Z')
    })

    await expect(watcher.pollOnce()).resolves.toEqual([closedTrade])
    expect(createClipForClosedTrade).toHaveBeenCalledWith(closedTrade)
  })

  it('does not start a duplicate clip render while the same trade is already rendering', async () => {
    let finishRender: () => void = () => undefined
    const createClipForClosedTrade = vi.fn(() => new Promise<void>((resolve) => {
      finishRender = resolve
    }))
    const closedTrade = {
      id: 'binance-futures-AIGENSYNUSDT-1778781632034',
      exchange: 'BINANCE',
      marketType: 'FUTURES',
      symbol: 'AIGENSYNUSDT',
      side: 'LONG',
      status: 'closed' as const,
      entryTimeMs: Date.parse('2026-05-14T18:00:32.034Z'),
      exitTimeMs: Date.parse('2026-05-14T18:00:35.902Z')
    }
    const watcher = createBinanceFuturesClipWatcher({
      listPositions: vi.fn().mockResolvedValue([{ symbol: 'AIGENSYNUSDT', positionAmt: '0' }]),
      listRecentClosedTrades: vi.fn().mockResolvedValue([closedTrade]),
      createClipForClosedTrade,
      now: () => Date.parse('2026-05-14T18:00:39.000Z')
    })

    const firstPoll = watcher.pollOnce()
    await Promise.resolve()
    await Promise.resolve()
    const secondPoll = watcher.pollOnce()
    await Promise.resolve()
    await Promise.resolve()

    expect(createClipForClosedTrade).toHaveBeenCalledTimes(1)
    finishRender()
    await expect(firstPoll).resolves.toEqual([closedTrade])
    await expect(secondPoll).resolves.toEqual([])
  })
})
