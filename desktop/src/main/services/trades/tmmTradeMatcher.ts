import type { ClosedTrade } from './simulatedTradePipeline'

export type TmmTradeMatcherDeps = {
  fetch?: typeof fetch
}

type TmmTrade = {
  id?: unknown
  symbol?: unknown
  open_time?: unknown
  close_time?: unknown
}

export type TmmTradeInput = Pick<ClosedTrade, 'symbol' | 'entryTimeMs' | 'exitTimeMs'>

const tmmApiUrl = 'https://tradermake.money/api/v2/trades/'
const tmmJournalUrl = 'https://tradermake.money/app2/account/my-trades/'
const matchToleranceMs = 30 * 60_000

const getTmmTradeIdFromJournalUrl = (value: string): number | undefined => {
  try {
    const url = new URL(value)
    if (url.origin !== 'https://tradermake.money') return undefined
    const match = url.pathname.match(/^\/app2\/account\/my-trades\/(\d+)\/?$/)
    const id = Number(match?.[1])
    return Number.isInteger(id) && id > 0 ? id : undefined
  } catch {
    return undefined
  }
}

const toEpochMs = (value: unknown): number | undefined => {
  const time = Number(value)
  if (!Number.isFinite(time) || time <= 0) return undefined
  return time < 100_000_000_000 ? time * 1000 : time
}

const normalizeSymbol = (value: unknown): string => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

const toDate = (timeMs: number): string => new Date(timeMs).toISOString().slice(0, 10)

const getTrades = (body: unknown): TmmTrade[] => {
  if (!body || typeof body !== 'object') return []
  const data = (body as { data?: unknown }).data
  return Array.isArray(data) ? data as TmmTrade[] : []
}

const findMatchedTradeId = (trade: TmmTradeInput, candidates: TmmTrade[], usedIds = new Set<number>()): number | undefined => {
  const targetSymbol = normalizeSymbol(trade.symbol)
  return candidates
    .flatMap((candidate) => {
      const id = Number(candidate.id)
      const entryTimeMs = toEpochMs(candidate.open_time)
      const exitTimeMs = toEpochMs(candidate.close_time)
      if (!Number.isInteger(id) || id <= 0 || usedIds.has(id) || !entryTimeMs || !exitTimeMs || normalizeSymbol(candidate.symbol) !== targetSymbol) return []

      const entryDifference = Math.abs(entryTimeMs - trade.entryTimeMs)
      const exitDifference = Math.abs(exitTimeMs - trade.exitTimeMs)
      return entryDifference <= matchToleranceMs && exitDifference <= matchToleranceMs
        ? [{ id, difference: entryDifference + exitDifference }]
        : []
    })
    .sort((left, right) => left.difference - right.difference)[0]?.id
}

const loadTmmTrades = async (
  input: { apiKey: string, symbol: string, rangeStartMs: number, rangeEndMs: number },
  deps: TmmTradeMatcherDeps
): Promise<TmmTrade[]> => {
  const query = new URL(tmmApiUrl)
  query.searchParams.set('itemsPerPage', '100')
  query.searchParams.set('symbol', input.symbol)
  query.searchParams.set('openBetween', `${toDate(input.rangeStartMs)},${toDate(input.rangeEndMs)}`)
  query.searchParams.set('closeBetween', `${toDate(input.rangeStartMs)},${toDate(input.rangeEndMs)}`)

  try {
    const response = await (deps.fetch ?? fetch)(query, {
      headers: { 'API-KEY': input.apiKey },
      signal: AbortSignal.timeout(10_000)
    })
    return response.ok ? getTrades(await response.json()) : []
  } catch {
    return []
  }
}

export const findTmmTradeUrls = async (
  input: { apiKey: string, trades: TmmTradeInput[] },
  deps: TmmTradeMatcherDeps = {}
): Promise<Array<string | undefined>> => {
  const apiKey = input.apiKey.trim()
  const result = input.trades.map(() => undefined as string | undefined)
  if (!apiKey) return result

  const groups = new Map<string, Array<{ index: number, trade: TmmTradeInput }>>()
  input.trades.forEach((trade, index) => {
    const symbol = normalizeSymbol(trade.symbol)
    if (!symbol) return
    const key = symbol
    groups.set(key, [...(groups.get(key) ?? []), { index, trade }])
  })

  for (const entries of groups.values()) {
    const first = entries[0]?.trade
    if (!first) continue
    const candidates = await loadTmmTrades({
      apiKey,
      symbol: first.symbol,
      rangeStartMs: Math.min(...entries.map(({ trade }) => trade.entryTimeMs)) - 86_400_000 - matchToleranceMs,
      rangeEndMs: Math.max(...entries.map(({ trade }) => trade.exitTimeMs)) + 86_400_000 + matchToleranceMs
    }, deps)

    const usedIds = new Set<number>()
    for (const { index, trade } of [...entries].sort((left, right) => left.trade.entryTimeMs - right.trade.entryTimeMs)) {
      const id = findMatchedTradeId(trade, candidates, usedIds)
      if (id) {
        usedIds.add(id)
        result[index] = `${tmmJournalUrl}${id}`
      }
    }
  }

  return result
}

export const findTmmTradeUrl = async (
  input: { apiKey: string, trade: TmmTradeInput },
  deps: TmmTradeMatcherDeps = {}
): Promise<string | undefined> => {
  return (await findTmmTradeUrls({ apiKey: input.apiKey, trades: [input.trade] }, deps))[0]
}

export const updateTmmTradeVideoPath = async (
  input: { apiKey: string, tradeUrl: string, videoPath: string },
  deps: TmmTradeMatcherDeps = {}
): Promise<boolean> => {
  const apiKey = input.apiKey.trim()
  const videoPath = input.videoPath.trim()
  const tradeId = getTmmTradeIdFromJournalUrl(input.tradeUrl)
  if (!apiKey || !videoPath || !tradeId) return false

  try {
    const response = await (deps.fetch ?? fetch)(`${tmmApiUrl}${tradeId}/update`, {
      method: 'POST',
      headers: {
        'API-KEY': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ video_link: videoPath }),
      signal: AbortSignal.timeout(10_000)
    })
    return response.ok
  } catch {
    return false
  }
}
