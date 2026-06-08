import type { TradeToolsApi } from '../../preload'

declare module '*.css'

declare global {
  interface Window {
    tradeTools: TradeToolsApi
  }
}

export {}
