import type { ClosedTrade } from '../trades/simulatedTradePipeline'

export type BinanceFuturesPosition = {
  symbol: string
  positionAmt: string
  updateTime?: number
}

export type OpenBinanceFuturesTrade = Omit<ClosedTrade, 'status' | 'exitTimeMs'> & {
  status: 'open'
}

export type BinanceFuturesTradeState = {
  applyPositions: (positions: BinanceFuturesPosition[], observedAtMs: number) => ClosedTrade[]
  getActiveTrades: () => OpenBinanceFuturesTrade[]
}

const tradeId = (symbol: string, entryTimeMs: number): string => `binance-futures-${symbol}-${entryTimeMs}`

const sideForAmount = (amount: number): ClosedTrade['side'] => amount > 0 ? 'LONG' : 'SHORT'
const positionTime = (position: BinanceFuturesPosition, fallbackMs: number): number =>
  Number.isFinite(position.updateTime) && (position.updateTime ?? 0) > 0 ? position.updateTime as number : fallbackMs

const createOpenTrade = (symbol: string, amount: number, entryTimeMs: number): OpenBinanceFuturesTrade => ({
  id: tradeId(symbol, entryTimeMs),
  exchange: 'BINANCE',
  marketType: 'FUTURES',
  symbol,
  side: sideForAmount(amount),
  status: 'open',
  entryTimeMs
})

const closeTrade = (trade: OpenBinanceFuturesTrade, exitTimeMs: number): ClosedTrade => ({
  ...trade,
  status: 'closed',
  exitTimeMs
})

export const createBinanceFuturesTradeState = (): BinanceFuturesTradeState => {
  const activeTrades = new Map<string, OpenBinanceFuturesTrade>()

  return {
    applyPositions(positions, observedAtMs) {
      const closedTrades: ClosedTrade[] = []
      const observedSymbols = new Set<string>()

      for (const position of positions) {
        observedSymbols.add(position.symbol)
        const amount = Number(position.positionAmt)
        const activeTrade = activeTrades.get(position.symbol)

        if (amount === 0) {
          if (activeTrade) {
            const exitTimeMs = Math.max(positionTime(position, observedAtMs), activeTrade.entryTimeMs + 1)
            closedTrades.push(closeTrade(activeTrade, exitTimeMs))
            activeTrades.delete(position.symbol)
          }
          continue
        }

        const nextSide = sideForAmount(amount)
        if (!activeTrade) {
          activeTrades.set(position.symbol, createOpenTrade(position.symbol, amount, positionTime(position, observedAtMs)))
          continue
        }

        if (activeTrade.side !== nextSide) {
          const flipTimeMs = Math.max(positionTime(position, observedAtMs), activeTrade.entryTimeMs + 1)
          closedTrades.push(closeTrade(activeTrade, flipTimeMs))
          activeTrades.set(position.symbol, createOpenTrade(position.symbol, amount, flipTimeMs))
        }
      }

      for (const [symbol, activeTrade] of activeTrades) {
        if (observedSymbols.has(symbol)) continue

        closedTrades.push(closeTrade(activeTrade, observedAtMs))
        activeTrades.delete(symbol)
      }

      return closedTrades
    },
    getActiveTrades() {
      return [...activeTrades.values()].sort((a, b) => a.entryTimeMs - b.entryTimeMs || a.symbol.localeCompare(b.symbol))
    }
  }
}
