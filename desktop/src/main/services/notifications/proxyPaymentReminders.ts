import type { AppSettings, ProxyRecord } from '../settings/settings'

export type ProxyPaymentReminder = {
  proxy: ProxyRecord
  key: string
  title: string
  body: string
}

const dayMs = 24 * 60 * 60 * 1000

const pad = (value: number): string => String(value).padStart(2, '0')

const localDateKey = (date: Date): string => [
  date.getFullYear(),
  pad(date.getMonth() + 1),
  pad(date.getDate())
].join('-')

const startOfLocalDayMs = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

const daysInMonth = (year: number, monthIndex: number): number => new Date(year, monthIndex + 1, 0).getDate()

const monthlyDueAtMs = (year: number, monthIndex: number, paymentDueDay: number): number => {
  return new Date(year, monthIndex, Math.min(paymentDueDay, daysInMonth(year, monthIndex))).getTime()
}

const nextMonthlyDueAtMs = (paymentDueDay: number, now: Date): number | undefined => {
  if (!Number.isFinite(paymentDueDay) || paymentDueDay < 1 || paymentDueDay > 31) return undefined

  const todayMs = startOfLocalDayMs(now)
  const thisMonthDueMs = monthlyDueAtMs(now.getFullYear(), now.getMonth(), paymentDueDay)
  if (thisMonthDueMs >= todayMs) return thisMonthDueMs

  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return monthlyDueAtMs(nextMonth.getFullYear(), nextMonth.getMonth(), paymentDueDay)
}

const dueText = (daysUntilDue: number): string => {
  if (daysUntilDue === 0) return 'сегодня'
  return `через ${daysUntilDue} дн.`
}

const proxyDisplayName = (proxy: ProxyRecord): string => proxy.name || proxy.server || 'Прокси'

export const listProxyPaymentReminders = (settings: AppSettings, nowMs = Date.now()): ProxyPaymentReminder[] => {
  if (!settings.system.proxyPaymentNotificationsEnabled) return []

  const now = new Date(nowMs)
  const todayMs = startOfLocalDayMs(now)
  const todayKey = localDateKey(now)
  const reminderDaysBefore = settings.system.paymentReminderDaysBefore

  return settings.proxies.flatMap((proxy) => {
    const dueAtMs = nextMonthlyDueAtMs(proxy.paymentDueDay, now)
    if (!dueAtMs) return []

    const daysUntilDue = Math.ceil((dueAtMs - todayMs) / dayMs)
    if (daysUntilDue > reminderDaysBefore) return []

    const key = `${proxy.id}:${proxy.paymentDueDay}:${todayKey}`
    if (proxy.lastPaymentReminderKey === key) return []

    return [{
      proxy,
      key,
      title: 'Срок оплаты прокси',
      body: `${proxyDisplayName(proxy)}: оплата ${dueText(daysUntilDue)}`
    }]
  })
}
