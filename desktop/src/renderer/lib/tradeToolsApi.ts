import type { TradeToolsApi } from '../../preload'

export const electronApiUnavailableMessage = 'Electron API недоступен. Откройте приложение через npm run dev / Electron, а не напрямую в браузере, и после изменений main/preload полностью перезапустите dev-сервер.'

export const getTradeToolsApi = (): TradeToolsApi => {
  if (!window.tradeTools) throw new Error(electronApiUnavailableMessage)
  return window.tradeTools
}
