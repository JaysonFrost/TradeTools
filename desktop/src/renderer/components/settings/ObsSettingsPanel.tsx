import { FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../main/services/settings/settings'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

export type ObsSettingsPanelProps = {
  settings?: AppSettings
  onSaved: (settings: AppSettings) => void
}

const inputClass = 'mt-1 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-violet-400/60'

export const ObsSettingsPanel = ({ settings, onSaved }: ObsSettingsPanelProps) => {
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('4455')
  const [paddingBefore, setPaddingBefore] = useState('2')
  const [paddingAfter, setPaddingAfter] = useState('2')
  const [replaySourceDir, setReplaySourceDir] = useState('')
  const [outputDir, setOutputDir] = useState('')
  const [obsPassword, setObsPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!settings) return
    setHost(settings.obs.host)
    setPort(String(settings.obs.port))
    setPaddingBefore(String(settings.clip.paddingBeforeSeconds))
    setPaddingAfter(String(settings.clip.paddingAfterSeconds))
    setReplaySourceDir(settings.clip.replaySourceDir)
    setOutputDir(settings.clip.outputDir)
  }, [settings])

  const save = async () => {
    setSaving(true)
    setMessage('')
    try {
      const api = getTradeToolsApi()
      const updated = await api.settings.update({
        obsPassword: obsPassword.trim() || undefined,
        obs: {
          host,
          port: Number(port)
        },
        clip: {
          paddingBeforeSeconds: Number(paddingBefore),
          paddingAfterSeconds: Number(paddingAfter),
          replaySourceDir,
          outputDir
        }
      })
      onSaved(updated)
      setObsPassword('')
      setMessage('Настройки сохранены')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось сохранить настройки')
    } finally {
      setSaving(false)
    }
  }

  const selectDirectory = async (currentPath: string, setValue: (value: string) => void) => {
    try {
      const api = getTradeToolsApi()
      const selectedPath = await api.dialog.selectDirectory(currentPath.trim() || undefined)
      if (!selectedPath) return
      setValue(selectedPath)
      setMessage('Папка выбрана. Нажмите «Сохранить», чтобы применить настройки.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось открыть выбор папки')
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="m-0 text-xl font-semibold tracking-[-0.03em]">Быстрые настройки</h2>
          <p className="mt-1 text-sm text-zinc-500">OBS WebSocket, пароль в системном keychain, папка клипов и отступы вокруг сделки.</p>
        </div>
        <Button onClick={save} disabled={saving}>{saving ? 'Сохраняем...' : 'Сохранить'}</Button>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <label className="text-xs font-medium text-zinc-500">
          OBS host
          <input className={inputClass} value={host} onChange={(event) => setHost(event.target.value)} />
        </label>
        <label className="text-xs font-medium text-zinc-500">
          OBS port
          <input className={inputClass} value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" />
        </label>
        <label className="text-xs font-medium text-zinc-500">
          OBS пароль
          <input className={inputClass} value={obsPassword} onChange={(event) => setObsPassword(event.target.value)} type="password" placeholder={settings?.obs.passwordConfigured ? 'Сохранён' : 'Не задан'} />
        </label>
        <label className="text-xs font-medium text-zinc-500">
          Секунд до входа
          <input className={inputClass} value={paddingBefore} onChange={(event) => setPaddingBefore(event.target.value)} inputMode="numeric" />
        </label>
        <label className="text-xs font-medium text-zinc-500">
          Секунд после выхода
          <input className={inputClass} value={paddingAfter} onChange={(event) => setPaddingAfter(event.target.value)} inputMode="numeric" />
        </label>
        <div className="text-xs font-medium text-zinc-500 md:col-span-2 xl:col-span-3">
          Папка OBS replay
          <div className="mt-1 flex gap-2">
            <input className={`${inputClass.replace('mt-1 ', '')} min-w-0 flex-1`} value={replaySourceDir} onChange={(event) => setReplaySourceDir(event.target.value)} />
            <Button variant="ghost" onClick={() => void selectDirectory(replaySourceDir, setReplaySourceDir)}><FolderOpen size={16} className="mr-2" />Выбрать</Button>
          </div>
        </div>
        <div className="text-xs font-medium text-zinc-500 md:col-span-2 xl:col-span-3">
          Папка клипов
          <div className="mt-1 flex gap-2">
            <input className={`${inputClass.replace('mt-1 ', '')} min-w-0 flex-1`} value={outputDir} onChange={(event) => setOutputDir(event.target.value)} />
            <Button variant="ghost" onClick={() => void selectDirectory(outputDir, setOutputDir)}><FolderOpen size={16} className="mr-2" />Выбрать</Button>
          </div>
        </div>
      </div>
      {message && <p className="mt-4 text-sm text-emerald-300">{message}</p>}
    </Card>
  )
}
