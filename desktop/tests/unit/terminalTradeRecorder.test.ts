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

const padDatePart = (value: number, length = 2): string => String(value).padStart(length, '0')

const toTigerTradeTimestamp = (timeMs: number): string => {
  const date = new Date(timeMs)
  return `${padDatePart(date.getDate())}.${padDatePart(date.getMonth() + 1)}.${date.getFullYear()} ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}.${padDatePart(date.getMilliseconds(), 3)}`
}

const createTigerTradePositionLine = ({
  timeMs,
  symbol,
  size,
  executions,
  account = 'BINANCE FUTURES'
}: {
  timeMs: number
  symbol: string
  size: number
  executions: number
  account?: string
}): string => (
  `${toTigerTradeTimestamp(timeMs)} Binance via TIGER.COM Broker Futures: EnqueueUserPosition: Symbol=${symbol};Account=${account};Price=1;Size=${size};Comission=0;Executions=${executions}`
)

const createVatagaPositionLine = ({
  timeMs,
  positionId,
  symbol,
  size
}: {
  timeMs: number
  positionId: string
  symbol: string
  size: number
}): string => JSON.stringify({
  '@t': new Date(timeMs).toISOString(),
  '@mt': 'Position changed.',
  Type: 'Trading',
  ExchangeType: 'Binance',
  PositionID: positionId,
  SymbolTitle: `Binance/${symbol}`,
  IsClosed: size === 0,
  PositionQuantity: size,
  TradeTime: new Date(timeMs).toISOString(),
  TradeSide: size < 0 ? 'Sell' : 'Buy',
  ProcessId: 39336
})

const runCrossSourcePair = async ({
  tigerSymbol,
  vatagaSymbol,
  tigerEntryTimeMs,
  tigerExitTimeMs,
  vatagaEntryTimeMs,
  vatagaExitTimeMs,
  afterTigerClip
}: {
  tigerSymbol: string
  vatagaSymbol: string
  tigerEntryTimeMs: number
  tigerExitTimeMs: number
  vatagaEntryTimeMs: number
  vatagaExitTimeMs: number
  afterTigerClip?: () => void
}): Promise<ClosedTrade[]> => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tradetools-terminal-cross-source-'))
  const appDataDir = join(rootDir, 'AppData')
  const tigerLogsDir = join(appDataDir, 'TigerTrade', '4.1', 'Data', 'Logs')
  const vatagaLogsDir = join(appDataDir, 'Vataga', 'Vataga.terminal', 'Logs')
  const tigerLogPath = join(tigerLogsDir, 'WorkLog_18.06.2026.log')
  const vatagaLogPath = join(vatagaLogsDir, 'log-20260618.clef')
  await mkdir(tigerLogsDir, { recursive: true })
  await mkdir(vatagaLogsDir, { recursive: true })
  await writeFile(tigerLogPath, '', 'utf8')
  await writeFile(vatagaLogPath, '', 'utf8')

  const defaultSettings = createDefaultSettings(rootDir)
  const settings = {
    ...defaultSettings,
    tradeSource: {
      ...defaultSettings.tradeSource,
      mode: 'terminal-window' as const
    }
  }
  const createClipForClosedTrade = vi.fn(async (_trade: ClosedTrade) => undefined)
  const ensureVideoRecordingReady = vi.fn(async () => true)
  const watcher = createTerminalTradeWatcher({
    getSettings: async () => settings,
    ensureVideoRecordingReady,
    protectSince: vi.fn(),
    createClipForClosedTrade,
    env: { APPDATA: appDataDir },
    pollIntervalMs: 20
  })

  try {
    watcher.start()
    await waitForAssertion(() => {
      expect(watcher.getStatus().availableSources).toEqual(['vataga', 'tigertrade'])
    })
    await appendFile(tigerLogPath, [
      createTigerTradePositionLine({ timeMs: tigerEntryTimeMs, symbol: tigerSymbol, size: 1, executions: 1 }),
      createTigerTradePositionLine({ timeMs: tigerExitTimeMs, symbol: tigerSymbol, size: 0, executions: 2 })
    ].join('\n') + '\n', 'utf8')
    await waitForAssertion(() => {
      expect(createClipForClosedTrade).toHaveBeenCalledTimes(1)
    })

    afterTigerClip?.()
    await appendFile(vatagaLogPath, [
      createVatagaPositionLine({
        timeMs: vatagaEntryTimeMs,
        positionId: 'vataga-cross-source',
        symbol: vatagaSymbol,
        size: 1
      }),
      createVatagaPositionLine({
        timeMs: vatagaExitTimeMs,
        positionId: 'vataga-cross-source',
        symbol: vatagaSymbol,
        size: 0
      })
    ].join('\n') + '\n', 'utf8')
    await waitForAssertion(() => {
      expect(ensureVideoRecordingReady).toHaveBeenCalledTimes(2)
      expect(watcher.getStatus().activeTradeCount).toBe(0)
    })
    await sleep(40)
    return createClipForClosedTrade.mock.calls.map((call) => call[0])
  } finally {
    watcher.stop()
    await rm(rootDir, { recursive: true, force: true })
  }
}

describe('terminalTradeRecorder', () => {
  it('uses the Vataga terminal update timestamp for recording boundaries', () => {
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
      TradeSide: 'Sell',
      ProcessId: 39336
    }))

    expect(event).toEqual({
      source: 'vataga',
      positionId: 'position-1',
      exchange: 'BINANCE',
      symbol: 'SUIUSDT',
      side: 'SHORT',
      isClosed: false,
      eventTimeMs: Date.parse('2026-06-10T21:02:37.4634451Z'),
      size: -13.7,
      processId: 39336
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

  it('marks TigerTrade zero-size updates with no executions as closes', () => {
    const event = parseTigerTradePositionEvent(
      '11.06.2026 10:08:45.162 Binance via TIGER.COM Broker Futures: EnqueueUserPosition: Symbol=ETHUSDT;Account=BINANCE FUTURES;Price=0;Size=0;Comission=0;PriceMode=PartClose:false;Executions=0'
    )

    expect(event?.isClosed).toBe(true)
    expect(event?.positionId).toBe('BINANCE FUTURES:ETHUSDT')
  })

  it('ignores TigerTrade position snapshots that have no executions', () => {
    const event = parseTigerTradePositionEvent(
      '11.06.2026 10:07:45.162 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=ETHUSDT;Account=BINANCE FUTURES;Price=0;Size=2;Comission=0;Executions=0'
    )

    expect(event).toBeUndefined()
  })

  it('ignores TigerTrade simulator position snapshots', () => {
    const event = parseTigerTradePositionEvent(
      '11.06.2026 10:07:45.162 Simulator: EnqueueUserPosition: Symbol=CAMPUSDT;Account=SIM1;Price=8632;Size=-4600;Comission=0;Executions=1'
    )

    expect(event).toBeUndefined()
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

  it('does not split partial TigerTrade size changes into extra clips', async () => {
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
        expect(watcher.getStatus().availableSources).toEqual(['tigertrade'])
      })
      await sleep(50)
      await appendFile(logPath, [
        '15.06.2026 10:00:00.000 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=BTCUSDT;Account=BINANCE FUTURES;Price=65000;Size=1;Comission=0;Executions=1',
        '15.06.2026 10:01:00.000 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=BTCUSDT;Account=BINANCE FUTURES;Price=65100;Size=2;Comission=0;Executions=2',
        '15.06.2026 10:01:05.000 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=BTCUSDT;Account=BINANCE FUTURES;Price=65120;Size=1;Comission=0;Executions=3',
        '15.06.2026 10:02:00.000 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=BTCUSDT;Account=BINANCE FUTURES;Price=65200;Size=0;Comission=0;Executions=4'
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
        entryTimeMs: new Date(2026, 5, 15, 10, 0, 0).getTime(),
        exitTimeMs: new Date(2026, 5, 15, 10, 2, 0).getTime()
      })
      expect(watcher.getStatus().activeTradeCount).toBe(0)
    } finally {
      watcher.stop()
      vi.unstubAllGlobals()
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it('keeps reading TigerTrade logs after the month changes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('MetaScalp offline')
    }))

    const rootDir = await mkdtemp(join(tmpdir(), 'tradetools-terminal-month-rollover-'))
    const appDataDir = join(rootDir, 'AppData')
    const logsDir = join(appDataDir, 'TigerTrade', '4.1', 'Data', 'Logs')
    const augustLogPath = join(logsDir, 'WorkLog_01.08.2026.log')
    await mkdir(logsDir, { recursive: true })
    await Promise.all([
      writeFile(join(logsDir, 'WorkLog_30.07.2026.log'), '', 'utf8'),
      writeFile(join(logsDir, 'WorkLog_31.07.2026.log'), '', 'utf8'),
      writeFile(augustLogPath, '', 'utf8')
    ])

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
      await appendFile(augustLogPath, [
        '01.08.2026 10:00:00.000 Binance via TIGER.COM Broker Futures: EnqueueUserPosition: Symbol=AUGUSDT;Account=BINANCE FUTURES;Price=1;Size=1;Comission=0;Executions=1',
        '01.08.2026 10:01:00.000 Binance via TIGER.COM Broker Futures: EnqueueUserPosition: Symbol=AUGUSDT;Account=BINANCE FUTURES;Price=1;Size=0;Comission=0;Executions=2'
      ].join('\n') + '\n', 'utf8')

      await waitForAssertion(() => {
        expect(createClipForClosedTrade).toHaveBeenCalledTimes(1)
      })
      expect(createClipForClosedTrade.mock.calls[0]?.[0]).toMatchObject({
        symbol: 'AUGUSDT',
        entryTimeMs: new Date(2026, 7, 1, 10, 0, 0).getTime(),
        exitTimeMs: new Date(2026, 7, 1, 10, 1, 0).getTime()
      })
    } finally {
      watcher.stop()
      vi.unstubAllGlobals()
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it('tracks only terminal positions opened after recording starts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('MetaScalp offline')
    }))

    const rootDir = await mkdtemp(join(tmpdir(), 'tradetools-terminal-start-boundary-'))
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
    const recordingStartedAtMs = new Date(2026, 5, 15, 10, 1, 0).getTime()
    const createClipForClosedTrade = vi.fn(async (_trade: ClosedTrade) => undefined)
    const watcher = createTerminalTradeWatcher({
      getSettings: async () => settings,
      ensureVideoRecordingReady: async () => true,
      protectSince: vi.fn(),
      createClipForClosedTrade,
      getRecordingStartedAtMs: () => recordingStartedAtMs,
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
        '15.06.2026 10:00:00.000 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=OLDUSDT;Account=BINANCE FUTURES;Price=1;Size=1;Comission=0;Executions=1',
        '15.06.2026 10:01:10.000 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=NEWUSDT;Account=BINANCE FUTURES;Price=1;Size=1;Comission=0;Executions=1',
        '15.06.2026 10:01:20.000 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=NEWUSDT;Account=BINANCE FUTURES;Price=1;Size=0;Comission=0;Executions=2'
      ].join('\n') + '\n', 'utf8')

      await waitForAssertion(() => {
        expect(createClipForClosedTrade).toHaveBeenCalledTimes(1)
      })

      expect(createClipForClosedTrade.mock.calls[0]?.[0]).toMatchObject({
        symbol: 'NEWUSDT',
        entryTimeMs: new Date(2026, 5, 15, 10, 1, 10).getTime(),
        exitTimeMs: new Date(2026, 5, 15, 10, 1, 20).getTime()
      })
      expect(watcher.getStatus().activeTradeCount).toBe(0)
    } finally {
      watcher.stop()
      vi.unstubAllGlobals()
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it('ignores stale TigerTrade startup replay before tracking a fresh fill', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('MetaScalp offline')
    }))

    const rootDir = await mkdtemp(join(tmpdir(), 'tradetools-terminal-late-log-'))
    const appDataDir = join(rootDir, 'AppData')
    const logsDir = join(appDataDir, 'TigerTrade', '4.1', 'Data', 'Logs')
    const logPath = join(logsDir, 'WorkLog_15.06.2026.log')

    const defaultSettings = createDefaultSettings(rootDir)
    const settings = {
      ...defaultSettings,
      tradeSource: {
        ...defaultSettings.tradeSource,
        mode: 'terminal-window' as const
      }
    }
    const recordingStartedAtMs = new Date(2026, 5, 15, 10, 0, 0).getTime()
    const ensureVideoRecordingReady = vi.fn(async () => true)
    const watcher = createTerminalTradeWatcher({
      getSettings: async () => settings,
      ensureVideoRecordingReady,
      protectSince: vi.fn(),
      createClipForClosedTrade: vi.fn(async (_trade: ClosedTrade) => undefined),
      getRecordingStartedAtMs: () => recordingStartedAtMs,
      env: { APPDATA: appDataDir },
      pollIntervalMs: 20
    })

    try {
      watcher.start()
      await sleep(50)
      await mkdir(logsDir, { recursive: true })
      await writeFile(logPath, [
        '15.06.2026 10:00:10.000 Simulator: EnqueueUserPosition: Symbol=CAMPUSDT;Account=SIM1;Price=8632;Size=-4600;Comission=0;PriceMode=[Unified] Open Only;Executions=1',
        '15.06.2026 10:00:11.000 Binance via TIGER.COM Broker Spot: EnqueueExecution: ExecutionID=339707546;OrderID=1183534940;Symbol=USDC/USDT;Account=BINANCE SPOT;Time=17.10.2025 21:51:44;Price=99950;Quantity=22;Side=Sell;Comission(Q)=0',
        '15.06.2026 10:00:11.000 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=USDC/USDT;Account=BINANCE SPOT;Price=9995;Size=-22;Comission=0;PriceMode=[Unified] Open Only;Executions=1'
      ].join('\n') + '\n', 'utf8')

      await sleep(120)
      expect(watcher.getStatus().activeTradeCount).toBe(0)

      await appendFile(logPath, [
        '15.06.2026 10:00:20.000 Binance via TIGER.COM Broker Futures: EnqueueExecution: ExecutionID=173915325;OrderID=2135213143;Symbol=SKYAIUSDT;Account=BINANCE FUTURES;Time=15.06.2026 07:00:20;Price=27103;Quantity=36;Side=Buy;Comission(Q)=0,00487854',
        '15.06.2026 10:00:20.000 Binance via TIGER.COM Broker Futures: EnqueueUserPosition: Symbol=SKYAIUSDT;Account=BINANCE FUTURES;Price=27103;Size=36;Comission=0,00487854;PriceMode=[Unified] Open Only;Executions=1'
      ].join('\n') + '\n', 'utf8')

      await waitForAssertion(() => {
        expect(watcher.getStatus().activeTradeCount).toBe(1)
      })
      expect(watcher.getStatus().message).toContain('SKYAIUSDT')
      expect(ensureVideoRecordingReady).toHaveBeenCalledTimes(1)
    } finally {
      watcher.stop()
      vi.unstubAllGlobals()
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it('records a TigerTrade position that was already open when recording starts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('MetaScalp offline')
    }))

    const rootDir = await mkdtemp(join(tmpdir(), 'tradetools-terminal-started-mid-trade-'))
    const appDataDir = join(rootDir, 'AppData')
    const logsDir = join(appDataDir, 'TigerTrade', '4.1', 'Data', 'Logs')
    const logPath = join(logsDir, 'WorkLog_15.06.2026.log')
    const defaultSettings = createDefaultSettings(rootDir)
    const settings = {
      ...defaultSettings,
      tradeSource: {
        ...defaultSettings.tradeSource,
        mode: 'terminal-window' as const
      }
    }
    const recordingStartedAtMs = new Date(2026, 5, 15, 10, 5, 0).getTime()
    const createClipForClosedTrade = vi.fn(async (_trade: ClosedTrade) => undefined)

    await mkdir(logsDir, { recursive: true })
    await writeFile(logPath, [
      '15.06.2026 10:00:00.000 Binance via TIGER.COM Broker Futures: EnqueueExecution: ExecutionID=1;OrderID=1;Symbol=OLDUSDT;Account=BINANCE FUTURES;Time=15.06.2026 07:00:00;Price=1;Quantity=1;Side=Buy',
      '15.06.2026 10:00:00.000 Binance via TIGER.COM Broker Futures: EnqueueUserPosition: Symbol=OLDUSDT;Account=BINANCE FUTURES;Price=1;Size=1;Comission=0;Executions=1',
      '15.06.2026 10:00:10.000 Binance via TIGER.COM Broker Futures: EnqueueUserPosition: Symbol=OLDUSDT;Account=BINANCE FUTURES;Price=0;Size=0;Comission=0;Executions=0',
      '15.06.2026 10:01:00.000 Binance via TIGER.COM Broker Futures: EnqueueExecution: ExecutionID=2;OrderID=2;Symbol=LIVEUSDT;Account=BINANCE FUTURES;Time=15.06.2026 07:01:00;Price=1;Quantity=1;Side=Buy',
      '15.06.2026 10:01:00.000 Binance via TIGER.COM Broker Futures: EnqueueUserPosition: Symbol=LIVEUSDT;Account=BINANCE FUTURES;Price=1;Size=1;Comission=0;Executions=1'
    ].join('\n') + '\n', 'utf8')

    const watcher = createTerminalTradeWatcher({
      getSettings: async () => settings,
      ensureVideoRecordingReady: async () => true,
      protectSince: vi.fn(),
      createClipForClosedTrade,
      getRecordingStartedAtMs: () => recordingStartedAtMs,
      env: { APPDATA: appDataDir },
      pollIntervalMs: 20
    })

    try {
      watcher.start()
      await waitForAssertion(() => {
        expect(watcher.getStatus().activeTradeCount).toBe(1)
        expect(watcher.getStatus().message).toContain('LIVEUSDT')
      })

      await appendFile(logPath, '15.06.2026 10:06:00.000 Binance via TIGER.COM Broker Futures: EnqueueUserPosition: Symbol=LIVEUSDT;Account=BINANCE FUTURES;Price=0;Size=0;Comission=0;Executions=0\n', 'utf8')

      await waitForAssertion(() => {
        expect(createClipForClosedTrade).toHaveBeenCalledTimes(1)
      })
      expect(createClipForClosedTrade.mock.calls[0]?.[0]).toMatchObject({
        symbol: 'LIVEUSDT',
        entryTimeMs: recordingStartedAtMs,
        exitTimeMs: new Date(2026, 5, 15, 10, 6, 0).getTime()
      })
    } finally {
      watcher.stop()
      vi.unstubAllGlobals()
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it('replays currently open TigerTrade and Vataga positions once when recording turns on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('MetaScalp offline')
    }))

    const rootDir = await mkdtemp(join(tmpdir(), 'tradetools-terminal-boundary-replay-'))
    const appDataDir = join(rootDir, 'AppData')
    const tigerLogsDir = join(appDataDir, 'TigerTrade', '4.1', 'Data', 'Logs')
    const vatagaLogsDir = join(appDataDir, 'Vataga', 'Vataga.terminal', 'Logs')
    const tigerLogPath = join(tigerLogsDir, 'WorkLog_15.06.2026.log')
    const vatagaLogPath = join(vatagaLogsDir, 'log-20260615.clef')
    const tigerEntryTimeMs = new Date(2026, 5, 15, 10, 0, 0).getTime()
    const vatagaEntryTimeMs = new Date(2026, 5, 15, 10, 1, 0).getTime()
    const recordingBoundaryMs = new Date(2026, 5, 15, 10, 5, 0).getTime()
    let recordingStartedAtMs = 0

    await mkdir(tigerLogsDir, { recursive: true })
    await mkdir(vatagaLogsDir, { recursive: true })
    await writeFile(tigerLogPath, [
      `${toTigerTradeTimestamp(tigerEntryTimeMs)} Binance via TIGER.COM Broker Futures: EnqueueExecution: ExecutionID=1;OrderID=1;Symbol=BEATUSDT;Account=BINANCE FUTURES;Time=${toTigerTradeTimestamp(tigerEntryTimeMs)};Price=1;Quantity=1;Side=Buy`,
      createTigerTradePositionLine({ timeMs: tigerEntryTimeMs, symbol: 'BEATUSDT', size: 1, executions: 1 })
    ].join('\n') + '\n', 'utf8')
    await writeFile(vatagaLogPath, createVatagaPositionLine({
      timeMs: vatagaEntryTimeMs,
      positionId: 'vataga-open',
      symbol: 'HEIUSDT',
      size: 2
    }) + '\n', 'utf8')

    const defaultSettings = createDefaultSettings(rootDir)
    const settings = {
      ...defaultSettings,
      tradeSource: {
        ...defaultSettings.tradeSource,
        mode: 'terminal-window' as const
      }
    }
    const createClipForClosedTrade = vi.fn(async (_trade: ClosedTrade) => undefined)
    const ensureVideoRecordingReady = vi.fn(async () => true)
    const watcher = createTerminalTradeWatcher({
      getSettings: async () => settings,
      getRecordingStartedAtMs: () => recordingStartedAtMs,
      ensureVideoRecordingReady,
      protectSince: vi.fn(),
      createClipForClosedTrade,
      env: { APPDATA: appDataDir },
      pollIntervalMs: 20
    })

    try {
      watcher.start()
      await waitForAssertion(() => {
        expect(watcher.getStatus().availableSources).toEqual(['vataga', 'tigertrade'])
      })
      expect(watcher.getStatus().activeTradeCount).toBe(0)

      recordingStartedAtMs = recordingBoundaryMs
      await waitForAssertion(() => {
        expect(watcher.getStatus().activeTradeCount).toBe(2)
        expect(ensureVideoRecordingReady).toHaveBeenCalledTimes(2)
      })
      await sleep(80)
      expect(ensureVideoRecordingReady).toHaveBeenCalledTimes(2)

      const tigerExitTimeMs = new Date(2026, 5, 15, 10, 6, 0).getTime()
      const vatagaExitTimeMs = new Date(2026, 5, 15, 10, 7, 0).getTime()
      await appendFile(tigerLogPath, createTigerTradePositionLine({
        timeMs: tigerExitTimeMs,
        symbol: 'BEATUSDT',
        size: 0,
        executions: 2
      }) + '\n', 'utf8')
      await appendFile(vatagaLogPath, createVatagaPositionLine({
        timeMs: vatagaExitTimeMs,
        positionId: 'vataga-open',
        symbol: 'HEIUSDT',
        size: 0
      }) + '\n', 'utf8')

      await waitForAssertion(() => {
        expect(createClipForClosedTrade).toHaveBeenCalledTimes(2)
      })
      expect(createClipForClosedTrade.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining([
        expect.objectContaining({
          symbol: 'BEATUSDT',
          entryTimeMs: recordingBoundaryMs,
          exitTimeMs: tigerExitTimeMs
        }),
        expect.objectContaining({
          symbol: 'HEIUSDT',
          entryTimeMs: recordingBoundaryMs,
          exitTimeMs: vatagaExitTimeMs
        })
      ]))
    } finally {
      watcher.stop()
      vi.unstubAllGlobals()
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it('suppresses a cold-buffer position until close and records the next ready trade', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('MetaScalp offline')
    }))

    const rootDir = await mkdtemp(join(tmpdir(), 'tradetools-terminal-buffer-warming-'))
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
    const target = { id: 'window:tiger-beat', name: 'Tiger.com - BEATUSDT', type: 'window' as const }
    let videoReady = false
    const ensureVideoRecordingReady = vi.fn(async () => videoReady)
    const resolveRecordingTarget = vi.fn(async () => target)
    const createClipForClosedTrade = vi.fn(async (_trade: ClosedTrade) => undefined)
    const onStatusChange = vi.fn()
    const watcher = createTerminalTradeWatcher({
      getSettings: async () => settings,
      ensureVideoRecordingReady,
      protectSince: vi.fn(),
      createClipForClosedTrade,
      resolveRecordingTarget,
      onStatusChange,
      env: { APPDATA: appDataDir },
      pollIntervalMs: 20
    })

    const skippedEntryTimeMs = new Date(2026, 5, 15, 10, 0, 0).getTime()
    const skippedScaleTimeMs = skippedEntryTimeMs + 5_000
    const skippedExitTimeMs = skippedEntryTimeMs + 10_000
    const recordedEntryTimeMs = skippedEntryTimeMs + 20_000
    const recordedExitTimeMs = skippedEntryTimeMs + 30_000

    try {
      watcher.start()
      await waitForAssertion(() => {
        expect(watcher.getStatus().availableSources).toContain('tigertrade')
      })

      await appendFile(logPath, createTigerTradePositionLine({
        timeMs: skippedEntryTimeMs,
        symbol: 'BEATUSDT',
        size: -1,
        executions: 1
      }) + '\n', 'utf8')
      await waitForAssertion(() => {
        expect(ensureVideoRecordingReady).toHaveBeenCalledTimes(1)
        expect(watcher.getStatus().message).toContain('видеобуфер')
      })
      expect(ensureVideoRecordingReady).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ symbol: 'BEATUSDT', eventTimeMs: skippedEntryTimeMs }),
        target
      )
      expect(watcher.getStatus().activeTradeCount).toBe(0)
      expect(createClipForClosedTrade).not.toHaveBeenCalled()

      await appendFile(logPath, createTigerTradePositionLine({
        timeMs: skippedScaleTimeMs,
        symbol: 'BEATUSDT',
        size: -2,
        executions: 2
      }) + '\n', 'utf8')
      await waitForAssertion(() => {
        expect(watcher.getStatus().lastEventAtMs).toBe(skippedScaleTimeMs)
      })
      expect(ensureVideoRecordingReady).toHaveBeenCalledTimes(1)
      expect(resolveRecordingTarget).toHaveBeenCalledTimes(1)
      expect(watcher.getStatus().activeTradeCount).toBe(0)

      await appendFile(logPath, createTigerTradePositionLine({
        timeMs: skippedExitTimeMs,
        symbol: 'BEATUSDT',
        size: 0,
        executions: 3
      }) + '\n', 'utf8')
      await sleep(80)
      expect(createClipForClosedTrade).not.toHaveBeenCalled()
      expect(watcher.getStatus().activeTradeCount).toBe(0)

      videoReady = true
      await appendFile(logPath, createTigerTradePositionLine({
        timeMs: recordedEntryTimeMs,
        symbol: 'BEATUSDT',
        size: 1,
        executions: 4
      }) + '\n', 'utf8')
      await waitForAssertion(() => {
        expect(ensureVideoRecordingReady).toHaveBeenCalledTimes(2)
        expect(watcher.getStatus().activeTradeCount).toBe(1)
      })
      expect(resolveRecordingTarget).toHaveBeenCalledTimes(2)

      await appendFile(logPath, createTigerTradePositionLine({
        timeMs: recordedExitTimeMs,
        symbol: 'BEATUSDT',
        size: 0,
        executions: 5
      }) + '\n', 'utf8')
      await waitForAssertion(() => {
        expect(createClipForClosedTrade).toHaveBeenCalledTimes(1)
      })
      expect(createClipForClosedTrade.mock.calls[0]?.[0]).toMatchObject({
        symbol: 'BEATUSDT',
        side: 'LONG',
        entryTimeMs: recordedEntryTimeMs,
        exitTimeMs: recordedExitTimeMs,
        recordingTarget: target
      })
      expect(onStatusChange.mock.calls.some(([nextStatus]) => (
        typeof nextStatus?.message === 'string' && nextStatus.message.includes('эту сделку пропускаем')
      ))).toBe(true)
    } finally {
      watcher.stop()
      vi.unstubAllGlobals()
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it('keeps an active terminal trade when background recording restarts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('MetaScalp offline')
    }))

    const rootDir = await mkdtemp(join(tmpdir(), 'tradetools-terminal-recording-restart-'))
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
    let recordingStartedAtMs = new Date(2026, 5, 15, 10, 0, 0).getTime()
    const createClipForClosedTrade = vi.fn(async (_trade: ClosedTrade) => undefined)
    const watcher = createTerminalTradeWatcher({
      getSettings: async () => settings,
      ensureVideoRecordingReady: async () => true,
      protectSince: vi.fn(),
      createClipForClosedTrade,
      getRecordingStartedAtMs: () => recordingStartedAtMs,
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
        '15.06.2026 10:00:10.000 Binance via TIGER.COM Broker Futures: EnqueueUserPosition: Symbol=SKYAIUSDT;Account=BINANCE FUTURES;Price=27103;Size=36;Comission=0,00487854;PriceMode=[Unified] Open Only;Executions=1'
      ].join('\n') + '\n', 'utf8')

      await waitForAssertion(() => {
        expect(watcher.getStatus().activeTradeCount).toBe(1)
      })

      recordingStartedAtMs = new Date(2026, 5, 15, 10, 1, 0).getTime()
      await sleep(80)

      expect(watcher.getStatus().activeTradeCount).toBe(1)
      expect(watcher.getStatus().message).toContain('SKYAIUSDT')

      const exitTimeMs = new Date(2026, 5, 15, 10, 2, 0).getTime()
      await appendFile(logPath, createTigerTradePositionLine({
        timeMs: exitTimeMs,
        symbol: 'SKYAIUSDT',
        size: 0,
        executions: 2
      }) + '\n', 'utf8')
      await waitForAssertion(() => {
        expect(createClipForClosedTrade).toHaveBeenCalledTimes(1)
      })
      expect(createClipForClosedTrade.mock.calls[0]?.[0]).toMatchObject({
        symbol: 'SKYAIUSDT',
        entryTimeMs: new Date(2026, 5, 15, 10, 0, 10).getTime(),
        exitTimeMs
      })
      expect(createClipForClosedTrade.mock.calls[0]?.[0].entryTimeMs).not.toBe(exitTimeMs)
    } finally {
      watcher.stop()
      vi.unstubAllGlobals()
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it('records Vataga scale-ins and partial exits as one trade clip', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('MetaScalp offline')
    }))

    const rootDir = await mkdtemp(join(tmpdir(), 'tradetools-vataga-scale-'))
    const appDataDir = join(rootDir, 'AppData')
    const logsDir = join(appDataDir, 'Vataga', 'Vataga.terminal', 'Logs')
    const logPath = join(logsDir, 'log-20260615.clef')
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

    const finalExitTimeMs = Date.parse('2026-06-15T10:03:00.000Z')

    try {
      watcher.start()
      await waitForAssertion(() => {
        expect(watcher.getStatus().message).toContain('Vataga')
      })
      await sleep(50)
      await appendFile(logPath, [
        JSON.stringify({
          '@t': '2026-06-15T10:00:00.000Z',
          '@mt': 'Position changed.',
          Type: 'Trading',
          ExchangeType: 'Binance',
          PositionID: 'entry-1',
          SymbolTitle: 'Binance/BTCUSDT',
          IsClosed: false,
          PositionQuantity: 1,
          TradeTime: '2026-06-15T10:00:00.000',
          TradeSide: 'Buy',
          ProcessId: 39336
        }),
        JSON.stringify({
          '@t': '2026-06-15T10:01:00.000Z',
          '@mt': 'Position changed.',
          Type: 'Trading',
          ExchangeType: 'Binance',
          PositionID: 'entry-2',
          SymbolTitle: 'Binance/BTCUSDT',
          IsClosed: false,
          PositionQuantity: 1,
          TradeTime: '2026-06-15T10:01:00.000',
          TradeSide: 'Buy',
          ProcessId: 39336
        }),
        JSON.stringify({
          '@t': '2026-06-15T10:02:00.000Z',
          '@mt': 'Position changed.',
          Type: 'Trading',
          ExchangeType: 'Binance',
          PositionID: 'entry-1',
          SymbolTitle: 'Binance/BTCUSDT',
          IsClosed: true,
          PositionQuantity: 0,
          TradeTime: '2026-06-15T10:02:00.000',
          TradeSide: 'Sell',
          ProcessId: 39336
        }),
        JSON.stringify({
          '@t': '2026-06-15T10:03:00.000Z',
          '@mt': 'Position changed.',
          Type: 'Trading',
          ExchangeType: 'Binance',
          PositionID: 'entry-2',
          SymbolTitle: 'Binance/BTCUSDT',
          IsClosed: true,
          PositionQuantity: 0,
          TradeTime: '2026-06-15T10:03:00.000',
          TradeSide: 'Sell',
          ProcessId: 39336
        })
      ].join('\n') + '\n', 'utf8')

      await waitForAssertion(() => {
        expect(watcher.getStatus().lastEventAtMs).toBe(finalExitTimeMs)
      })

      expect(createClipForClosedTrade).toHaveBeenCalledTimes(1)
      expect(createClipForClosedTrade.mock.calls[0]?.[0]).toMatchObject({
        exchange: 'BINANCE',
        marketType: 'TERMINAL',
        symbol: 'BTCUSDT',
        side: 'LONG',
        status: 'closed',
        entryTimeMs: Date.parse('2026-06-15T10:00:00.000Z'),
        exitTimeMs: finalExitTimeMs
      })
      expect(watcher.getStatus().activeTradeCount).toBe(0)
    } finally {
      watcher.stop()
      vi.unstubAllGlobals()
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it('clips a TigerTrade reversal as one closed trade and one new trade', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('MetaScalp offline')
    }))

    const rootDir = await mkdtemp(join(tmpdir(), 'tradetools-terminal-reversal-'))
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
        '15.06.2026 10:00:30.000 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=BTCUSDT;Account=BINANCE FUTURES;Price=64950;Size=-1;Comission=0;Executions=2',
        '15.06.2026 10:01:00.000 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=BTCUSDT;Account=BINANCE FUTURES;Price=64900;Size=0;Comission=0;Executions=3'
      ].join('\n') + '\n', 'utf8')

      await waitForAssertion(() => {
        expect(createClipForClosedTrade).toHaveBeenCalledTimes(2)
      })

      expect(createClipForClosedTrade.mock.calls.map((call) => call[0])).toMatchObject([
        {
          symbol: 'BTCUSDT',
          side: 'LONG',
          entryTimeMs: new Date(2026, 5, 15, 10, 0, 0).getTime(),
          exitTimeMs: new Date(2026, 5, 15, 10, 0, 30).getTime()
        },
        {
          symbol: 'BTCUSDT',
          side: 'SHORT',
          entryTimeMs: new Date(2026, 5, 15, 10, 0, 30).getTime(),
          exitTimeMs: new Date(2026, 5, 15, 10, 1, 0).getTime()
        }
      ])
    } finally {
      watcher.stop()
      vi.unstubAllGlobals()
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it('clips a Vataga zero-quantity update even when the closed flag is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('MetaScalp offline')
    }))

    const rootDir = await mkdtemp(join(tmpdir(), 'tradetools-vataga-zero-close-'))
    const appDataDir = join(rootDir, 'AppData')
    const logsDir = join(appDataDir, 'Vataga', 'Vataga.terminal', 'Logs')
    const logPath = join(logsDir, 'log-20260615.clef')
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
        expect(watcher.getStatus().message).toContain('Vataga')
      })
      await sleep(50)
      await appendFile(logPath, [
        JSON.stringify({
          '@t': '2026-06-15T10:00:00.000Z',
          '@mt': 'Position changed.',
          Type: 'Trading',
          ExchangeType: 'Binance',
          PositionID: 'position-1',
          SymbolTitle: 'Binance/BTCUSDT',
          IsClosed: false,
          PositionQuantity: 1,
          TradeTime: '2026-06-15T10:00:00.000',
          TradeSide: 'Buy'
        }),
        JSON.stringify({
          '@t': '2026-06-15T10:00:30.000Z',
          '@mt': 'Position changed.',
          Type: 'Trading',
          ExchangeType: 'Binance',
          PositionID: 'position-1',
          SymbolTitle: 'Binance/BTCUSDT',
          IsClosed: false,
          PositionQuantity: 0,
          TradeTime: '2026-06-15T10:00:30.000',
          TradeSide: 'Sell'
        })
      ].join('\n') + '\n', 'utf8')

      await waitForAssertion(() => {
        expect(createClipForClosedTrade).toHaveBeenCalledTimes(1)
      })
      expect(createClipForClosedTrade.mock.calls[0]?.[0]).toMatchObject({
        symbol: 'BTCUSDT',
        side: 'LONG',
        entryTimeMs: Date.parse('2026-06-15T10:00:00.000Z'),
        exitTimeMs: Date.parse('2026-06-15T10:00:30.000Z')
      })
    } finally {
      watcher.stop()
      vi.unstubAllGlobals()
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it('suppresses only the same recent trade reported by another terminal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('MetaScalp offline')
    }))
    const entryTimeMs = new Date(2026, 5, 18, 10, 0, 0).getTime()
    const exitTimeMs = entryTimeMs + 5_000

    try {
      const clips = await runCrossSourcePair({
        tigerSymbol: 'BEATUSDT',
        vatagaSymbol: 'BEATUSDT',
        tigerEntryTimeMs: entryTimeMs,
        tigerExitTimeMs: exitTimeMs,
        vatagaEntryTimeMs: entryTimeMs + 500,
        vatagaExitTimeMs: exitTimeMs + 500
      })
      expect(clips).toHaveLength(1)
      expect(clips[0]).toMatchObject({ symbol: 'BEATUSDT', entryTimeMs, exitTimeMs })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not deduplicate different symbols reported by different terminals', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('MetaScalp offline')
    }))
    const entryTimeMs = new Date(2026, 5, 18, 10, 10, 0).getTime()
    const exitTimeMs = entryTimeMs + 5_000

    try {
      const clips = await runCrossSourcePair({
        tigerSymbol: 'BEATUSDT',
        vatagaSymbol: 'HEIUSDT',
        tigerEntryTimeMs: entryTimeMs,
        tigerExitTimeMs: exitTimeMs,
        vatagaEntryTimeMs: entryTimeMs,
        vatagaExitTimeMs: exitTimeMs
      })
      expect(clips.map((trade) => trade.symbol)).toEqual(['BEATUSDT', 'HEIUSDT'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not deduplicate cross-source trades more than one second apart', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('MetaScalp offline')
    }))
    const entryTimeMs = new Date(2026, 5, 18, 10, 20, 0).getTime()
    const exitTimeMs = entryTimeMs + 5_000

    try {
      const clips = await runCrossSourcePair({
        tigerSymbol: 'BEATUSDT',
        vatagaSymbol: 'BEATUSDT',
        tigerEntryTimeMs: entryTimeMs,
        tigerExitTimeMs: exitTimeMs,
        vatagaEntryTimeMs: entryTimeMs + 1_001,
        vatagaExitTimeMs: exitTimeMs + 1_001
      })
      expect(clips).toHaveLength(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('expires cross-source duplicate fingerprints after sixty seconds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('MetaScalp offline')
    }))
    const realNow = Date.now.bind(Date)
    let nowOffsetMs = 0
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + nowOffsetMs)
    const entryTimeMs = new Date(2026, 5, 18, 10, 30, 0).getTime()
    const exitTimeMs = entryTimeMs + 5_000

    try {
      const clips = await runCrossSourcePair({
        tigerSymbol: 'BEATUSDT',
        vatagaSymbol: 'BEATUSDT',
        tigerEntryTimeMs: entryTimeMs,
        tigerExitTimeMs: exitTimeMs,
        vatagaEntryTimeMs: entryTimeMs,
        vatagaExitTimeMs: exitTimeMs,
        afterTigerClip: () => {
          nowOffsetMs = 60_001
        }
      })
      expect(clips).toHaveLength(2)
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })

  it('does not deduplicate nearby trades from the same source', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('MetaScalp offline')
    }))

    const rootDir = await mkdtemp(join(tmpdir(), 'tradetools-terminal-same-source-'))
    const appDataDir = join(rootDir, 'AppData')
    const logsDir = join(appDataDir, 'TigerTrade', '4.1', 'Data', 'Logs')
    const logPath = join(logsDir, 'WorkLog_18.06.2026.log')
    await mkdir(logsDir, { recursive: true })
    await writeFile(logPath, '', 'utf8')
    const createClipForClosedTrade = vi.fn(async (_trade: ClosedTrade) => undefined)
    const watcher = createTerminalTradeWatcher({
      getSettings: async () => createDefaultSettings(rootDir),
      ensureVideoRecordingReady: async () => true,
      protectSince: vi.fn(),
      createClipForClosedTrade,
      env: { APPDATA: appDataDir },
      pollIntervalMs: 20
    })
    const entryTimeMs = new Date(2026, 5, 18, 10, 40, 0).getTime()
    const exitTimeMs = entryTimeMs + 5_000

    try {
      watcher.start()
      await waitForAssertion(() => {
        expect(watcher.getStatus().availableSources).toContain('tigertrade')
      })
      await appendFile(logPath, [
        createTigerTradePositionLine({
          timeMs: entryTimeMs,
          symbol: 'BEATUSDT',
          size: 1,
          executions: 1,
          account: 'BINANCE FUTURES'
        }),
        createTigerTradePositionLine({
          timeMs: entryTimeMs + 500,
          symbol: 'BEATUSDT',
          size: 2,
          executions: 1,
          account: 'BINANCE SPOT'
        }),
        createTigerTradePositionLine({
          timeMs: exitTimeMs,
          symbol: 'BEATUSDT',
          size: 0,
          executions: 2,
          account: 'BINANCE FUTURES'
        }),
        createTigerTradePositionLine({
          timeMs: exitTimeMs + 500,
          symbol: 'BEATUSDT',
          size: 0,
          executions: 2,
          account: 'BINANCE SPOT'
        })
      ].join('\n') + '\n', 'utf8')

      await waitForAssertion(() => {
        expect(createClipForClosedTrade).toHaveBeenCalledTimes(2)
      })
      expect(createClipForClosedTrade.mock.calls.map((call) => call[0].entryTimeMs)).toEqual([
        entryTimeMs,
        entryTimeMs + 500
      ])
    } finally {
      watcher.stop()
      vi.unstubAllGlobals()
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it('keeps overlapping symbols as independent clips with their own targets and times', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('MetaScalp offline')
    }))

    const rootDir = await mkdtemp(join(tmpdir(), 'tradetools-terminal-overlapping-symbols-'))
    const appDataDir = join(rootDir, 'AppData')
    const logsDir = join(appDataDir, 'TigerTrade', '4.1', 'Data', 'Logs')
    const logPath = join(logsDir, 'WorkLog_17.06.2026.log')
    await mkdir(logsDir, { recursive: true })
    await writeFile(logPath, '', 'utf8')

    const defaultSettings = createDefaultSettings(rootDir)
    const createClipForClosedTrade = vi.fn(async (_trade: ClosedTrade) => undefined)
    const beatTarget = { id: 'window:tiger-beat', name: 'TigerTrade BEATUSDT', type: 'window' as const }
    const heiTarget = { id: 'window:tiger-hei', name: 'TigerTrade HEIUSDT', type: 'window' as const }
    const resolveRecordingTarget = vi.fn(async (event: { symbol: string }) => (
      event.symbol === 'BEATUSDT' ? beatTarget : heiTarget
    ))
    const watcher = createTerminalTradeWatcher({
      getSettings: async () => defaultSettings,
      ensureVideoRecordingReady: async () => true,
      protectSince: vi.fn(),
      createClipForClosedTrade,
      resolveRecordingTarget,
      env: { APPDATA: appDataDir },
      pollIntervalMs: 20
    })

    const beatEntryTimeMs = new Date(2026, 5, 17, 10, 0, 0).getTime()
    const heiEntryTimeMs = new Date(2026, 5, 17, 10, 0, 5).getTime()
    const heiExitTimeMs = new Date(2026, 5, 17, 10, 0, 30).getTime()
    const beatExitTimeMs = new Date(2026, 5, 17, 10, 0, 40).getTime()

    try {
      watcher.start()
      await waitForAssertion(() => {
        expect(watcher.getStatus().availableSources).toContain('tigertrade')
      })
      await appendFile(logPath, [
        createTigerTradePositionLine({ timeMs: beatEntryTimeMs, symbol: 'BEATUSDT', size: 4, executions: 1 }),
        createTigerTradePositionLine({ timeMs: heiEntryTimeMs, symbol: 'HEIUSDT', size: -8, executions: 1 }),
        createTigerTradePositionLine({ timeMs: heiExitTimeMs, symbol: 'HEIUSDT', size: 0, executions: 2 }),
        createTigerTradePositionLine({ timeMs: beatExitTimeMs, symbol: 'BEATUSDT', size: 0, executions: 2 })
      ].join('\n') + '\n', 'utf8')

      await waitForAssertion(() => {
        expect(createClipForClosedTrade).toHaveBeenCalledTimes(2)
      })
      expect(createClipForClosedTrade.mock.calls.map((call) => call[0])).toMatchObject([
        {
          symbol: 'HEIUSDT',
          side: 'SHORT',
          entryTimeMs: heiEntryTimeMs,
          exitTimeMs: heiExitTimeMs,
          recordingTarget: heiTarget
        },
        {
          symbol: 'BEATUSDT',
          side: 'LONG',
          entryTimeMs: beatEntryTimeMs,
          exitTimeMs: beatExitTimeMs,
          recordingTarget: beatTarget
        }
      ])
      expect(watcher.getStatus().activeTradeCount).toBe(0)
    } finally {
      watcher.stop()
      vi.unstubAllGlobals()
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it('attaches the resolved terminal capture target to the closed trade', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('MetaScalp offline')
    }))

    const rootDir = await mkdtemp(join(tmpdir(), 'tradetools-terminal-target-'))
    const appDataDir = join(rootDir, 'AppData')
    const logsDir = join(appDataDir, 'TigerTrade', '4.1', 'Data', 'Logs')
    const logPath = join(logsDir, 'WorkLog_17.06.2026.log')
    await mkdir(logsDir, { recursive: true })
    await writeFile(logPath, '', 'utf8')

    const target = { id: 'window:tiger', name: 'TigerTrade Terminal', type: 'window' as const }
    const defaultSettings = createDefaultSettings(rootDir)
    const createClipForClosedTrade = vi.fn(async (_trade: ClosedTrade) => undefined)
    const resolveRecordingTarget = vi.fn(async () => target)
    const watcher = (createTerminalTradeWatcher as any)({
      getSettings: async () => defaultSettings,
      ensureVideoRecordingReady: async () => true,
      protectSince: vi.fn(),
      createClipForClosedTrade,
      resolveRecordingTarget,
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
        '17.06.2026 10:00:00.000 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=SIRENUSDT;Account=BINANCE FUTURES;Price=0;Size=1;Comission=0;Executions=1',
        '17.06.2026 10:00:05.000 Binance via TIGER.COM Broker Spot: EnqueueUserPosition: Symbol=SIRENUSDT;Account=BINANCE FUTURES;Price=0;Size=0;Comission=0;Executions=2'
      ].join('\n') + '\n', 'utf8')

      await waitForAssertion(() => {
        expect(createClipForClosedTrade).toHaveBeenCalledTimes(1)
      })

      expect(resolveRecordingTarget).toHaveBeenCalledWith(expect.objectContaining({ source: 'tigertrade' }))
      expect(createClipForClosedTrade.mock.calls[0]?.[0]).toMatchObject({
        symbol: 'SIRENUSDT',
        recordingTarget: target
      })
    } finally {
      watcher.stop()
      vi.unstubAllGlobals()
      await rm(rootDir, { recursive: true, force: true })
    }
  })
})
