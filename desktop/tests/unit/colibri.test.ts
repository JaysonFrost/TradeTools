import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { createDefaultSettings } from '../../src/main/services/settings/settings'
import type { ClosedTrade } from '../../src/main/services/trades/simulatedTradePipeline'
import {
  createTerminalTradeWatcher, diffColibriPositionSnapshots, getColibriDiscoveryPath,
  parseColibriPositionSnapshot
} from '../../src/main/services/trades/terminalTradeRecorder'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn(async (...args: Parameters<typeof actual.readFile>) => (
      String(args[0]).endsWith('localapi.json')
        ? JSON.stringify({ port: 18846, pid: 123 })
        : actual.readFile(...args)
    ))
  }
})

afterEach(() => { vi.unstubAllGlobals() })

const waitFor = async (assertion: () => void) => {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { assertion(); return } catch { await new Promise((resolve) => setTimeout(resolve, 20)) }
  }
  assertion()
}

const connection = { id: 'account-a', exchange: 'BinanceLinearFutures' }
const position = { symbol: 'BTCUSDT', quantity: '2' }

it('discovers the native API and normalizes signed account-scoped positions', () => {
  expect(getColibriDiscoveryPath({ APPDATA: 'data' })).toBe(join('data', 'Colibri', 'localapi.json'))
  const event = parseColibriPositionSnapshot(position, connection, 1000)!
  expect(event).toMatchObject({ source: 'colibri', exchange: 'BINANCE', size: 2, side: 'LONG' })
  expect(parseColibriPositionSnapshot({ ...position, quantity: '-2' }, connection, 1000)?.side).toBe('SHORT')
  expect(parseColibriPositionSnapshot({ ...position, quantity: 'bad' }, connection, 1000)).toBeUndefined()
  expect(parseColibriPositionSnapshot(position, { ...connection, id: 'account-b' }, 1000)?.positionId).not.toBe(event.positionId)
  const current = new Map([[event.positionId, event]])
  expect(diffColibriPositionSnapshots(current, new Map(), false, 1000).events).toEqual([])
  expect(diffColibriPositionSnapshots(current, new Map(), true, 1000).events).toEqual([event])
  const reversed = { ...event, size: -1, side: 'SHORT' }
  expect(diffColibriPositionSnapshots(new Map([[event.positionId, reversed]]), current, true, 2000).events).toEqual([reversed])
  expect(diffColibriPositionSnapshots(new Map(), current, true, 3000).events[0]).toMatchObject({ isClosed: true, eventTimeMs: 3000 })
})

it('records a live round trip and preserves it across failed or malformed snapshots', async () => {
  let positions: unknown[] = []
  let failed = false
  const fetchMock = vi.fn(async (url: string) => {
    if (!url.startsWith('http://127.0.0.1:18846/')) throw new Error('Offline')
    if (url.endsWith('/ping')) return { ok: true, json: async () => ({ name: 'Colibri' }) }
    if (url.endsWith('/connections')) return { ok: true, json: async () => ({ connections: [connection] }) }
    if (failed) throw new Error('Offline')
    return { ok: true, json: async () => ({ connectionId: connection.id, positions }) }
  })
  vi.stubGlobal('fetch', fetchMock)
  const settings = createDefaultSettings('test')
  settings.tradeSource.mode = 'terminal-window'
  const createClip = vi.fn(async (_trade: ClosedTrade) => undefined)
  const watcher = createTerminalTradeWatcher({
    env: { APPDATA: 'missing-colibri-test-data' },
    getSettings: async () => settings,
    ensureVideoRecordingReady: async () => true,
    protectSince: vi.fn(),
    createClipForClosedTrade: createClip,
    pollIntervalMs: 10
  })
  watcher.start()
  try {
    await waitFor(() => expect(watcher.getStatus().availableSources).toContain('colibri'))
    positions = [position]
    await waitFor(() => expect(watcher.getStatus().activeTradeCount).toBe(1))
    failed = true
    await waitFor(() => expect(watcher.getStatus().availableSources).not.toContain('colibri'))
    failed = false
    positions = [{ ...position, quantity: 'bad' }]
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(createClip).not.toHaveBeenCalled()
    expect(watcher.getStatus().activeTradeCount).toBe(1)
    positions = []
    await waitFor(() => expect(createClip).toHaveBeenCalledTimes(1))
    expect(createClip.mock.calls[0]?.[0]).toMatchObject({ exchange: 'BINANCE', symbol: 'BTCUSDT', side: 'LONG' })
    expect(watcher.getStatus().availableSources).toContain('colibri')
  } finally {
    watcher.stop()
  }
})
