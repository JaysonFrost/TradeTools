import { describe, expect, it } from 'vitest'
import { parseVatagaPositionEvent } from '../../src/main/services/trades/terminalTradeRecorder'

describe('terminalTradeRecorder', () => {
  it('parses Vataga position changed events from clef logs', () => {
    const event = parseVatagaPositionEvent(JSON.stringify({
      '@t': '2026-06-10T21:02:37.4634451Z',
      '@mt': 'Position changed.\r\nConnectionID: {@ConnectionID};',
      Type: 'Trading',
      ExchangeType: 'Binance',
      PositionID: 'position-1',
      SymbolTitle: 'Binance/SUIUSDT',
      IsClosed: false,
      PositionQuantity: -13.7,
      TradeTime: '2026-06-10T21:02:36.467',
      TradeSide: 'Sell'
    }))

    expect(event).toEqual({
      positionId: 'position-1',
      exchange: 'BINANCE',
      symbol: 'SUIUSDT',
      side: 'SHORT',
      isClosed: false,
      eventTimeMs: Date.parse('2026-06-10T21:02:36.467Z')
    })
  })

  it('ignores non-trading log rows', () => {
    expect(parseVatagaPositionEvent(JSON.stringify({
      '@t': '2026-06-10T21:00:03Z',
      '@mt': 'Socket {socketId} connected',
      Type: 'Network'
    }))).toBeUndefined()
  })
})

