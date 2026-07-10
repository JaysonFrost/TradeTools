import type { VpnBypassStatus } from '../../../main/services/proxies/vpnBypassRoutes'

export type ProxyConnectionSummary = {
  title: 'Прокси подключён' | 'Подключаем прокси' | 'Прокси не подключён'
  tone: 'success' | 'info' | 'neutral'
  bypassLabel: string
  bypassTone: 'success' | 'warning' | 'neutral'
}

export const createProxyConnectionSummary = (input: {
  connected: boolean
  connecting?: boolean
  bypassState?: VpnBypassStatus['state']
}): ProxyConnectionSummary => {
  const bypass = input.bypassState === 'protected'
    ? { bypassLabel: 'VPS идёт напрямую', bypassTone: 'success' as const }
    : input.bypassState === 'not-required'
      ? { bypassLabel: 'VPN bypass не требуется', bypassTone: 'neutral' as const }
      : input.bypassState === 'needs-uac'
        ? { bypassLabel: 'Требуется подтверждение Windows', bypassTone: 'warning' as const }
        : input.bypassState === 'attention'
          ? { bypassLabel: 'Требуется внимание', bypassTone: 'warning' as const }
          : { bypassLabel: 'Проверяем маршрут VPS', bypassTone: 'neutral' as const }

  if (input.connecting) return { title: 'Подключаем прокси', tone: 'info', ...bypass }
  if (input.connected) return { title: 'Прокси подключён', tone: 'success', ...bypass }
  return { title: 'Прокси не подключён', tone: 'neutral', ...bypass }
}
