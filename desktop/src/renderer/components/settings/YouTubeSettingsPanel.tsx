import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../main/services/settings/settings'
import { getTradeCutApi } from '../../lib/tradeCutApi'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

export type YouTubeSettingsPanelProps = {
  settings?: AppSettings
  onSaved: (settings: AppSettings) => void
}

const inputClass = 'mt-1 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-red-400/70'

export const YouTubeSettingsPanel = ({ settings, onSaved }: YouTubeSettingsPanelProps) => {
  const [privacyStatus, setPrivacyStatus] = useState<AppSettings['youtube']['defaultPrivacyStatus']>('private')
  const [saving, setSaving] = useState(false)
  const [authorizing, setAuthorizing] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!settings) return
    setPrivacyStatus(settings.youtube.defaultPrivacyStatus)
  }, [settings])

  const save = async () => {
    setSaving(true)
    setMessage('')
    try {
      const updated = await getTradeCutApi().settings.update({
        youtube: {
          defaultPrivacyStatus: privacyStatus
        }
      })
      onSaved(updated)
      setMessage('YouTube настройки сохранены')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось сохранить YouTube настройки')
    } finally {
      setSaving(false)
    }
  }

  const authorize = async () => {
    setAuthorizing(true)
    setMessage('')
    try {
      const updated = await getTradeCutApi().youtube.authorizeGoogle()
      onSaved(updated)
      setMessage('Google авторизация выполнена')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось авторизоваться в Google')
    } finally {
      setAuthorizing(false)
    }
  }

  const configured = settings?.youtube.oauthClientConfigured
  const authorized = settings?.youtube.authorized

  return (
    <Card className="border-red-500/25 bg-red-500/10" id="youtube-settings">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="m-0 text-xl font-semibold tracking-[-0.03em]">YouTube экспорт</h2>
          <p className="mt-1 text-sm text-zinc-400">
            {authorized
              ? 'Google авторизация сохранена. Клипы можно загружать на YouTube из очереди.'
              : configured
                ? 'Нажмите авторизацию Google, чтобы включить экспорт клипов на YouTube.'
                : 'Google OAuth не настроен в этой сборке приложения.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={authorize} disabled={authorizing}>{authorizing ? 'Открываем Google...' : 'Авторизоваться в Google'}</Button>
          <Button className="bg-red-600 shadow-[0_0_32px_rgba(220,38,38,0.28)] hover:bg-red-500" onClick={save} disabled={saving}>{saving ? 'Сохраняем...' : 'Сохранить YouTube'}</Button>
        </div>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-[minmax(220px,320px)]">
        <label className="text-xs font-medium text-zinc-500">
          Видимость
          <select className={inputClass} value={privacyStatus} onChange={(event) => setPrivacyStatus(event.target.value as AppSettings['youtube']['defaultPrivacyStatus'])}>
            <option value="private">Private</option>
            <option value="unlisted">Unlisted</option>
            <option value="public">Public</option>
          </select>
        </label>
      </div>
      {message && <p className="mt-4 text-sm text-red-100">{message}</p>}
    </Card>
  )
}
