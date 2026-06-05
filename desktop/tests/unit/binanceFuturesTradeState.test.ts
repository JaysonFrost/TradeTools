import { describe, expect, it } from 'vitest'
import { createBinanceFuturesTradeState } from '../../src/main/services/exchanges/binanceFuturesTradeState'

describe('binanceFuturesTradeState', () => {
  it('emits a closed LONG futures trade when position returns to zero', () => {
    const state = createBinanceFuturesTradeState()

    expect(state.applyPositions([{ symbol: 'BTCUSDT', positionAmt: '0.25' }], Date.parse('2026-05-13T10:00:00.000Z'))).toEqual([])
    expect(state.applyPositions([{ symbol: 'BTCUSDT', positionAmt: '0.10' }], Date.parse('2026-05-13T10:03:00.000Z'))).toEqual([])

    expect(state.applyPositions([{ symbol: 'BTCUSDT', positionAmt: '0' }], Date.parse('2026-05-13T10:05:00.000Z'))).toEqual([
      {
        id: 'binance-futures-BTCUSDT-1778666400000',
        exchange: 'BINANCE',
        marketType: 'FUTURES',
        symbol: 'BTCUSDT',
        side: 'LONG',
        status: 'closed',
        entryTimeMs: Date.parse('2026-05-13T10:00:00.000Z'),
        exitTimeMs: Date.parse('2026-05-13T10:05:00.000Z')
      }
    ])
  })

  it('emits a closed SHORT trade and starts a new trade when position flips direction', () => {
    const state = createBinanceFuturesTradeState()

    state.applyPositions([{ symbol: 'ETHUSDT', positionAmt: '-2' }], Date.parse('2026-05-13T11:00:00.000Z'))

    expect(state.applyPositions([{ symbol: 'ETHUSDT', positionAmt: '1' }], Date.parse('2026-05-13T11:07:00.000Z'))).toEqual([
      {
        id: 'binance-futures-ETHUSDT-1778670000000',
        exchange: 'BINANCE',
        marketType: 'FUTURES',
        symbol: 'ETHUSDT',
        side: 'SHORT',
        status: 'closed',
        entryTimeMs: Date.parse('2026-05-13T11:00:00.000Z'),
        exitTimeMs: Date.parse('2026-05-13T11:07:00.000Z')
      }
    ])

    expect(state.getActiveTrades()).toEqual([
      {
        id: 'binance-futures-ETHUSDT-1778670420000',
        exchange: 'BINANCE',
        marketType: 'FUTURES',
        symbol: 'ETHUSDT',
        side: 'LONG',
        status: 'open',
        entryTimeMs: Date.parse('2026-05-13T11:07:00.000Z')
      }
    ])
  })

  it('emits closed trades when Binance omits previously active symbols after close', () => {
    const state = createBinanceFuturesTradeState()

    state.applyPositions([{ symbol: 'BTCUSDT', positionAmt: '0.25' }], Date.parse('2026-05-13T12:00:00.000Z'))

    expect(state.applyPositions([], Date.parse('2026-05-13T12:02:00.000Z'))).toEqual([
      {
        id: 'binance-futures-BTCUSDT-1778673600000',
        exchange: 'BINANCE',
        marketType: 'FUTURES',
        symbol: 'BTCUSDT',
        side: 'LONG',
        status: 'closed',
        entryTimeMs: Date.parse('2026-05-13T12:00:00.000Z'),
        exitTimeMs: Date.parse('2026-05-13T12:02:00.000Z')
      }
    ])
  })

  it('uses Binance updateTime for trade entry and exit when the API provides it', () => {
    const state = createBinanceFuturesTradeState()
    const entryTimeMs = Date.parse('2026-05-13T13:00:11.000Z')
    const exitTimeMs = Date.parse('2026-05-13T13:04:22.000Z')

    expect(state.applyPositions([
      { symbol: 'BTCUSDT', positionAmt: '0.25', updateTime: entryTimeMs }
    ], Date.parse('2026-05-13T13:00:20.000Z'))).toEqual([])
    expect(state.applyPositions([
      { symbol: 'BTCUSDT', positionAmt: '0', updateTime: exitTimeMs }
    ], Date.parse('2026-05-13T13:04:40.000Z'))).toEqual([
      {
        id: `binance-futures-BTCUSDT-${entryTimeMs}`,
        exchange: 'BINANCE',
        marketType: 'FUTURES',
        symbol: 'BTCUSDT',
        side: 'LONG',
        status: 'closed',
        entryTimeMs,
        exitTimeMs
      }
    ])
  })
})
