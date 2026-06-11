import { describe, expect, it } from 'vitest'
import {
  parseMetaScalpPositionSnapshot,
  parseTigerTradePositionEvent,
  parseVatagaPositionEvent
} from '../../src/main/services/trades/terminalTradeRecorder'

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
      source: 'vataga',
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

  it('parses TigerTrade position updates from WorkLog rows', () => {
    const event = parseTigerTradePositionEvent(
      '11.06.2026 10:07:45.162 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=USDC/USDT;Account=BINANCE SPOT;Price=9995;Size=-22;Comission=0;PriceMode=[Unified] Open Only;Executions=1'
    )

    expect(event).toEqual({
      source: 'tigertrade',
      positionId: 'BINANCE SPOT:USDC/USDT',
      exchange: 'BINANCE',
      symbol: 'USDCUSDT',
      side: 'SHORT',
      isClosed: false,
      eventTimeMs: new Date(2026, 5, 11, 10, 7, 45, 162).getTime()
    })
  })

  it('marks TigerTrade zero-size position updates as closes', () => {
    const event = parseTigerTradePositionEvent(
      '11.06.2026 10:08:45.162 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=ETHUSDT;Account=BINANCE FUTURES;Price=0;Size=0;Comission=0;Executions=2'
    )

    expect(event?.isClosed).toBe(true)
    expect(event?.positionId).toBe('BINANCE FUTURES:ETHUSDT')
  })

  it('normalizes MetaScalp API position snapshots', () => {
    const event = parseMetaScalpPositionSnapshot({
      Id: 2,
      Ticker: 'KOMAUSDT',
      Side: 1,
      Size: '276.0',
      OpenTime: 1_781_111_111
    }, {
      Id: 78,
      Name: 'Binance Futures'
    }, 1_900_000_000_000)

    expect(event).toEqual({
      source: 'metascalp',
      positionId: '78:2',
      exchange: 'BINANCE',
      symbol: 'KOMAUSDT',
      side: 'LONG',
      isClosed: false,
      eventTimeMs: 1_781_111_111_000
    })
  })
})
