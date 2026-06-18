import { Bell, Network, Pin, Power, RefreshCw, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../main/services/settings/settings'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

export type SystemSettingsPanelProps = {
  settings?: AppSettings
  mode: 'proxy'
  onSaved: (settings: AppSettings) => void
}

const inputClass = 'mt-1 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-violet-400/60'

type SystemSettingsDraft = AppSettings['system']

export const SystemSettingsPanel = ({ settings, onSaved }: SystemSettingsPanelProps) => {
  const [launchAtLogin, setLaunchAtLogin] = useState(false)
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [keepProxyRunningAfterClose, setKeepProxyRunningAfterClose] = useState(false)
  const [proxyPaymentNotificationsEnabled, setProxyPaymentNotificationsEnabled] = useState(true)
  const [paymentReminderDaysBefore, setPaymentReminderDaysBefore] = useState('5')
  const [saving, setSaving] = useState(false)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'success' | 'warning'>('success')

  useEffect(() => {
    if (!settings) return
    setLaunchAtLogin(settings.system.launchAtLogin)
    setAlwaysOnTop(settings.system.alwaysOnTop)
    setKeepProxyRunningAfterClose(settings.system.keepProxyRunningAfterClose)
    setProxyPaymentNotificationsEnabled(settings.system.proxyPaymentNotificationsEnabled)
    setPaymentReminderDaysBefore(String(settings.system.paymentReminderDaysBefore))
  }, [settings])

  const buildDraft = (patch: Partial<SystemSettingsDraft> = {}): SystemSettingsDraft => ({
    launchAtLogin,
    alwaysOnTop,
    keepProxyRunningAfterClose,
    proxyPaymentNotificationsEnabled,
    clipSuccessNotificationsEnabled: settings?.system.clipSuccessNotificationsEnabled ?? true,
    paymentReminderDaysBefore: Number.isFinite(Number(paymentReminderDaysBefore))
      ? Number(paymentReminderDaysBefore)
      : settings?.system.paymentReminderDaysBefore ?? 5,
    ...patch
  })

  const saveDraft = async (draft: SystemSettingsDraft, successMessage = 'Системные настройки сохранены'): Promise<boolean> => {
    setSaving(true)
    setMessage('')
    setMessageTone('success')
    try {
      const updated = await getTradeToolsApi().settings.update({
        system: draft
      })
      onSaved(updated)
      setMessage(successMessage)
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось сохранить системные настройки')
      setMessageTone('warning')
      return false
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    await saveDraft(buildDraft())
  }

  const toggleLaunchAtLogin = async (checked: boolean) => {
    const previous = launchAtLogin
    setLaunchAtLogin(checked)
    const ok = await saveDraft(buildDraft({ launchAtLogin: checked }), checked ? 'Автозапуск включён' : 'Автозапуск выключен')
    if (!ok) setLaunchAtLogin(previous)
  }

  const toggleAlwaysOnTop = async (checked: boolean) => {
    const previous = alwaysOnTop
    setAlwaysOnTop(checked)
    const ok = await saveDraft(buildDraft({ alwaysOnTop: checked }), checked ? 'Окно закреплено поверх остальных' : 'Окно больше не закреплено')
    if (!ok) setAlwaysOnTop(previous)
  }

  const toggleKeepProxyRunningAfterClose = async (checked: boolean) => {
    const previous = keepProxyRunningAfterClose
    setKeepProxyRunningAfterClose(checked)
    const ok = await saveDraft(buildDraft({ keepProxyRunningAfterClose: checked }), checked ? 'Proxy останется включённым после закрытия' : 'Proxy будет выключаться при закрытии')
    if (!ok) setKeepProxyRunningAfterClose(previous)
  }

  const toggleProxyPaymentNotifications = async (checked: boolean) => {
    const previous = proxyPaymentNotificationsEnabled
    setProxyPaymentNotificationsEnabled(checked)
    const ok = await saveDraft(buildDraft({ proxyPaymentNotificationsEnabled: checked }), checked ? 'Напоминания об оплате включены' : 'Напоминания об оплате выключены')
    if (!ok) setProxyPaymentNotificationsEnabled(previous)
  }

  const checkUpdates = async () => {
    setCheckingUpdates(true)
    setMessage('')
    setMessageTone('success')
    try {
      const status = await getTradeToolsApi().updates.check()
      setMessage(status.message)
      setMessageTone(status.status === 'error' ? 'warning' : 'success')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось проверить обновления')
      setMessageTone('warning')
    } finally {
      setCheckingUpdates(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="m-0 text-xl font-semibold tracking-[-0.03em]">Прокси-уведомления</h2>
          <p className="mt-1 text-sm text-zinc-500">Автозапуск TradeTools, закрепление окна и системные напоминания о сроках оплаты серверов.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => void checkUpdates()} disabled={checkingUpdates}>
            <RefreshCw size={17} className={`mr-2 ${checkingUpdates ? 'animate-spin' : ''}`} />{checkingUpdates ? 'Проверяем...' : 'Проверить обновления'}
          </Button>
          <Button onClick={save} disabled={saving}><Save size={17} className="mr-2" />{saving ? 'Сохраняем...' : 'Сохранить'}</Button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr_220px]">
        <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-300">
          <input className="mt-1 h-4 w-4 accent-violet-500" checked={launchAtLogin} disabled={saving} onChange={(event) => void toggleLaunchAtLogin(event.target.checked)} type="checkbox" />
          <span>
            <span className="flex items-center gap-2 font-semibold text-zinc-100"><Power size={16} />Автозапуск</span>
            <span className="mt-1 block text-xs leading-5 text-zinc-500">TradeTools будет стартовать при входе в систему.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-300">
          <input className="mt-1 h-4 w-4 accent-violet-500" checked={alwaysOnTop} disabled={saving} onChange={(event) => void toggleAlwaysOnTop(event.target.checked)} type="checkbox" />
          <span>
            <span className="flex items-center gap-2 font-semibold text-zinc-100"><Pin size={16} />Поверх окон</span>
            <span className="mt-1 block text-xs leading-5 text-zinc-500">Окно TradeTools будет оставаться выше других приложений.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-300">
          <input className="mt-1 h-4 w-4 accent-violet-500" checked={proxyPaymentNotificationsEnabled} disabled={saving} onChange={(event) => void toggleProxyPaymentNotifications(event.target.checked)} type="checkbox" />
          <span>
            <span className="flex items-center gap-2 font-semibold text-zinc-100"><Bell size={16} />Оплата серверов</span>
            <span className="mt-1 block text-xs leading-5 text-zinc-500">Напоминания по датам оплаты из хранилища прокси.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-300">
          <input className="mt-1 h-4 w-4 accent-violet-500" checked={keepProxyRunningAfterClose} disabled={saving} onChange={(event) => void toggleKeepProxyRunningAfterClose(event.target.checked)} type="checkbox" />
          <span>
            <span className="flex items-center gap-2 font-semibold text-zinc-100"><Network size={16} />Оставлять proxy после закрытия</span>
            <span className="mt-1 block text-xs leading-5 text-zinc-500">Следующий запуск переиспользует текущий локальный Xray вместо нового процесса.</span>
          </span>
        </label>
        <label className="text-xs font-medium text-zinc-500">
          Напоминать за дней
          <input className={inputClass} value={paymentReminderDaysBefore} onChange={(event) => setPaymentReminderDaysBefore(event.target.value)} inputMode="numeric" />
        </label>
      </div>

      {message && <p className={`mt-4 text-sm ${messageTone === 'warning' ? 'text-amber-300' : 'text-emerald-300'}`}>{message}</p>}
    </Card>
  )
}
