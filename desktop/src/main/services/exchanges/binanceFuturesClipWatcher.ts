import type { ClosedTrade } from '../trades/simulatedTradePipeline'
import type { ClipQueueItem } from '../trades/tradeClipPipeline'
import { createBinanceFuturesTradeState, type BinanceFuturesPosition } from './binanceFuturesTradeState'

export type BinanceFuturesClipWatcherDeps = {
  listPositions: () => Promise<BinanceFuturesPosition[]>
  listRecentClosedTrades?: (input: { startTimeMs: number, endTimeMs: number }) => Promise<ClosedTrade[]>
  getHistoryLookbackMs?: () => Promise<number>
  createClipForClosedTrade: (trade: ClosedTrade) => Promise<ClipQueueItem | void>
  now?: () => number
}

export type BinanceFuturesClipWatcher = {
  pollOnce: () => Promise<ClosedTrade[]>
}

export type BinanceFuturesWatchStatus = {
  configured: boolean
  running: boolean
  message: string
  lastPollAtMs?: number
  lastClosedTradeAtMs?: number
  lastError?: string
}

export const createBinanceFuturesClipWatcher = (deps: BinanceFuturesClipWatcherDeps): BinanceFuturesClipWatcher => {
  const state = createBinanceFuturesTradeState()
  const now = deps.now ?? (() => Date.now())
  const createdTradeIds = new Set<string>()
  const renderingTradeIds = new Set<string>()

  const uniqueNewTrades = (trades: ClosedTrade[]): ClosedTrade[] => {
    const seen = new Set<string>()
    return trades.filter((trade) => {
      if (seen.has(trade.id) || createdTradeIds.has(trade.id) || renderingTradeIds.has(trade.id)) return false
      seen.add(trade.id)
      return true
    })
  }

  return {
    async pollOnce() {
      const observedAtMs = now()
      const positions = await deps.listPositions()
      const closedTradesFromPositions = state.applyPositions(positions, observedAtMs)
      const historyLookbackMs = deps.getHistoryLookbackMs ? await deps.getHistoryLookbackMs() : 30 * 60_000
      const closedTradesFromHistory = deps.listRecentClosedTrades
        ? await deps.listRecentClosedTrades({
          startTimeMs: observedAtMs - historyLookbackMs,
          endTimeMs: observedAtMs
        })
        : []
      const closedTrades = uniqueNewTrades([...closedTradesFromPositions, ...closedTradesFromHistory])
      for (const trade of closedTrades) renderingTradeIds.add(trade.id)

      for (const trade of closedTrades) {
        try {
          await deps.createClipForClosedTrade(trade)
          createdTradeIds.add(trade.id)
        } finally {
          renderingTradeIds.delete(trade.id)
        }
      }
      return closedTrades
    }
  }
}
