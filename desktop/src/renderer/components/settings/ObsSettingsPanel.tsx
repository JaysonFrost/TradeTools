import { FolderOpen, Monitor, Radio, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../main/services/settings/settings'
import type { WindowCaptureSource } from '../../../main/services/recording/windowRecorderService'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

export type ObsSettingsPanelProps = {
  settings?: AppSettings
  onSaved: (settings: AppSettings) => void
}

const inputClass = 'mt-1 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-violet-400/60'

export const ObsSettingsPanel = ({ settings, onSaved }: ObsSettingsPanelProps) => {
  const [recordingMode, setRecordingMode] = useState<AppSettings['recording']['mode']>('obs')
  const [sourceType, setSourceType] = useState<AppSettings['recording']['sourceType']>('window')
  const [windowSourceId, setWindowSourceId] = useState('')
  const [windowSourceName, setWindowSourceName] = useState('')
  const [frameRate, setFrameRate] = useState('30')
  const [segmentSeconds, setSegmentSeconds] = useState('2')
  const [windowSources, setWindowSources] = useState<WindowCaptureSource[]>([])
  const [loadingSources, setLoadingSources] = useState(false)
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
    setRecordingMode(settings.recording.mode)
    setSourceType(settings.recording.sourceType)
    setWindowSourceId(settings.recording.windowSourceId)
    setWindowSourceName(settings.recording.windowSourceName)
    setFrameRate(String(settings.recording.frameRate))
    setSegmentSeconds(String(settings.recording.segmentSeconds))
    setHost(settings.obs.host)
    setPort(String(settings.obs.port))
    setPaddingBefore(String(settings.clip.paddingBeforeSeconds))
    setPaddingAfter(String(settings.clip.paddingAfterSeconds))
    setReplaySourceDir(settings.clip.replaySourceDir)
    setOutputDir(settings.clip.outputDir)
  }, [settings])

  const refreshWindowSources = async () => {
    setLoadingSources(true)
    setMessage('')
    try {
      const sources = await getTradeToolsApi().recording.listWindowSources()
      setWindowSources(sources)
      setMessage(sources.length > 0 ? 'Список окон обновлён' : 'Окна для записи не найдены')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось получить список окон')
    } finally {
      setLoadingSources(false)
    }
  }

  useEffect(() => {
    if (recordingMode !== 'window') return
    void refreshWindowSources()
  }, [recordingMode])

  const filteredSources = windowSources.filter((source) => source.type === sourceType)

  const save = async () => {
    setSaving(true)
    setMessage('')
    try {
      const api = getTradeToolsApi()
      const selectedSource = windowSources.find((source) => source.id === windowSourceId)
      const updated = await api.settings.update({
        obsPassword: obsPassword.trim() || undefined,
        recording: {
          mode: recordingMode,
          sourceType,
          windowSourceId,
          windowSourceName: selectedSource?.name ?? windowSourceName,
          frameRate: Number(frameRate),
          segmentSeconds: Number(segmentSeconds)
        },
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="m-0 text-xl font-semibold tracking-[-0.03em]">Запись видео</h2>
          <p className="mt-1 text-sm text-zinc-500">Выберите OBS Replay Buffer или встроенную запись окна/экрана.</p>
        </div>
        <Button onClick={save} disabled={saving}>{saving ? 'Сохраняем...' : 'Сохранить'}</Button>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          className={`inline-flex min-h-10 items-center rounded-2xl border px-4 text-sm font-semibold transition ${recordingMode === 'obs' ? 'border-violet-400/40 bg-violet-500/20 text-violet-100' : 'border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]'}`}
          onClick={() => setRecordingMode('obs')}
          type="button"
        >
          <Radio size={16} className="mr-2" />OBS Replay Buffer
        </button>
        <button
          className={`inline-flex min-h-10 items-center rounded-2xl border px-4 text-sm font-semibold transition ${recordingMode === 'window' ? 'border-violet-400/40 bg-violet-500/20 text-violet-100' : 'border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]'}`}
          onClick={() => setRecordingMode('window')}
          type="button"
        >
          <Monitor size={16} className="mr-2" />Встроенная запись
        </button>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {recordingMode === 'obs' ? (
          <>
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
          </>
        ) : (
          <>
            <label className="text-xs font-medium text-zinc-500 md:col-span-2 xl:col-span-3">
              Источник записи
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <div className="flex rounded-2xl border border-white/10 bg-black/20 p-1">
                  <button
                    className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${sourceType === 'window' ? 'bg-violet-500 text-white' : 'text-zinc-400 hover:text-zinc-100'}`}
                    onClick={() => {
                      setSourceType('window')
                      setWindowSourceId('')
                      setWindowSourceName('')
                    }}
                    type="button"
                  >
                    Окно
                  </button>
                  <button
                    className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${sourceType === 'screen' ? 'bg-violet-500 text-white' : 'text-zinc-400 hover:text-zinc-100'}`}
                    onClick={() => {
                      setSourceType('screen')
                      setWindowSourceId('')
                      setWindowSourceName('')
                    }}
                    type="button"
                  >
                    Экран
                  </button>
                </div>
                <select
                  className={`${inputClass.replace('mt-1 ', '')} min-w-0 flex-1 appearance-none`}
                  value={windowSourceId}
                  onChange={(event) => {
                    const source = windowSources.find((candidate) => candidate.id === event.target.value)
                    setWindowSourceId(event.target.value)
                    setWindowSourceName(source?.name ?? '')
                  }}
                >
                  <option value="">{windowSourceName || (sourceType === 'screen' ? 'Выберите экран' : 'Выберите окно')}</option>
                  {filteredSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
                </select>
                <Button variant="ghost" onClick={() => void refreshWindowSources()} disabled={loadingSources}>
                  <RefreshCw size={16} className={`mr-2 ${loadingSources ? 'animate-spin' : ''}`} />Обновить
                </Button>
              </div>
            </label>
            <label className="text-xs font-medium text-zinc-500">
              FPS записи
              <input className={inputClass} value={frameRate} onChange={(event) => setFrameRate(event.target.value)} inputMode="numeric" />
            </label>
            <label className="text-xs font-medium text-zinc-500">
              Интервал буфера, сек
              <input className={inputClass} value={segmentSeconds} onChange={(event) => setSegmentSeconds(event.target.value)} inputMode="numeric" />
            </label>
            <p className="self-end text-xs leading-5 text-zinc-500 md:col-span-2 xl:col-span-1">Если window capture замирает на Windows, выберите экран. На macOS может потребоваться разрешение записи экрана.</p>
          </>
        )}
        <label className="text-xs font-medium text-zinc-500">
          Секунд до входа
          <input className={inputClass} value={paddingBefore} onChange={(event) => setPaddingBefore(event.target.value)} inputMode="numeric" />
        </label>
        <label className="text-xs font-medium text-zinc-500">
          Секунд после выхода
          <input className={inputClass} value={paddingAfter} onChange={(event) => setPaddingAfter(event.target.value)} inputMode="numeric" />
        </label>
        {recordingMode === 'obs' && (
          <div className="text-xs font-medium text-zinc-500 md:col-span-2 xl:col-span-3">
            Папка OBS replay
            <div className="mt-1 flex gap-2">
              <input className={`${inputClass.replace('mt-1 ', '')} min-w-0 flex-1`} value={replaySourceDir} onChange={(event) => setReplaySourceDir(event.target.value)} />
              <Button variant="ghost" onClick={() => void selectDirectory(replaySourceDir, setReplaySourceDir)}><FolderOpen size={16} className="mr-2" />Выбрать</Button>
            </div>
          </div>
        )}
        <div className={`text-xs font-medium text-zinc-500 md:col-span-2 ${recordingMode === 'obs' ? 'xl:col-span-3' : 'xl:col-span-6'}`}>
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
