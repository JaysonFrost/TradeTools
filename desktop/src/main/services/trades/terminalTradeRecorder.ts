import { randomUUID } from 'node:crypto'
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppSettings } from '../settings/settings'
import type { ClosedTrade } from './simulatedTradePipeline'
import type { ClipQueueItem } from './tradeClipPipeline'

export type TerminalTradeRecordingStatus = {
  active: boolean
  startedAtMs: number
  message: string
  source: 'vataga' | 'manual'
  activeTradeCount: number
  lastEventAtMs?: number
  lastError?: string
}

export type OpenTerminalTrade = Omit<ClosedTrade, 'status' | 'exitTimeMs'> & {
  status: 'open'
  positionId: string
}

export type VatagaPositionEvent = {
  positionId: string
  exchange: string
  symbol: string
  side: string
  isClosed: boolean
  eventTimeMs: number
}

export type VatagaTerminalTradeWatcher = {
  start: () => void
  stop: () => void
  getStatus: () => TerminalTradeRecordingStatus
}

export type VatagaTerminalTradeWatcherInput = {
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

const defaultPollIntervalMs = 1_000
const readChunkSize = 128 * 1024

const normalizeText = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

const parseVatagaTime = (value: unknown): number => {
  const text = normalizeText(value)
  if (!text) return 0
  const normalized = /(?:z|[+-]\d\d:?\d\d)$/i.test(text) ? text : `${text}Z`
  const time = Date.parse(normalized)
  return Number.isFinite(time) && time > 0 ? time : 0
}

const normalizeVatagaSymbol = (value: unknown): string => {
  const text = normalizeText(value)
  const symbol = text.includes('/') ? text.split('/').at(-1) ?? text : text
  return symbol.toUpperCase().replace(/[^A-Z0-9]+/g, '') || 'TERMINAL'
}

const normalizeVatagaExchange = (value: unknown, symbolTitle: unknown): string => {
  const exchange = normalizeText(value)
  if (exchange) return exchange.toUpperCase()

  const title = normalizeText(symbolTitle)
  return (title.includes('/') ? title.split('/')[0] : title || 'VATAGA').toUpperCase()
}

const normalizeVatagaSide = (quantity: unknown, tradeSide: unknown): string => {
  const size = Number(quantity)
  if (Number.isFinite(size) && size !== 0) return size > 0 ? 'LONG' : 'SHORT'

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
    positionId,
    exchange: normalizeVatagaExchange(payload.ExchangeType, payload.SymbolTitle),
    symbol: normalizeVatagaSymbol(payload.SymbolTitle),
    side: normalizeVatagaSide(payload.PositionQuantity, payload.TradeSide),
    isClosed: payload.IsClosed === true,
    eventTimeMs
  }
}

export const createIdleTerminalTradeStatus = (): TerminalTradeRecordingStatus => ({
  active: false,
  startedAtMs: 0,
  message: 'Автоматически ждём сделки Vataga',
  source: 'vataga',
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

const getVatagaLogsDir = (env: NodeJS.ProcessEnv): string | undefined => {
  const appData = normalizeText(env.APPDATA)
  return appData ? join(appData, 'Vataga', 'Vataga.terminal', 'Logs') : undefined
}

const listVatagaLogFiles = async (logsDir: string): Promise<string[]> => {
  const entries = await readdir(logsDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && /^log-\d{8}\.clef$/i.test(entry.name))
    .map((entry) => join(logsDir, entry.name))
    .sort()
}

const getErrorCode = (error: unknown): string => (
  typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
)

export const createVatagaTerminalTradeWatcher = ({
  getSettings,
  ensureVideoRecordingReady,
  protectSince,
  createClipForClosedTrade,
  onStatusChange,
  env = process.env,
  pollIntervalMs = defaultPollIntervalMs
}: VatagaTerminalTradeWatcherInput): VatagaTerminalTradeWatcher => {
  const logsDir = getVatagaLogsDir(env)
  const cursors = new Map<string, LogCursor>()
  const activeTrades = new Map<string, OpenTerminalTrade>()
  const renderedTradeIds = new Set<string>()
  let initialized = false
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

  const protectActiveTrades = async () => {
    if (activeTrades.size === 0) {
      protectSince()
      return
    }

    const settings = await getSettings()
    const earliestEntryTimeMs = Math.min(...[...activeTrades.values()].map((trade) => trade.entryTimeMs))
    protectSince(earliestEntryTimeMs - settings.clip.paddingBeforeSeconds * 1000 - 5_000)
  }

  const handleVatagaEvent = async (event: VatagaPositionEvent) => {
    if (!event.isClosed) {
      if (!activeTrades.has(event.positionId)) {
        activeTrades.set(event.positionId, {
          id: `vataga-${event.positionId}`,
          positionId: event.positionId,
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
        message: `Vataga: записываем ${event.symbol} ${event.side}`,
        lastEventAtMs: event.eventTimeMs,
        lastError: undefined
      })
      return
    }

    const openTrade = activeTrades.get(event.positionId)
    if (!openTrade) {
      emit({
        message: `Vataga: закрытие ${event.symbol} увидели, но вход был до запуска TradeTools`,
        lastEventAtMs: event.eventTimeMs
      })
      return
    }

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
      message: `Vataga: ${closedTrade.symbol} закрыта, сохраняем клип`,
      lastEventAtMs: event.eventTimeMs,
      lastError: undefined
    })

    try {
      await protectActiveTrades()
      await createClipForClosedTrade(closedTrade)
      activeTrades.delete(event.positionId)
      await protectActiveTrades()
      emit({
        message: `Vataga: клип ${closedTrade.symbol} сохранён`,
        lastEventAtMs: event.eventTimeMs,
        lastError: undefined
      })
    } catch (error) {
      activeTrades.delete(event.positionId)
      await protectActiveTrades()
      emit({
        message: error instanceof Error ? error.message : 'Vataga: не удалось сохранить клип',
        lastEventAtMs: event.eventTimeMs,
        lastError: error instanceof Error ? error.message : 'Не удалось сохранить клип Vataga'
      })
    }
  }

  const enqueueLine = (line: string) => {
    const event = parseVatagaPositionEvent(line)
    if (!event) return

    processing = processing.then(() => handleVatagaEvent(event)).catch((error) => {
      emit({
        message: error instanceof Error ? error.message : 'Vataga watcher: неизвестная ошибка',
        lastError: error instanceof Error ? error.message : 'неизвестная ошибка'
      })
    })
  }

  const readNewLines = async (filePath: string, cursor: LogCursor) => {
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

  const poll = async () => {
    if (!logsDir || polling) return
    polling = true
    try {
      const settings = await getSettings()
      if (settings.tradeSource.mode !== 'terminal-window') return

      const files = await listVatagaLogFiles(logsDir)
      if (files.length === 0) {
        emit({ message: 'Vataga: логи не найдены. Откройте терминал Vataga.', lastError: undefined })
        return
      }

      const recentFiles = files.slice(-2)
      if (!initialized) {
        await Promise.all(recentFiles.map(async (filePath) => {
          const fileStat = await stat(filePath)
          cursors.set(filePath, { offset: fileStat.size, remainder: '' })
        }))
        initialized = true
        emit({ message: 'Vataga: автоматическая запись сделок включена', lastError: undefined })
        return
      }

      for (const filePath of recentFiles) {
        let cursor = cursors.get(filePath)
        if (!cursor) {
          cursor = { offset: 0, remainder: '' }
          cursors.set(filePath, cursor)
        }
        await readNewLines(filePath, cursor)
      }
      await processing
    } catch (error) {
      const code = getErrorCode(error)
      if (code === 'ENOENT') {
        emit({
          message: 'Vataga: логи не найдены. Откройте терминал Vataga.',
          lastError: undefined
        })
        return
      }

      emit({
        message: error instanceof Error ? error.message : 'Vataga: не удалось прочитать логи',
        lastError: error instanceof Error ? error.message : 'Не удалось прочитать логи Vataga'
      })
    } finally {
      polling = false
    }
  }

  return {
    start() {
      if (timer) return
      if (!logsDir) {
        emit({ message: 'Vataga: не найден APPDATA для поиска логов', lastError: 'APPDATA не найден' })
        return
      }

      void poll()
      timer = setInterval(() => void poll(), pollIntervalMs)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = undefined
      activeTrades.clear()
      protectSince()
      emit({ active: false, startedAtMs: 0, message: 'Vataga watcher остановлен' })
    },
    getStatus() {
      return status
    }
  }
}
