import { Bell, Clapperboard, Power, RefreshCw, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../main/services/settings/settings'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

export type SystemSettingsPanelProps = {
  settings?: AppSettings
  mode: 'video' | 'proxy'
  onSaved: (settings: AppSettings) => void
}

const inputClass = 'mt-1 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-violet-400/60'

type SystemSettingsDraft = AppSettings['system']

export const SystemSettingsPanel = ({ settings, mode, onSaved }: SystemSettingsPanelProps) => {
  const [launchAtLogin, setLaunchAtLogin] = useState(false)
  const [proxyPaymentNotificationsEnabled, setProxyPaymentNotificationsEnabled] = useState(true)
  const [clipSuccessNotificationsEnabled, setClipSuccessNotificationsEnabled] = useState(true)
  const [paymentReminderDaysBefore, setPaymentReminderDaysBefore] = useState('5')
  const [saving, setSaving] = useState(false)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'success' | 'warning'>('success')

  useEffect(() => {
    if (!settings) return
    setLaunchAtLogin(settings.system.launchAtLogin)
    setProxyPaymentNotificationsEnabled(settings.system.proxyPaymentNotificationsEnabled)
    setClipSuccessNotificationsEnabled(settings.system.clipSuccessNotificationsEnabled)
    setPaymentReminderDaysBefore(String(settings.system.paymentReminderDaysBefore))
  }, [settings])

  const buildDraft = (patch: Partial<SystemSettingsDraft> = {}): SystemSettingsDraft => ({
    launchAtLogin,
    proxyPaymentNotificationsEnabled,
    clipSuccessNotificationsEnabled,
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

  const toggleProxyPaymentNotifications = async (checked: boolean) => {
    const previous = proxyPaymentNotificationsEnabled
    setProxyPaymentNotificationsEnabled(checked)
    const ok = await saveDraft(buildDraft({ proxyPaymentNotificationsEnabled: checked }), checked ? 'Напоминания об оплате включены' : 'Напоминания об оплате выключены')
    if (!ok) setProxyPaymentNotificationsEnabled(previous)
  }

  const toggleClipSuccessNotifications = async (checked: boolean) => {
    const previous = clipSuccessNotificationsEnabled
    setClipSuccessNotificationsEnabled(checked)
    const ok = await saveDraft(buildDraft({ clipSuccessNotificationsEnabled: checked }), checked ? 'Уведомления о клипах включены' : 'Уведомления о клипах выключены')
    if (!ok) setClipSuccessNotificationsEnabled(previous)
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
          <h2 className="m-0 text-xl font-semibold tracking-[-0.03em]">{mode === 'video' ? 'Видео-уведомления' : 'Прокси-уведомления'}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {mode === 'video'
              ? 'Автозапуск TradeTools и системное уведомление, когда запись сделки готова.'
              : 'Автозапуск TradeTools и системные напоминания о сроках оплаты серверов.'}
          </p>
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
        {mode === 'video' ? (
          <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-300 lg:col-span-2">
            <input className="mt-1 h-4 w-4 accent-violet-500" checked={clipSuccessNotificationsEnabled} disabled={saving} onChange={(event) => void toggleClipSuccessNotifications(event.target.checked)} type="checkbox" />
            <span>
              <span className="flex items-center gap-2 font-semibold text-zinc-100"><Clapperboard size={16} />Готовая запись сделки</span>
              <span className="mt-1 block text-xs leading-5 text-zinc-500">После OBS replay и ffmpeg-нарезки появится системное уведомление с переходом в папку файла.</span>
            </span>
          </label>
        ) : (
          <>
            <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-300">
              <input className="mt-1 h-4 w-4 accent-violet-500" checked={proxyPaymentNotificationsEnabled} disabled={saving} onChange={(event) => void toggleProxyPaymentNotifications(event.target.checked)} type="checkbox" />
              <span>
                <span className="flex items-center gap-2 font-semibold text-zinc-100"><Bell size={16} />Оплата серверов</span>
                <span className="mt-1 block text-xs leading-5 text-zinc-500">Напоминания по датам оплаты из хранилища прокси.</span>
              </span>
            </label>
            <label className="text-xs font-medium text-zinc-500">
              Напоминать за дней
              <input className={inputClass} value={paymentReminderDaysBefore} onChange={(event) => setPaymentReminderDaysBefore(event.target.value)} inputMode="numeric" />
            </label>
          </>
        )}
      </div>

      {message && <p className={`mt-4 text-sm ${messageTone === 'warning' ? 'text-amber-300' : 'text-emerald-300'}`}>{message}</p>}
    </Card>
  )
}
