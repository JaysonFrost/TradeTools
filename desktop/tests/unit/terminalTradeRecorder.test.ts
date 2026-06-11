import { describe, expect, it } from 'vitest'
import {
  diffMetaScalpPositionSnapshots,
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

  it('ignores closed MetaScalp position snapshots', () => {
    expect(parseMetaScalpPositionSnapshot({
      Id: 2,
      Ticker: 'BTCUSDT',
      Size: '1',
      Status: 'Closed'
    }, {
      Id: 78,
      Name: 'Binance Futures'
    }, 1_900_000_000_000)).toBeUndefined()

    expect(parseMetaScalpPositionSnapshot({
      Id: 3,
      Ticker: 'ETHUSDT',
      Size: '1',
      IsClosed: true
    }, {
      Id: 78,
      Name: 'Binance Futures'
    }, 1_900_000_000_000)).toBeUndefined()
  })

  it('seeds the first MetaScalp snapshot without opening phantom trades', () => {
    const position = parseMetaScalpPositionSnapshot({
      Id: 2,
      Ticker: 'KOMAUSDT',
      Size: '276.0'
    }, {
      Id: 78,
      Name: 'Binance Futures'
    }, 1_900_000_000_000)
    expect(position).toBeDefined()

    const firstSnapshot = new Map([[`metascalp:${position?.positionId}`, position!]])
    const diff = diffMetaScalpPositionSnapshots(firstSnapshot, new Map(), false, 1_900_000_001_000)

    expect(diff.initialized).toBe(true)
    expect(diff.currentOpenPositions.size).toBe(1)
    expect(diff.events).toEqual([])
  })

  it('emits MetaScalp open and close events after the initial snapshot', () => {
    const position = parseMetaScalpPositionSnapshot({
      Id: 2,
      Ticker: 'KOMAUSDT',
      Size: '276.0'
    }, {
      Id: 78,
      Name: 'Binance Futures'
    }, 1_900_000_000_000)
    expect(position).toBeDefined()

    const current = new Map([[`metascalp:${position?.positionId}`, position!]])
    const openDiff = diffMetaScalpPositionSnapshots(current, new Map(), true, 1_900_000_001_000)
    const closeDiff = diffMetaScalpPositionSnapshots(new Map(), current, true, 1_900_000_002_000)

    expect(openDiff.events).toEqual([position])
    expect(closeDiff.events).toEqual([{
      ...position,
      isClosed: true,
      eventTimeMs: 1_900_000_002_000
    }])
  })
})
