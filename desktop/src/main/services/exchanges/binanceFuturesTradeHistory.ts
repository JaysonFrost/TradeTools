import type { ClosedTrade } from '../trades/simulatedTradePipeline'

export type BinanceFuturesAccountTrade = {
  symbol: string
  id?: number
  orderId?: number
  side: string
  positionSide?: string
  qty: string
  time: number
}

const positionKey = (trade: BinanceFuturesAccountTrade): string => `${trade.symbol}:${trade.positionSide ?? 'BOTH'}`
const isFlat = (amount: number): boolean => Math.abs(amount) < 1e-10
const orderTrade = (a: BinanceFuturesAccountTrade, b: BinanceFuturesAccountTrade): number =>
  a.time - b.time || (a.id ?? 0) - (b.id ?? 0) || (a.orderId ?? 0) - (b.orderId ?? 0)

const signedQuantity = (trade: BinanceFuturesAccountTrade): number => {
  const quantity = Number(trade.qty)
  if (!Number.isFinite(quantity) || quantity <= 0) return 0
  return trade.side.toUpperCase() === 'BUY' ? quantity : -quantity
}

const sideForPosition = (positionSide: string | undefined, amount: number): ClosedTrade['side'] => {
  if (positionSide === 'LONG') return 'LONG'
  if (positionSide === 'SHORT') return 'SHORT'
  return amount > 0 ? 'LONG' : 'SHORT'
}

const buildClosedTrade = (
  symbol: string,
  positionSide: string | undefined,
  entryTimeMs: number,
  exitTimeMs: number,
  amount: number
): ClosedTrade => ({
  id: `binance-futures-${symbol}-${entryTimeMs}`,
  exchange: 'BINANCE',
  marketType: 'FUTURES',
  symbol,
  side: sideForPosition(positionSide, amount),
  status: 'closed',
  entryTimeMs,
  exitTimeMs
})

export const reconstructClosedTradesFromAccountTrades = (trades: BinanceFuturesAccountTrade[]): ClosedTrade[] => {
  const groupedTrades = new Map<string, BinanceFuturesAccountTrade[]>()

  for (const trade of trades) {
    const quantity = Number(trade.qty)
    if (!trade.symbol || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(trade.time)) continue

    const key = positionKey(trade)
    groupedTrades.set(key, [...(groupedTrades.get(key) ?? []), trade])
  }

  const closedTrades: ClosedTrade[] = []

  for (const group of groupedTrades.values()) {
    const sorted = [...group].sort(orderTrade)
    let amount = 0
    let entryTimeMs: number | undefined
    let entryAmount = 0

    for (const trade of sorted) {
      const previousAmount = amount
      amount += signedQuantity(trade)

      if (isFlat(previousAmount) && !isFlat(amount)) {
        entryTimeMs = trade.time
        entryAmount = amount
        continue
      }

      if (!isFlat(previousAmount) && isFlat(amount) && entryTimeMs !== undefined) {
        closedTrades.push(buildClosedTrade(trade.symbol, trade.positionSide, entryTimeMs, trade.time, entryAmount))
        entryTimeMs = undefined
        entryAmount = 0
      }
    }
  }

  return closedTrades.sort((a, b) => a.exitTimeMs - b.exitTimeMs || a.symbol.localeCompare(b.symbol))
}
