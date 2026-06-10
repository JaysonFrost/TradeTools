import { randomUUID } from 'node:crypto'
import type { ClosedTrade } from './simulatedTradePipeline'

export type TerminalTradeRecordingStatus = {
  active: boolean
  startedAtMs: number
  message: string
}

export const createIdleTerminalTradeStatus = (): TerminalTradeRecordingStatus => ({
  active: false,
  startedAtMs: 0,
  message: 'Локальная запись сделки готова'
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

