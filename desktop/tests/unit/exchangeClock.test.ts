import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultSettings } from '../../src/main/services/settings/settings'
import type { ClosedTrade } from '../../src/main/services/trades/simulatedTradePipeline'
import { createTerminalTradeWatcher } from '../../src/main/services/trades/terminalTradeRecorder'
import { createExchangeClock, estimateClockOffsetMs, fetchBinanceServerTimeMs } from '../../src/main/services/time/exchangeClock'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const waitFor = async (assertion: () => void, timeoutMs = 1_500) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      assertion()
      return
    } catch (error) {
      if (Date.now() > deadline) throw error
      await sleep(25)
    }
  }
}

const lootxFill = (timeMs: number, side: 'Bid' | 'Ask', execId: string) => ({
  TimestampMs: timeMs,
  Instrument: { ExchangeId: 'BINANCEF', Symbol: 'QUSDT' },
  Side: side,
  QuantityRaw: 5,
  QuantityScale: 1,
  TradeId: timeMs,
  ExecId: execId,
  OrderId: `order-${execId}`,
  CumulativeFilledQtyRaw: 5,
  ConnectionTag: 'lootx-account:F'
})

describe('exchange clock', () => {
  it('estimates the offset from the sample with the shortest round trip', () => {
    expect(estimateClockOffsetMs([
      { requestedAtMs: 1_000, serverTimeMs: 3_000, receivedAtMs: 1_600 },
      { requestedAtMs: 2_000, serverTimeMs: 3_120, receivedAtMs: 2_300 },
      { requestedAtMs: 4_000, serverTimeMs: 9_000, receivedAtMs: 6_000 }
    ])).toBe(970)
    expect(estimateClockOffsetMs([{ requestedAtMs: 0, serverTimeMs: 5_000, receivedAtMs: 2_000 }])).toBeUndefined()
    expect(estimateClockOffsetMs([])).toBeUndefined()
  })

  it('keeps the last good offset when the exchange is unreachable', async () => {
    let nowMs = 10_000
    const fetchServerTimeMs = vi.fn(async () => {
      nowMs += 100
      return nowMs + 920
    })
    const onOffset = vi.fn()
    const clock = createExchangeClock({ fetchServerTimeMs, now: () => nowMs, sampleCount: 2, onOffset })
    expect(clock.offsetMs()).toBe(0)
    await clock.refresh()
    expect(clock.offsetMs()).toBe(970)
    expect(onOffset).toHaveBeenCalledWith(970)

    fetchServerTimeMs.mockRejectedValue(new Error('blocked'))
    await clock.refresh()
    expect(clock.offsetMs()).toBe(970)
    expect(onOffset).toHaveBeenCalledTimes(1)
  })

  it('reads Binance server time', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ serverTime: 1_792_949_416_800 })))
    await expect(fetchBinanceServerTimeMs(fetcher)).resolves.toBe(1_792_949_416_800)
    await expect(fetchBinanceServerTimeMs(async () => new Response('{}'))).rejects.toThrow()
    await expect(fetchBinanceServerTimeMs(async () => new Response('', { status: 451 }))).rejects.toThrow('HTTP 451')
  })

  it('moves LootX exchange fill times onto the local recording clock', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('MetaScalp offline')
    }))
    const rootDir = await mkdtemp(join(tmpdir(), 'tradetools-lootx-clock-'))
    const journalDir = join(rootDir, 'AppData', 'TradingTerminal')
    const journalPath = join(journalDir, 'journal.json')
    const offsetMs = 970
    const recordingStartedAtMs = Date.now() - 5_000
    const journal = (trades: unknown[]) => JSON.stringify({ ResetTimestampMs: 100, Trades: trades, RoundTrips: [] })
    await mkdir(journalDir, { recursive: true })
    await writeFile(journalPath, journal([]), 'utf8')
    const createClipForClosedTrade = vi.fn(async (_trade: ClosedTrade) => undefined)
    const watcher = createTerminalTradeWatcher({
      getSettings: async () => createDefaultSettings(rootDir),
      getRecordingStartedAtMs: () => recordingStartedAtMs,
      ensureVideoRecordingReady: async () => true,
      protectSince: vi.fn(),
      createClipForClosedTrade,
      getExchangeClockOffsetMs: () => offsetMs,
      env: { APPDATA: join(rootDir, 'AppData') },
      pollIntervalMs: 20
    })

    try {
      watcher.start()
      await waitFor(() => expect(watcher.getStatus().availableSources).toContain('lootx'))
      const entryExchangeMs = recordingStartedAtMs + 2_000
      const exitExchangeMs = entryExchangeMs + 1_500
      await writeFile(journalPath, journal([lootxFill(entryExchangeMs, 'Bid', 'entry')]), 'utf8')
      await waitFor(() => expect(watcher.getStatus().activeTradeCount).toBe(1))
      await writeFile(journalPath, journal([lootxFill(entryExchangeMs, 'Bid', 'entry'), lootxFill(exitExchangeMs, 'Ask', 'exit')]), 'utf8')
      await waitFor(() => expect(createClipForClosedTrade).toHaveBeenCalledTimes(1))
      expect(createClipForClosedTrade.mock.calls[0]?.[0]).toMatchObject({
        entryTimeMs: entryExchangeMs - offsetMs,
        exitTimeMs: exitExchangeMs - offsetMs
      })
    } finally {
      watcher.stop()
      vi.unstubAllGlobals()
      await rm(rootDir, { recursive: true, force: true })
    }
  })
})
