import type { TradeCutApi } from '../../preload'

declare module '*.css'

declare global {
  interface Window {
    tradeCut: TradeCutApi
  }
}

export {}
