import { randomUUID } from 'node:crypto'
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppSettings } from '../settings/settings'
import type { ClosedTrade } from './simulatedTradePipeline'
import type { ClipQueueItem } from './tradeClipPipeline'

export type TerminalTradeSource = 'vataga' | 'tigertrade' | 'metascalp'

export type TerminalTradeRecordingStatus = {
  active: boolean
  startedAtMs: number
  message: string
  source: TerminalTradeSource | 'multi-terminal' | 'manual'
  activeTradeCount: number
  lastEventAtMs?: number
  lastError?: string
}

export type OpenTerminalTrade = Omit<ClosedTrade, 'status' | 'exitTimeMs'> & {
  status: 'open'
  positionId: string
}

export type TerminalPositionEvent = {
  source: TerminalTradeSource
  positionId: string
  exchange: string
  symbol: string
  side: string
  isClosed: boolean
  eventTimeMs: number
}

export type VatagaPositionEvent = TerminalPositionEvent & {
  source: 'vataga'
}

export type TerminalTradeWatcher = {
  start: () => void
  stop: () => void
  getStatus: () => TerminalTradeRecordingStatus
}

export type TerminalTradeWatcherInput = {
  getSettings: () => Promise<AppSettings>
  ensureVideoRecordingReady: () => Promise<boolean>
  protectSince: (timeMs?: number) => void
  createClipForClosedTrade: (trade: ClosedTrade) => Promise<ClipQueueItem | void>
  onStatusChange?: (status: TerminalTradeRecordingStatus) => void
  env?: NodeJS.ProcessEnv
  pollIntervalMs?: number
}

type LogCursor = {
  offset: number
  remainder: string
}

type LogProviderState = {
  source: TerminalTradeSource
  displayName: string
  getLogFiles: () => Promise<string[]>
  parseLine: (line: string) => TerminalPositionEvent | undefined
  cursors: Map<string, LogCursor>
  initialized: boolean
  available: boolean
}

type MetaScalpConnection = Record<string, unknown>
type MetaScalpSnapshotDiff = {
  events: TerminalPositionEvent[]
  currentOpenPositions: Map<string, TerminalPositionEvent>
  initialized: boolean
}

const defaultPollIntervalMs = 1_000
const readChunkSize = 128 * 1024
const metaScalpPorts = Array.from({ length: 11 }, (_, index) => 17_845 + index)
const metaScalpProbeCooldownMs = 5_000
const metaScalpRequestTimeoutMs = 900
const zeroTolerance = 1e-12

const sourceDisplayNames: Record<TerminalTradeSource, string> = {
  vataga: 'Vataga',
  tigertrade: 'TigerTrade',
  metascalp: 'MetaScalp'
}

const normalizeText = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

const normalizeAnyText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return ''
}

const parseNumericValue = (value: unknown): number => {
  if (typeof value === 'number') return value
  const text = normalizeAnyText(value).replace(',', '.')
  if (!text) return Number.NaN
  return Number(text)
}

const isNearlyZero = (value: number): boolean => Number.isFinite(value) && Math.abs(value) <= zeroTolerance

const getField = (record: unknown, names: string[]): unknown => {
  if (!record || typeof record !== 'object') return undefined
  const entries = Object.entries(record as Record<string, unknown>)
  for (const name of names) {
    const match = entries.find(([key]) => key.toLowerCase() === name.toLowerCase())
    if (match) return match[1]
  }
  return undefined
}

const getErrorCode = (error: unknown): string => (
  typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
)

const getErrorMessage = (error: unknown, fallback: string): string => (
  error instanceof Error && error.message ? error.message : fallback
)

const normalizeTerminalSymbol = (value: unknown, fallback = 'TERMINAL'): string => {
  const text = normalizeAnyText(value)
  return text.toUpperCase().replace(/[^A-Z0-9]+/g, '') || fallback
}

const normalizeVatagaSymbolTitle = (value: unknown): string => {
  const text = normalizeAnyText(value)
  const symbol = text.includes('/') ? text.split('/').at(-1) ?? text : text
  return normalizeTerminalSymbol(symbol)
}

const normalizeExchangeName = (value: unknown, fallback: string): string => {
  const text = normalizeAnyText(value)
  if (!text) return fallback
  const firstChunk = text.split(/[\s:|/\\-]+/).find(Boolean) ?? text
  return firstChunk.toUpperCase().replace(/[^A-Z0-9]+/g, '') || fallback
}

const normalizeSideFromSize = (size: number, fallback: unknown = undefined): string => {
  if (Number.isFinite(size) && !isNearlyZero(size)) return size > 0 ? 'LONG' : 'SHORT'

  const side = normalizeAnyText(fallback).toLowerCase()
  if (['buy', 'long', 'bought', '1'].includes(side)) return 'LONG'
  if (['sell', 'short', 'sold', '2', '-1'].includes(side)) return 'SHORT'
  return 'TRADE'
}

const parseVatagaTime = (value: unknown): number => {
  const text = normalizeText(value)
  if (!text) return 0
  const normalized = /(?:z|[+-]\d\d:?\d\d)$/i.test(text) ? text : `${text}Z`
  const time = Date.parse(normalized)
  return Number.isFinite(time) && time > 0 ? time : 0
}

const parseLocalDateTime = (
  day: string,
  month: string,
  year: string,
  hour: string,
  minute: string,
  second: string,
  millisecond = '0'
): number => {
  const time = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond.padEnd(3, '0').slice(0, 3))
  ).getTime()
  return Number.isFinite(time) && time > 0 ? time : 0
}

const parseMaybeTime = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? value * 1000 : value
  }

  const text = normalizeAnyText(value)
  if (!text) return 0
  const localMatch = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(text)
  if (localMatch) {
    return parseLocalDateTime(localMatch[1], localMatch[2], localMatch[3], localMatch[4], localMatch[5], localMatch[6], localMatch[7] ?? '0')
  }

  const parsed = Date.parse(text)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const normalizeVatagaExchange = (value: unknown, symbolTitle: unknown): string => {
  const exchange = normalizeText(value)
  if (exchange) return exchange.toUpperCase()

  const title = normalizeText(symbolTitle)
  return (title.includes('/') ? title.split('/')[0] : title || 'VATAGA').toUpperCase()
}

const normalizeVatagaSide = (quantity: unknown, tradeSide: unknown): string => {
  const size = parseNumericValue(quantity)
  if (Number.isFinite(size) && !isNearlyZero(size)) return size > 0 ? 'LONG' : 'SHORT'

  const side = normalizeText(tradeSide).toLowerCase()
  if (side === 'buy') return 'LONG'
  if (side === 'sell') return 'SHORT'
  return 'TRADE'
}

export const parseVatagaPositionEvent = (line: string): VatagaPositionEvent | undefined => {
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(line.trim()) as Record<string, unknown>
  } catch {
    return undefined
  }

  if (payload.Type !== 'Trading') return undefined
  if (!normalizeText(payload['@mt']).startsWith('Position changed')) return undefined

  const positionId = normalizeText(payload.PositionID)
  if (!positionId) return undefined

  const eventTimeMs = parseVatagaTime(payload.TradeTime) || parseVatagaTime(payload['@t'])
  if (!eventTimeMs) return undefined

  return {
    source: 'vataga',
    positionId,
    exchange: normalizeVatagaExchange(payload.ExchangeType, payload.SymbolTitle),
    symbol: normalizeVatagaSymbolTitle(payload.SymbolTitle),
    side: normalizeVatagaSide(payload.PositionQuantity, payload.TradeSide),
    isClosed: payload.IsClosed === true,
    eventTimeMs
  }
}

const parseKeyValuePairs = (text: string): Record<string, string> => {
  const result: Record<string, string> = {}
  for (const part of text.split(';')) {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex <= 0) continue
    const key = part.slice(0, separatorIndex).trim()
    const value = part.slice(separatorIndex + 1).trim()
    if (key) result[key] = value
  }
  return result
}

export const parseTigerTradePositionEvent = (line: string): TerminalPositionEvent | undefined => {
  if (!line.includes('EnqueueUserPosition:')) return undefined

  const match = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?\s+(.+?):\s+EnqueueUserPosition:\s+(.+)$/.exec(line.trim())
  if (!match) return undefined

  const fields = parseKeyValuePairs(match[9])
  const symbol = normalizeAnyText(fields.Symbol)
  const account = normalizeAnyText(fields.Account)
  const size = parseNumericValue(fields.Size)
  if (!symbol || !account || !Number.isFinite(size)) return undefined

  const eventTimeMs = parseLocalDateTime(match[1], match[2], match[3], match[4], match[5], match[6], match[7] ?? '0')
  if (!eventTimeMs) return undefined

  return {
    source: 'tigertrade',
    positionId: `${account}:${symbol}`.toUpperCase(),
    exchange: normalizeExchangeName(account || match[8], 'TIGERTRADE'),
    symbol: normalizeTerminalSymbol(symbol),
    side: normalizeSideFromSize(size),
    isClosed: isNearlyZero(size),
    eventTimeMs
  }
}

const toPayloadArray = (payload: unknown, nestedKeys: string[]): unknown[] => {
  if (Array.isArray(payload)) return payload
  for (const key of nestedKeys) {
    const nested = getField(payload, [key])
    if (Array.isArray(nested)) return nested
  }
  const data = getField(payload, ['data', 'result', 'value', 'items'])
  if (Array.isArray(data)) return data
  return []
}

const normalizeMetaScalpSide = (position: unknown, size: number): string => {
  if (Number.isFinite(size) && !isNearlyZero(size)) return size > 0 ? 'LONG' : 'SHORT'

  const side = getField(position, ['Side', 'side', 'Direction', 'direction'])
  if (typeof side === 'number') {
    if (side === 1) return 'LONG'
    if (side === 2 || side === 0) return 'SHORT'
  }
  return normalizeSideFromSize(Number.NaN, side)
}

const hasTruthyFlag = (value: unknown): boolean => value === true || normalizeAnyText(value).toLowerCase() === 'true'

const isMetaScalpClosedStatus = (value: unknown): boolean => {
  const text = normalizeAnyText(value).toLowerCase()
  if (!text || /^-?\d+$/.test(text)) return false
  return /(closed|close|flat|inactive|deleted|finished|done|canceled|cancelled)/i.test(text)
}

const isMetaScalpClosedSnapshot = (position: unknown): boolean => {
  if (!position || typeof position !== 'object') return true
  if (hasTruthyFlag(getField(position, ['IsClosed', 'isClosed', 'Closed', 'closed']))) return true
  return isMetaScalpClosedStatus(getField(position, [
    'Status',
    'status',
    'State',
    'state',
    'PositionStatus',
    'positionStatus'
  ]))
}

export const parseMetaScalpPositionSnapshot = (
  position: unknown,
  connection: MetaScalpConnection,
  nowMs: number
): TerminalPositionEvent | undefined => {
  if (!position || typeof position !== 'object') return undefined
  if (isMetaScalpClosedSnapshot(position)) return undefined

  const connectionId = normalizeAnyText(getField(connection, ['Id', 'ConnectionId', 'connectionId', 'id']))
  const positionId = normalizeAnyText(getField(position, ['PositionId', 'positionId', 'Id', 'id']))
  const ticker = normalizeAnyText(getField(position, ['Ticker', 'ticker', 'Symbol', 'symbol']))
  const size = parseNumericValue(getField(position, ['Size', 'size', 'CurrentSize', 'currentSize', 'Quantity', 'quantity']))
  if (!ticker || !Number.isFinite(size) || isNearlyZero(size)) return undefined

  const exchange = normalizeExchangeName(
    getField(connection, ['Exchange', 'exchange', 'Name', 'name']) ?? getField(position, ['Exchange', 'exchange']),
    'METASCALP'
  )
  const eventTimeMs = parseMaybeTime(
    getField(position, ['OpenTime', 'openTime', 'CreateDate', 'createDate', 'Time', 'time'])
  ) || nowMs

  return {
    source: 'metascalp',
    positionId: `${connectionId || 'connection'}:${positionId || ticker}`.toUpperCase(),
    exchange,
    symbol: normalizeTerminalSymbol(ticker),
    side: normalizeMetaScalpSide(position, size),
    isClosed: false,
    eventTimeMs
  }
}

export const diffMetaScalpPositionSnapshots = (
  currentOpenPositions: Map<string, TerminalPositionEvent>,
  previousOpenPositions: Map<string, TerminalPositionEvent>,
  initialized: boolean,
  nowMs: number
): MetaScalpSnapshotDiff => {
  if (!initialized) {
    return {
      events: [],
      currentOpenPositions,
      initialized: true
    }
  }

  const events: TerminalPositionEvent[] = []
  for (const [positionKey, event] of currentOpenPositions) {
    if (!previousOpenPositions.has(positionKey)) events.push(event)
  }

  for (const [positionKey, previousEvent] of previousOpenPositions) {
    if (currentOpenPositions.has(positionKey)) continue
    events.push({
      ...previousEvent,
      isClosed: true,
      eventTimeMs: nowMs
    })
  }

  return {
    events,
    currentOpenPositions,
    initialized: true
  }
}

export const createIdleTerminalTradeStatus = (): TerminalTradeRecordingStatus => ({
  active: false,
  startedAtMs: 0,
  message: 'Автоматически ждём сделки Vataga, TigerTrade или MetaScalp',
  source: 'multi-terminal',
  activeTradeCount: 0
})

export const createTerminalClosedTrade = (entryTimeMs: number, exitTimeMs: number): ClosedTrade => ({
  id: `terminal-${randomUUID()}`,
  exchange: 'LOCAL TERMINAL',
  marketType: 'WINDOW',
  symbol: 'TERMINAL',
  side: 'TRADE',
  status: 'closed',
  entryTimeMs,
  exitTimeMs
})

const getMacApplicationSupportDir = (env: NodeJS.ProcessEnv): string | undefined => {
  const homeDir = normalizeText(env.HOME)
  return homeDir ? join(homeDir, 'Library', 'Application Support') : undefined
}

export const getVatagaLogsDir = (env: NodeJS.ProcessEnv): string | undefined => {
  const appData = normalizeText(env.APPDATA)
  const dataDir = appData || getMacApplicationSupportDir(env)
  return dataDir ? join(dataDir, 'Vataga', 'Vataga.terminal', 'Logs') : undefined
}

const getTigerTradeRootDir = (env: NodeJS.ProcessEnv): string | undefined => {
  const appData = normalizeText(env.APPDATA)
  return appData ? join(appData, 'TigerTrade') : undefined
}

const listLogFiles = async (logsDir: string | undefined, pattern: RegExp): Promise<string[]> => {
  if (!logsDir) return []
  try {
    const entries = await readdir(logsDir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && pattern.test(entry.name))
      .map((entry) => join(logsDir, entry.name))
      .sort()
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return []
    throw error
  }
}

const listTigerTradeLogFiles = async (rootDir: string | undefined): Promise<string[]> => {
  if (!rootDir) return []
  let entries: Array<{ name: string, isDirectory: () => boolean }>
  try {
    entries = await readdir(rootDir, { withFileTypes: true })
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return []
    throw error
  }

  const logDirs = [
    join(rootDir, 'Data', 'Logs'),
    ...entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(rootDir, entry.name, 'Data', 'Logs'))
  ]
  const files = (await Promise.all(logDirs.map((logsDir) => listLogFiles(logsDir, /^WorkLog_.+\.log$/i)))).flat()
  return [...new Set(files)].sort()
}

const readNewLines = async (
  filePath: string,
  cursor: LogCursor,
  enqueueLine: (line: string) => void
) => {
  const fileStat = await stat(filePath)
  if (fileStat.size < cursor.offset) {
    cursor.offset = 0
    cursor.remainder = ''
  }
  if (fileStat.size === cursor.offset) return

  const file = await open(filePath, 'r')
  try {
    let position = cursor.offset
    let text = ''
    while (position < fileStat.size) {
      const buffer = Buffer.alloc(Math.min(readChunkSize, fileStat.size - position))
      const result = await file.read(buffer, 0, buffer.length, position)
      if (result.bytesRead <= 0) break
      text += buffer.subarray(0, result.bytesRead).toString('utf8')
      position += result.bytesRead
    }
    cursor.offset = position

    const fullText = cursor.remainder + text
    const lines = fullText.split(/\r?\n/)
    cursor.remainder = fullText.endsWith('\n') || fullText.endsWith('\r') ? '' : lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) enqueueLine(line)
    }
  } finally {
    await file.close()
  }
}

const fetchJsonWithTimeout = async (url: string, timeoutMs: number): Promise<unknown> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

export const createTerminalTradeWatcher = ({
  getSettings,
  ensureVideoRecordingReady,
  protectSince,
  createClipForClosedTrade,
  onStatusChange,
  env = process.env,
  pollIntervalMs = defaultPollIntervalMs
}: TerminalTradeWatcherInput): TerminalTradeWatcher => {
  const vatagaLogsDir = getVatagaLogsDir(env)
  const tigerTradeRootDir = getTigerTradeRootDir(env)
  const providers: LogProviderState[] = [
    {
      source: 'vataga',
      displayName: 'Vataga',
      getLogFiles: () => listLogFiles(vatagaLogsDir, /^log-\d{8}\.clef$/i),
      parseLine: parseVatagaPositionEvent,
      cursors: new Map(),
      initialized: false,
      available: false
    },
    {
      source: 'tigertrade',
      displayName: 'TigerTrade',
      getLogFiles: () => listTigerTradeLogFiles(tigerTradeRootDir),
      parseLine: parseTigerTradePositionEvent,
      cursors: new Map(),
      initialized: false,
      available: false
    }
  ]

  const activeTrades = new Map<string, OpenTerminalTrade>()
  const renderedTradeIds = new Set<string>()
  let metaScalpBaseUrl: string | undefined
  let metaScalpLastProbeAtMs = 0
  let metaScalpKnownOpenPositions = new Map<string, TerminalPositionEvent>()
  let metaScalpSnapshotInitialized = false
  let metaScalpAvailable = false
  let timer: NodeJS.Timeout | undefined
  let polling = false
  let processing = Promise.resolve()
  let status = createIdleTerminalTradeStatus()

  const emit = (patch: Partial<TerminalTradeRecordingStatus>) => {
    const startedAtMs = activeTrades.size
      ? Math.min(...[...activeTrades.values()].map((trade) => trade.entryTimeMs))
      : 0
    status = {
      ...status,
      active: activeTrades.size > 0,
      startedAtMs,
      activeTradeCount: activeTrades.size,
      ...patch
    }
    onStatusChange?.(status)
  }

  const providerNames = () => {
    const names = providers.filter((provider) => provider.available).map((provider) => provider.displayName)
    if (metaScalpAvailable) names.push('MetaScalp')
    return [...new Set(names)]
  }

  const emitAvailabilityStatus = () => {
    if (activeTrades.size > 0) return
    const names = providerNames()
    const message = names.length
      ? `Автозапись терминалов включена: ${names.join(', ')}`
      : 'Откройте Vataga, TigerTrade или MetaScalp, TradeTools сам поймает сделки'
    if (status.message !== message) emit({ message, source: 'multi-terminal', lastError: undefined })
  }

  const protectActiveTrades = async () => {
    if (activeTrades.size === 0) {
      protectSince()
      return
    }

    const settings = await getSettings()
    const earliestEntryTimeMs = Math.min(...[...activeTrades.values()].map((trade) => trade.entryTimeMs))
    protectSince(earliestEntryTimeMs - settings.clip.paddingBeforeSeconds * 1000 - 5_000)
  }

  const getPositionKey = (event: TerminalPositionEvent): string => `${event.source}:${event.positionId}`

  const handleTerminalEvent = async (event: TerminalPositionEvent) => {
    const sourceName = sourceDisplayNames[event.source]
    const positionKey = getPositionKey(event)

    if (!event.isClosed) {
      if (!activeTrades.has(positionKey)) {
        activeTrades.set(positionKey, {
          id: `${event.source}-${event.positionId}`,
          positionId: positionKey,
          exchange: event.exchange,
          marketType: 'TERMINAL',
          symbol: event.symbol,
          side: event.side,
          status: 'open',
          entryTimeMs: event.eventTimeMs
        })
      }

      await ensureVideoRecordingReady().catch(() => false)
      await protectActiveTrades()
      emit({
        source: event.source,
        message: `${sourceName}: записываем ${event.symbol} ${event.side}`,
        lastEventAtMs: event.eventTimeMs,
        lastError: undefined
      })
      return
    }

    const openTrade = activeTrades.get(positionKey)
    if (!openTrade) return

    const closedTrade: ClosedTrade = {
      id: `${openTrade.id}-${openTrade.entryTimeMs}-${event.eventTimeMs}`,
      exchange: openTrade.exchange,
      marketType: openTrade.marketType,
      symbol: openTrade.symbol,
      side: openTrade.side,
      status: 'closed',
      entryTimeMs: openTrade.entryTimeMs,
      exitTimeMs: event.eventTimeMs
    }

    if (renderedTradeIds.has(closedTrade.id)) return
    renderedTradeIds.add(closedTrade.id)
    emit({
      source: event.source,
      message: `${sourceName}: ${closedTrade.symbol} закрыта, сохраняем клип`,
      lastEventAtMs: event.eventTimeMs,
      lastError: undefined
    })

    try {
      await protectActiveTrades()
      await createClipForClosedTrade(closedTrade)
      activeTrades.delete(positionKey)
      await protectActiveTrades()
      emit({
        source: event.source,
        message: `${sourceName}: клип ${closedTrade.symbol} поставлен в очередь`,
        lastEventAtMs: event.eventTimeMs,
        lastError: undefined
      })
    } catch (error) {
      activeTrades.delete(positionKey)
      await protectActiveTrades()
      emit({
        source: event.source,
        message: getErrorMessage(error, `${sourceName}: не удалось сохранить клип`),
        lastEventAtMs: event.eventTimeMs,
        lastError: getErrorMessage(error, `${sourceName}: не удалось сохранить клип`)
      })
    }
  }

  const enqueueEvent = (event: TerminalPositionEvent) => {
    processing = processing.then(() => handleTerminalEvent(event)).catch((error) => {
      emit({
        message: getErrorMessage(error, 'Автозапись терминалов: неизвестная ошибка'),
        lastError: getErrorMessage(error, 'неизвестная ошибка')
      })
    })
  }

  const pollLogProvider = async (provider: LogProviderState): Promise<boolean> => {
    const files = await provider.getLogFiles()
    if (files.length === 0) {
      provider.available = false
      return false
    }

    provider.available = true
    const recentFiles = files.slice(-2)
    if (!provider.initialized) {
      await Promise.all(recentFiles.map(async (filePath) => {
        const fileStat = await stat(filePath)
        provider.cursors.set(filePath, { offset: fileStat.size, remainder: '' })
      }))
      provider.initialized = true
      return true
    }

    for (const filePath of recentFiles) {
      let cursor = provider.cursors.get(filePath)
      if (!cursor) {
        cursor = { offset: 0, remainder: '' }
        provider.cursors.set(filePath, cursor)
      }
      await readNewLines(filePath, cursor, (line) => {
        const event = provider.parseLine(line)
        if (event) enqueueEvent(event)
      })
    }
    return true
  }

  const discoverMetaScalpBaseUrl = async (): Promise<string | undefined> => {
    if (metaScalpBaseUrl) return metaScalpBaseUrl

    const nowMs = Date.now()
    if (nowMs - metaScalpLastProbeAtMs < metaScalpProbeCooldownMs) return undefined
    metaScalpLastProbeAtMs = nowMs

    for (const port of metaScalpPorts) {
      const baseUrl = `http://127.0.0.1:${port}`
      try {
        await fetchJsonWithTimeout(`${baseUrl}/ping`, metaScalpRequestTimeoutMs)
        metaScalpBaseUrl = baseUrl
        return baseUrl
      } catch {
        // MetaScalp can run on any port from the documented range.
      }
    }
    return undefined
  }

  const pollMetaScalpApi = async (): Promise<boolean> => {
    const baseUrl = await discoverMetaScalpBaseUrl()
    if (!baseUrl) {
      metaScalpAvailable = false
      return false
    }

    try {
      const connectionsPayload = await fetchJsonWithTimeout(`${baseUrl}/api/connections`, metaScalpRequestTimeoutMs)
      const connections = toPayloadArray(connectionsPayload, ['connections'])
        .filter((connection): connection is MetaScalpConnection => Boolean(connection) && typeof connection === 'object')
      const currentOpenPositions = new Map<string, TerminalPositionEvent>()
      const nowMs = Date.now()

      for (const connection of connections) {
        const connectionId = normalizeAnyText(getField(connection, ['Id', 'ConnectionId', 'connectionId', 'id']))
        if (!connectionId) continue

        let positionsPayload: unknown
        try {
          positionsPayload = await fetchJsonWithTimeout(
            `${baseUrl}/api/connections/${encodeURIComponent(connectionId)}/positions`,
            metaScalpRequestTimeoutMs
          )
        } catch {
          continue
        }

        for (const position of toPayloadArray(positionsPayload, ['positions'])) {
          const event = parseMetaScalpPositionSnapshot(position, connection, nowMs)
          if (!event) continue

          const positionKey = getPositionKey(event)
          currentOpenPositions.set(positionKey, event)
          if (!metaScalpKnownOpenPositions.has(positionKey)) enqueueEvent(event)
        }
      }

      const diff = diffMetaScalpPositionSnapshots(
        currentOpenPositions,
        metaScalpKnownOpenPositions,
        metaScalpSnapshotInitialized,
        Date.now()
      )
      metaScalpKnownOpenPositions = diff.currentOpenPositions
      metaScalpSnapshotInitialized = diff.initialized
      for (const event of diff.events) enqueueEvent(event)
      metaScalpAvailable = true
      return true
    } catch {
      metaScalpBaseUrl = undefined
      metaScalpAvailable = false
      return false
    }
  }

  const poll = async () => {
    if (polling) return
    polling = true
    try {
      const settings = await getSettings()
      if (settings.tradeSource.mode !== 'terminal-window') return

      await Promise.all(providers.map((provider) => pollLogProvider(provider)))
      await pollMetaScalpApi()
      await processing
      emitAvailabilityStatus()
    } catch (error) {
      emit({
        message: getErrorMessage(error, 'Автозапись терминалов: не удалось прочитать события'),
        lastError: getErrorMessage(error, 'Не удалось прочитать события терминалов')
      })
    } finally {
      polling = false
    }
  }

  return {
    start() {
      if (timer) return
      void poll()
      timer = setInterval(() => void poll(), pollIntervalMs)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = undefined
      activeTrades.clear()
      metaScalpKnownOpenPositions.clear()
      metaScalpSnapshotInitialized = false
      protectSince()
      emit({ active: false, startedAtMs: 0, source: 'multi-terminal', message: 'Автозапись терминалов остановлена' })
    },
    getStatus() {
      return status
    }
  }
}

export const createVatagaTerminalTradeWatcher = createTerminalTradeWatcher
export type VatagaTerminalTradeWatcher = TerminalTradeWatcher
export type VatagaTerminalTradeWatcherInput = TerminalTradeWatcherInput
