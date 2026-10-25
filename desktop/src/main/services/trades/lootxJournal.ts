import { join } from 'node:path'
import type { TerminalPositionEvent } from './terminalTradeRecorder'
import {
  getField,
  isNearlyZero,
  normalizeAnyText,
  normalizeExchangeName,
  normalizeSideFromSize,
  normalizeTerminalSymbol,
  normalizeText,
  parseMaybeTime,
  parseNumericValue
} from './terminalEventParsing'

export type LootxJournalFill = {
  id: string
  positionId: string
  exchange: string
  symbol: string
  eventTimeMs: number
  signedQuantity: number
  sortIndex: number
}

export type LootxPositionState = {
  positionId: string
  exchange: string
  symbol: string
  side: string
  size: number
  entryTimeMs: number
  latestEventAtMs: number
}

export type LootxJournalSnapshot = {
  resetTimestampMs: number
  fills: LootxJournalFill[]
  flatSinceMsByPosition: Map<string, number>
}

export type LootxJournalCursor = {
  resetTimestampMs: number
  seenFillIds: Set<string>
  positions: Map<string, LootxPositionState>
  latestEventAtMsByPosition: Map<string, number>
}

export type LootxJournalAdvance = {
  cursor: LootxJournalCursor
  events: TerminalPositionEvent[]
  openPositions: LootxPositionState[]
  resetDetected: boolean
}

const normalizeLootxExchangeName = (exchangeId: string, connectionTag: string): string => {
  const exchange = normalizeExchangeName(exchangeId, 'LOOTX')
  return /:F$/i.test(connectionTag) && exchange.endsWith('F')
    ? exchange.slice(0, -1) || 'LOOTX'
    : exchange
}

const getLootxPositionId = (connectionTag: string, exchangeId: string, symbol: string): string => (
  `${connectionTag || 'CONNECTION'}:${exchangeId}:${symbol}`.toUpperCase()
)

const parseLootxFlatSpans = (flatSpans: unknown): Map<string, number> => {
  const flatSinceMsByPosition = new Map<string, number>()
  if (!Array.isArray(flatSpans)) return flatSinceMsByPosition

  for (const span of flatSpans) {
    if (!span || typeof span !== 'object') continue
    if (parseNumericValue(getField(span, ['ToMs'])) > 0) continue

    const exchangeId = normalizeAnyText(getField(span, ['ExchangeId']))
    const symbol = normalizeTerminalSymbol(getField(span, ['Symbol']), '')
    const fromMs = parseMaybeTime(getField(span, ['FromMs']))
    if (!exchangeId || !symbol || !fromMs) continue

    const positionId = getLootxPositionId(normalizeAnyText(getField(span, ['ConnectionTag'])), exchangeId, symbol)
    flatSinceMsByPosition.set(positionId, Math.max(fromMs, flatSinceMsByPosition.get(positionId) ?? 0))
  }
  return flatSinceMsByPosition
}

export const parseLootxJournalSnapshot = (text: string): LootxJournalSnapshot | undefined => {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return undefined
  }

  if (!payload || typeof payload !== 'object') return undefined
  const resetTimestampMs = parseNumericValue(getField(payload, ['ResetTimestampMs']))
  const trades = getField(payload, ['Trades'])
  if (!Number.isFinite(resetTimestampMs) || resetTimestampMs < 0 || !Array.isArray(trades)) return undefined

  const fills: LootxJournalFill[] = []
  const seenFillIds = new Set<string>()
  const fallbackOccurrences = new Map<string, number>()

  for (const [sortIndex, trade] of trades.entries()) {
    if (!trade || typeof trade !== 'object') continue

    const execId = normalizeAnyText(getField(trade, ['ExecId']))
    if (execId.toUpperCase() === 'SYNTHETIC_SEED') continue

    const instrument = getField(trade, ['Instrument'])
    const exchangeId = normalizeAnyText(getField(instrument, ['ExchangeId']))
    const symbol = normalizeTerminalSymbol(getField(instrument, ['Symbol']), '')
    const connectionTag = normalizeAnyText(getField(trade, ['ConnectionTag']))
    const eventTimeMs = parseMaybeTime(getField(trade, ['TimestampMs']))
    const quantityRaw = parseNumericValue(getField(trade, ['QuantityRaw', 'Quantity']))
    const quantityScaleValue = parseNumericValue(getField(trade, ['QuantityScale']))
    const quantityScale = Number.isFinite(quantityScaleValue) && quantityScaleValue > 0 ? quantityScaleValue : 1
    const quantity = Math.abs(quantityRaw / quantityScale)
    const side = normalizeAnyText(getField(trade, ['Side'])).toLowerCase()
    const direction = ['bid', 'buy', 'long'].includes(side)
      ? 1
      : ['ask', 'sell', 'short'].includes(side)
        ? -1
        : 0
    if (!exchangeId || !symbol || !eventTimeMs || !Number.isFinite(quantity) || isNearlyZero(quantity) || !direction) continue

    const positionId = getLootxPositionId(connectionTag, exchangeId, symbol)
    const tradeId = normalizeAnyText(getField(trade, ['TradeId']))
    const usableExecId = execId && execId !== '0' ? execId : ''
    const usableTradeId = tradeId && tradeId !== '0' ? tradeId : ''
    let id = usableExecId
      ? `${positionId}|exec:${usableExecId}`
      : usableTradeId
        ? `${positionId}|trade:${usableTradeId}`
        : ''

    if (!id) {
      const orderId = normalizeAnyText(getField(trade, ['OrderId']))
      const cumulativeQuantity = normalizeAnyText(getField(trade, ['CumulativeFilledQtyRaw']))
      const fallbackBase = `${positionId}|fill:${eventTimeMs}:${orderId}:${side}:${quantityRaw}:${quantityScale}:${cumulativeQuantity}`
      const occurrence = fallbackOccurrences.get(fallbackBase) ?? 0
      fallbackOccurrences.set(fallbackBase, occurrence + 1)
      id = `${fallbackBase}:${occurrence}`
    }

    const normalizedId = id.toUpperCase()
    if (seenFillIds.has(normalizedId)) continue
    seenFillIds.add(normalizedId)
    fills.push({
      id: normalizedId,
      positionId,
      exchange: normalizeLootxExchangeName(exchangeId, connectionTag),
      symbol,
      eventTimeMs,
      signedQuantity: direction * quantity,
      sortIndex
    })
  }

  fills.sort((left, right) => (
    left.eventTimeMs - right.eventTimeMs
    || left.sortIndex - right.sortIndex
    || left.id.localeCompare(right.id)
  ))
  return { resetTimestampMs, fills, flatSinceMsByPosition: parseLootxFlatSpans(getField(payload, ['FlatSpans'])) }
}

const toLootxEvent = (state: LootxPositionState, eventTimeMs: number): TerminalPositionEvent => ({
  source: 'lootx',
  positionId: state.positionId,
  exchange: state.exchange,
  symbol: state.symbol,
  side: state.side,
  isClosed: isNearlyZero(state.size),
  eventTimeMs,
  size: state.size
})

const applyLootxFill = (
  positions: Map<string, LootxPositionState>,
  latestEventAtMsByPosition: Map<string, number>,
  fill: LootxJournalFill
): TerminalPositionEvent => {
  const previous = positions.get(fill.positionId)
  const previousSize = previous?.size ?? 0
  const rawNextSize = previousSize + fill.signedQuantity
  const nextSize = isNearlyZero(rawNextSize) ? 0 : rawNextSize
  const reversed = !isNearlyZero(previousSize)
    && !isNearlyZero(nextSize)
    && Math.sign(previousSize) !== Math.sign(nextSize)
  const entryTimeMs = isNearlyZero(previousSize) || reversed
    ? fill.eventTimeMs
    : previous?.entryTimeMs ?? fill.eventTimeMs
  const side = isNearlyZero(nextSize)
    ? previous?.side ?? normalizeSideFromSize(fill.signedQuantity)
    : normalizeSideFromSize(nextSize)
  const state: LootxPositionState = {
    positionId: fill.positionId,
    exchange: fill.exchange,
    symbol: fill.symbol,
    side,
    size: nextSize,
    entryTimeMs,
    latestEventAtMs: fill.eventTimeMs
  }
  positions.set(fill.positionId, state)
  latestEventAtMsByPosition.set(fill.positionId, fill.eventTimeMs)
  return toLootxEvent(state, fill.eventTimeMs)
}

const applyLootxFlatSpans = (
  positions: Map<string, LootxPositionState>,
  latestEventAtMsByPosition: Map<string, number>,
  flatSinceMsByPosition: Map<string, number>
): TerminalPositionEvent[] => {
  const closes: TerminalPositionEvent[] = []
  for (const [positionId, flatSinceMs] of flatSinceMsByPosition) {
    const position = positions.get(positionId)
    if (!position || isNearlyZero(position.size) || flatSinceMs < position.latestEventAtMs) continue

    const state = { ...position, size: 0, latestEventAtMs: flatSinceMs }
    positions.set(positionId, state)
    latestEventAtMsByPosition.set(positionId, flatSinceMs)
    closes.push(toLootxEvent(state, flatSinceMs))
  }
  return closes
}

const getOpenLootxPositions = (positions: Map<string, LootxPositionState>): LootxPositionState[] => (
  [...positions.values()].filter((position) => !isNearlyZero(position.size))
)

const wasLootxPositionOpen = (positions: Map<string, LootxPositionState>, positionId: string): boolean => {
  const position = positions.get(positionId)
  return Boolean(position && !isNearlyZero(position.size))
}

export const advanceLootxJournalSnapshot = (
  snapshot: LootxJournalSnapshot,
  previous?: LootxJournalCursor
): LootxJournalAdvance => {
  const snapshotFillIds = new Set(snapshot.fills.map((fill) => fill.id))
  const previousPositions = previous?.positions ?? new Map<string, LootxPositionState>()
  const positions = new Map([...previousPositions].map(([positionId, position]) => [positionId, { ...position }]))
  const latestEventAtMsByPosition = new Map(previous?.latestEventAtMsByPosition)
  const resetTimestampChanged = Boolean(previous) && snapshot.resetTimestampMs !== previous?.resetTimestampMs
  const snapshotTruncated = [...previous?.seenFillIds ?? []].some((fillId) => !snapshotFillIds.has(fillId))
  const resetDetected = resetTimestampChanged || snapshotTruncated
  const events: TerminalPositionEvent[] = []

  for (const fill of snapshot.fills) {
    if (previous?.seenFillIds.has(fill.id)) continue
    const latestEventAtMs = latestEventAtMsByPosition.get(fill.positionId)
    if (previous && latestEventAtMs !== undefined && fill.eventTimeMs < latestEventAtMs) continue
    events.push(applyLootxFill(positions, latestEventAtMsByPosition, fill))
  }

  for (const close of applyLootxFlatSpans(positions, latestEventAtMsByPosition, snapshot.flatSinceMsByPosition)) {
    if (wasLootxPositionOpen(previousPositions, close.positionId)) {
      events.push(close)
      continue
    }
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index].positionId === close.positionId) events.splice(index, 1)
    }
  }

  const seenFillIds = !previous || resetTimestampChanged
    ? snapshotFillIds
    : new Set([...previous.seenFillIds, ...snapshotFillIds])
  const cursor: LootxJournalCursor = {
    resetTimestampMs: snapshot.resetTimestampMs,
    seenFillIds,
    positions,
    latestEventAtMsByPosition
  }
  return {
    cursor,
    events: previous ? events : [],
    openPositions: getOpenLootxPositions(positions),
    resetDetected
  }
}

export const getLootxJournalPath = (env: NodeJS.ProcessEnv): string | undefined => {
  const appData = normalizeText(env.APPDATA)
  return appData ? join(appData, 'TradingTerminal', 'journal.json') : undefined
}
