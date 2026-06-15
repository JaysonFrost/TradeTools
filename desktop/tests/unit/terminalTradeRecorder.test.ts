import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultSettings } from '../../src/main/services/settings/settings'
import type { ClosedTrade } from '../../src/main/services/trades/simulatedTradePipeline'
import {
  createTerminalTradeWatcher,
  diffMetaScalpPositionSnapshots,
  getVatagaLogsDir,
  parseMetaScalpPositionSnapshot,
  parseTigerTradePositionEvent,
  parseVatagaPositionEvent
} from '../../src/main/services/trades/terminalTradeRecorder'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const waitForAssertion = async (assertion: () => void, timeoutMs = 1_500) => {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await sleep(25)
    }
  }

  throw lastError
}

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
      eventTimeMs: Date.parse('2026-06-10T21:02:36.467Z'),
      size: -13.7
    })
  })

  it('ignores non-trading log rows', () => {
    expect(parseVatagaPositionEvent(JSON.stringify({
      '@t': '2026-06-10T21:00:03Z',
      '@mt': 'Socket {socketId} connected',
      Type: 'Network'
    }))).toBeUndefined()
  })

  it('finds Vataga logs from macOS Application Support when APPDATA is unavailable', () => {
    expect(getVatagaLogsDir({
      HOME: '/Users/trader'
    })).toBe('/Users/trader/Library/Application Support/Vataga/Vataga.terminal/Logs')
  })

  it('parses TigerTrade position updates from WorkLog rows', () => {
    const event = parseTigerTradePositionEvent(
      '11.06.2026 10:07:45.162 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=USDC/USDT;Account=BINANCE SPOT;Price=9995;Size=-22;Comission=0;PriceMode=[Unified] Open Only;Executions=1'
    )

    expect(event).toEqual({
      source: 'tigertrade',
      positionId: 'BINANCE SPOT:USDCUSDT',
      exchange: 'BINANCE',
      symbol: 'USDCUSDT',
      side: 'SHORT',
      isClosed: false,
      eventTimeMs: new Date(2026, 5, 11, 10, 7, 45, 162).getTime(),
      size: -22
    })
  })

  it('marks TigerTrade zero-size position updates as closes', () => {
    const event = parseTigerTradePositionEvent(
      '11.06.2026 10:08:45.162 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=ETHUSDT;Account=BINANCE FUTURES;Price=0;Size=0;Comission=0;Executions=2'
    )

    expect(event?.isClosed).toBe(true)
    expect(event?.positionId).toBe('BINANCE FUTURES:ETHUSDT')
  })

  it('matches TigerTrade open and close rows when the symbol slash differs', () => {
    const openEvent = parseTigerTradePositionEvent(
      '11.06.2026 10:07:45.162 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=USDC/USDT;Account=BINANCE SPOT;Price=0.9995;Size=22;Comission=0;Executions=1'
    )
    const closeEvent = parseTigerTradePositionEvent(
      '11.06.2026 10:08:45.162 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=USDCUSDT;Account=BINANCE SPOT;Price=1.0000;Size=0;Comission=0;Executions=2'
    )

    expect(openEvent?.positionId).toBe('BINANCE SPOT:USDCUSDT')
    expect(closeEvent?.positionId).toBe(openEvent?.positionId)
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
      eventTimeMs: 1_781_111_111_000,
      size: 276
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

  it('clips a quick TigerTrade round trip while the base position stays open', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('MetaScalp offline')
    }))

    const rootDir = await mkdtemp(join(tmpdir(), 'tradetools-terminal-'))
    const appDataDir = join(rootDir, 'AppData')
    const logsDir = join(appDataDir, 'TigerTrade', '4.1', 'Data', 'Logs')
    const logPath = join(logsDir, 'WorkLog_15.06.2026.log')
    await mkdir(logsDir, { recursive: true })
    await writeFile(logPath, '', 'utf8')

    const defaultSettings = createDefaultSettings(rootDir)
    const settings = {
      ...defaultSettings,
      tradeSource: {
        ...defaultSettings.tradeSource,
        mode: 'terminal-window' as const
      }
    }
    const createClipForClosedTrade = vi.fn(async (_trade: ClosedTrade) => undefined)
    const watcher = createTerminalTradeWatcher({
      getSettings: async () => settings,
      ensureVideoRecordingReady: async () => true,
      protectSince: vi.fn(),
      createClipForClosedTrade,
      env: { APPDATA: appDataDir },
      pollIntervalMs: 20
    })

    try {
      watcher.start()
      await waitForAssertion(() => {
        expect(watcher.getStatus().message).toContain('TigerTrade')
      })
      await sleep(50)
      await appendFile(logPath, [
        '15.06.2026 10:00:00.000 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=BTCUSDT;Account=BINANCE FUTURES;Price=65000;Size=1;Comission=0;Executions=1',
        '15.06.2026 10:01:00.000 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=BTCUSDT;Account=BINANCE FUTURES;Price=65100;Size=2;Comission=0;Executions=2',
        '15.06.2026 10:01:05.000 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=BTCUSDT;Account=BINANCE FUTURES;Price=65120;Size=1;Comission=0;Executions=3'
      ].join('\n') + '\n', 'utf8')

      await waitForAssertion(() => {
        expect(createClipForClosedTrade).toHaveBeenCalledTimes(1)
      })

      expect(createClipForClosedTrade.mock.calls[0]?.[0]).toMatchObject({
        exchange: 'BINANCE',
        marketType: 'TERMINAL',
        symbol: 'BTCUSDT',
        side: 'LONG',
        status: 'closed',
        entryTimeMs: new Date(2026, 5, 15, 10, 1, 0).getTime(),
        exitTimeMs: new Date(2026, 5, 15, 10, 1, 5).getTime()
      })
      expect(watcher.getStatus().activeTradeCount).toBe(1)
    } finally {
      watcher.stop()
      vi.unstubAllGlobals()
      await rm(rootDir, { recursive: true, force: true })
    }
  })
})
