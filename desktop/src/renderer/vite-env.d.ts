import type { TradeClipperApi } from '../../preload'

declare module '*.css'

declare global {
  interface Window {
    tradeClipper: TradeClipperApi
  }
}

export {}
