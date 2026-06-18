import { CircleHelp, Clock3, FolderOpen, Monitor, Radio, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../../../main/services/settings/settings'
import type { WindowCaptureSource } from '../../../main/services/recording/windowRecorderService'
import { defaultClipPaddingAfterSeconds, defaultClipPaddingBeforeSeconds, defaultReplayBufferSeconds, longClipAfterExitSeconds, longClipPresetSeconds } from '../../../shared/videoDefaults'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'
import { findPreferredTerminalSource } from '../../lib/windowCaptureSources'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

export type ObsSettingsPanelProps = {
  settings?: AppSettings
  onSaved: (settings: AppSettings) => void
}

const inputClass = 'mt-1 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-violet-400/60'
const segmentSecondsHint = 'Размер одного куска записи. Обычно 2с: статус обновляется часто, а файлов не слишком много. Это не общая длина хранения.'
const replayBufferSecondsHint = 'Сколько секунд видео TradeTools держит до входа в сделку. Это должно быть не меньше поля «Секунд до входа».'

const FieldHint = ({ text }: { text: string }) => (
  <span className="ml-1 inline-flex align-middle text-zinc-500 transition hover:text-violet-200" title={text}>
    <CircleHelp size={13} />
  </span>
)

const toCaptureTarget = (source: WindowCaptureSource): AppSettings['recording']['captureTargets'][number] => ({
  id: source.id,
  name: source.name,
  type: source.type,
  ...(source.displayId ? { displayId: source.displayId } : {})
})

export const ObsSettingsPanel = ({ settings, onSaved }: ObsSettingsPanelProps) => {
  const [recordingMode, setRecordingMode] = useState<AppSettings['recording']['mode']>('window')
  const [sourceType, setSourceType] = useState<AppSettings['recording']['sourceType']>('window')
  const [windowSourceId, setWindowSourceId] = useState('')
  const [windowSourceName, setWindowSourceName] = useState('')
  const [captureTargets, setCaptureTargets] = useState<AppSettings['recording']['captureTargets']>([])
  const [saveTargetMode, setSaveTargetMode] = useState<AppSettings['recording']['saveTargetMode']>('all')
  const [saveTargetId, setSaveTargetId] = useState('')
  const [saveTradeDisplayOnly, setSaveTradeDisplayOnly] = useState(false)
  const [frameRate, setFrameRate] = useState('30')
  const [segmentSeconds, setSegmentSeconds] = useState('2')
  const [systemAudioEnabled, setSystemAudioEnabled] = useState(false)
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false)
  const [windowSources, setWindowSources] = useState<WindowCaptureSource[]>([])
  const [loadingSources, setLoadingSources] = useState(false)
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('4455')
  const [paddingBefore, setPaddingBefore] = useState(String(defaultClipPaddingBeforeSeconds))
  const [paddingAfter, setPaddingAfter] = useState(String(defaultClipPaddingAfterSeconds))
  const [replayBufferSeconds, setReplayBufferSeconds] = useState(String(defaultReplayBufferSeconds))
  const [replaySourceDir, setReplaySourceDir] = useState('')
  const [outputDir, setOutputDir] = useState('')
  const [obsPassword, setObsPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const hydratedSettingsRef = useRef(false)
  const lastSavedSnapshotRef = useRef('')

  const buildSettingsSnapshot = (password = obsPassword): string => JSON.stringify({
    recordingMode,
    sourceType,
    windowSourceId,
    windowSourceName,
    captureTargets,
    saveTargetMode,
    saveTargetId,
    saveTradeDisplayOnly,
    frameRate,
    segmentSeconds,
    systemAudioEnabled,
    microphoneEnabled,
    host,
    port,
    paddingBefore,
    paddingAfter,
    replayBufferSeconds,
    replaySourceDir,
    outputDir,
    obsPassword: password
  })

  const buildSettingsSnapshotFromSettings = (nextSettings: AppSettings): string => JSON.stringify({
    recordingMode: nextSettings.recording.mode,
    sourceType: nextSettings.recording.sourceType,
    windowSourceId: nextSettings.recording.windowSourceId,
    windowSourceName: nextSettings.recording.windowSourceName,
    captureTargets: nextSettings.recording.captureTargets,
    saveTargetMode: nextSettings.recording.saveTargetMode,
    saveTargetId: nextSettings.recording.saveTargetId,
    saveTradeDisplayOnly: nextSettings.recording.saveTradeDisplayOnly,
    frameRate: String(nextSettings.recording.frameRate),
    segmentSeconds: String(nextSettings.recording.segmentSeconds),
    systemAudioEnabled: nextSettings.recording.systemAudioEnabled,
    microphoneEnabled: nextSettings.recording.microphoneEnabled,
    host: nextSettings.obs.host,
    port: String(nextSettings.obs.port),
    paddingBefore: String(nextSettings.clip.paddingBeforeSeconds),
    paddingAfter: String(nextSettings.clip.paddingAfterSeconds),
    replayBufferSeconds: String(nextSettings.clip.replayBufferSeconds),
    replaySourceDir: nextSettings.clip.replaySourceDir,
    outputDir: nextSettings.clip.outputDir,
    obsPassword: ''
  })

  useEffect(() => {
    if (!settings) return
    setRecordingMode(settings.recording.mode)
    setSourceType(settings.recording.sourceType)
    setWindowSourceId(settings.recording.windowSourceId)
    setWindowSourceName(settings.recording.windowSourceName)
    setCaptureTargets(settings.recording.captureTargets)
    setSaveTargetMode(settings.recording.saveTargetMode)
    setSaveTargetId(settings.recording.saveTargetId)
    setSaveTradeDisplayOnly(settings.recording.saveTradeDisplayOnly)
    setFrameRate(String(settings.recording.frameRate))
    setSegmentSeconds(String(settings.recording.segmentSeconds))
    setSystemAudioEnabled(settings.recording.systemAudioEnabled)
    setMicrophoneEnabled(settings.recording.microphoneEnabled)
    setHost(settings.obs.host)
    setPort(String(settings.obs.port))
    setPaddingBefore(String(settings.clip.paddingBeforeSeconds))
    setPaddingAfter(String(settings.clip.paddingAfterSeconds))
    setReplayBufferSeconds(String(settings.clip.replayBufferSeconds))
    setReplaySourceDir(settings.clip.replaySourceDir)
    setOutputDir(settings.clip.outputDir)
    setObsPassword('')
    lastSavedSnapshotRef.current = buildSettingsSnapshotFromSettings(settings)
    hydratedSettingsRef.current = true
  }, [settings])

  const refreshWindowSources = async (options: { announce?: boolean } = {}) => {
    const announce = options.announce !== false
    setLoadingSources(true)
    if (announce) setMessage('')
    try {
      const sources = await getTradeToolsApi().recording.listWindowSources()
      setWindowSources(sources)
      const preferredSource = recordingMode === 'window' && sourceType === 'window' && !windowSourceId && !windowSourceName
        ? findPreferredTerminalSource(sources)
        : undefined
      if (preferredSource) {
        setWindowSourceId(preferredSource.id)
        setWindowSourceName(preferredSource.name)
        setCaptureTargets([toCaptureTarget(preferredSource)])
        setSaveTargetMode('selected')
        setSaveTargetId(preferredSource.id)
        if (announce) setMessage(`Автоматически выбрали окно: ${preferredSource.name}`)
        return
      }
      if (announce) setMessage(sources.length > 0 ? 'Список окон обновлён' : 'Окна для записи не найдены')
    } catch (error) {
      if (announce) setMessage(error instanceof Error ? error.message : 'Не удалось получить список окон')
    } finally {
      setLoadingSources(false)
    }
  }

  useEffect(() => {
    if (recordingMode !== 'window') return
    void refreshWindowSources({ announce: false })
    const interval = window.setInterval(() => void refreshWindowSources({ announce: false }), 60_000)
    return () => window.clearInterval(interval)
  }, [recordingMode, sourceType, windowSourceId, windowSourceName])

  const filteredSources = windowSources.filter((source) => source.type === sourceType)
  const screenSources = windowSources.filter((source) => source.type === 'screen')
  const selectedCaptureTargetIds = new Set(captureTargets.map((target) => target.id))

  const toggleScreenCaptureTarget = (source: WindowCaptureSource, checked: boolean) => {
    const target = toCaptureTarget(source)
    setCaptureTargets((current) => {
      const nextTargets = checked
        ? [...current.filter((candidate) => candidate.id !== target.id), target]
        : current.filter((candidate) => candidate.id !== target.id)
      if (!nextTargets.some((candidate) => candidate.id === saveTargetId)) {
        setSaveTargetId(nextTargets[0]?.id ?? '')
      }
      return nextTargets
    })
  }

  const saveCurrentSettings = async (snapshot = buildSettingsSnapshot()) => {
    setSaving(true)
    try {
      const api = getTradeToolsApi()
      const selectedSource = windowSources.find((source) => source.id === windowSourceId)
      const submittedPassword = obsPassword.trim()
      const parsedPaddingBeforeSeconds = Number(paddingBefore)
      const parsedReplayBufferSeconds = Number(replayBufferSeconds)
      const paddingBeforeSeconds = Number.isFinite(parsedPaddingBeforeSeconds) ? parsedPaddingBeforeSeconds : 0
      const selectedCaptureTarget = selectedSource ? toCaptureTarget(selectedSource) : undefined
      const nextCaptureTargets = sourceType === 'screen'
        ? captureTargets.filter((target) => target.type === 'screen')
        : selectedCaptureTarget ? [selectedCaptureTarget] : captureTargets.filter((target) => target.type === 'window')
      const replayBufferSecondsValue = recordingMode === 'window'
        ? Math.max(Number.isFinite(parsedReplayBufferSeconds) ? parsedReplayBufferSeconds : 0, paddingBeforeSeconds)
        : parsedReplayBufferSeconds
      const updated = await api.settings.update({
        obsPassword: submittedPassword || undefined,
        recording: {
          mode: recordingMode,
          sourceType,
          windowSourceId,
          windowSourceName: selectedSource?.name ?? windowSourceName,
          captureTargets: nextCaptureTargets,
          saveTargetMode,
          saveTargetId,
          saveTradeDisplayOnly,
          frameRate: Number(frameRate),
          segmentSeconds: Number(segmentSeconds),
          systemAudioEnabled,
          microphoneEnabled
        },
        obs: {
          host,
          port: Number(port)
        },
        clip: {
          paddingBeforeSeconds: Number(paddingBefore),
          paddingAfterSeconds: Number(paddingAfter),
          replayBufferSeconds: replayBufferSecondsValue,
          replaySourceDir,
          outputDir
        }
      })
      onSaved(updated)
      lastSavedSnapshotRef.current = submittedPassword ? buildSettingsSnapshot('') : snapshot
      if (submittedPassword) setObsPassword('')
      setMessage('Настройки применены')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось сохранить настройки')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!settings || !hydratedSettingsRef.current) return
    const snapshot = buildSettingsSnapshot()
    if (snapshot === lastSavedSnapshotRef.current) return

    const timeout = window.setTimeout(() => {
      void saveCurrentSettings(snapshot)
    }, 500)
    return () => window.clearTimeout(timeout)
  }, [
    recordingMode,
    sourceType,
    windowSourceId,
    windowSourceName,
    captureTargets,
    saveTargetMode,
    saveTargetId,
    saveTradeDisplayOnly,
    frameRate,
    segmentSeconds,
    systemAudioEnabled,
    microphoneEnabled,
    host,
    port,
    paddingBefore,
    paddingAfter,
    replayBufferSeconds,
    replaySourceDir,
    outputDir,
    obsPassword
  ])

  const applyDefaultClipPreset = () => {
    setPaddingBefore(String(defaultClipPaddingBeforeSeconds))
    setPaddingAfter(String(defaultClipPaddingAfterSeconds))
    setReplayBufferSeconds(String(defaultReplayBufferSeconds))
    setMessage('Дефолтный пресет включён: 2с до входа, 2с после выхода, буфер 60с.')
  }

  const applyLongClipPreset = () => {
    const beforeSeconds = String(longClipPresetSeconds)
    const afterSeconds = String(longClipAfterExitSeconds)
    setPaddingBefore(beforeSeconds)
    setPaddingAfter(afterSeconds)
    setReplayBufferSeconds(beforeSeconds)
    setMessage(recordingMode === 'window'
      ? 'Пресет включён: 10 минут до входа и 2 минуты после выхода. Клип появится примерно через 2 минуты после выхода.'
      : 'Пресет включён: 10 минут до входа и 2 минуты после выхода. В OBS поставьте Replay Buffer минимум 12 минут плюс обычная длина сделки.')
  }

  const selectDirectory = async (currentPath: string, setValue: (value: string) => void) => {
    try {
      const api = getTradeToolsApi()
      const selectedPath = await api.dialog.selectDirectory(currentPath.trim() || undefined)
      if (!selectedPath) return
      setValue(selectedPath)
      setMessage('Папка выбрана, настройки применяются')
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
        {saving && <span className="text-sm text-violet-200">Применяем...</span>}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          className={`inline-flex min-h-10 items-center rounded-2xl border px-4 text-sm font-semibold transition ${recordingMode === 'window' ? 'border-violet-400/40 bg-violet-500/20 text-violet-100' : 'border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]'}`}
          onClick={() => setRecordingMode('window')}
          type="button"
        >
          <Monitor size={16} className="mr-2" />Встроенная запись
        </button>
        <button
          className={`inline-flex min-h-10 items-center rounded-2xl border px-4 text-sm font-semibold transition ${recordingMode === 'obs' ? 'border-violet-400/40 bg-violet-500/20 text-violet-100' : 'border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]'}`}
          onClick={() => setRecordingMode('obs')}
          type="button"
        >
          <Radio size={16} className="mr-2" />OBS Replay Buffer
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 text-sm leading-6 text-zinc-400">
        <Button variant="ghost" onClick={applyDefaultClipPreset}><Clock3 size={16} className="mr-2" />Пресет 2с до / 2с после</Button>
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">буфер 60с</span>
      </div>

      <div className="mt-3 border-l-2 border-amber-300/60 pl-3 text-sm leading-6 text-zinc-400">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={applyLongClipPreset}><Clock3 size={16} className="mr-2" />Пресет 10 минут до / 2 минуты после</Button>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">Тяжёлый режим</span>
        </div>
        <p className="mt-2">
          Клип появится только после записи времени после выхода. Для OBS поставьте Replay Buffer минимум 12 минут плюс обычная длина сделки; для встроенной записи TradeTools будет хранить 10 минут локального буфера и 2 минуты после выхода.
        </p>
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
                      setCaptureTargets([])
                      setSaveTargetMode('selected')
                      setSaveTargetId('')
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
                      setCaptureTargets([])
                      setSaveTargetMode('all')
                      setSaveTargetId('')
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
                    setCaptureTargets(source ? [toCaptureTarget(source)] : [])
                    setSaveTargetMode(source?.type === 'screen' ? saveTargetMode : 'selected')
                    setSaveTargetId(source?.id ?? '')
                  }}
                >
                  <option value="">{windowSourceName || (sourceType === 'screen' ? 'Выберите экран' : 'Выберите окно')}</option>
                  {filteredSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
                </select>
                <Button variant="ghost" onClick={() => void refreshWindowSources({ announce: true })} disabled={loadingSources}>
                  <RefreshCw size={16} className={`mr-2 ${loadingSources ? 'animate-spin' : ''}`} />Обновить
                </Button>
              </div>
            </label>
            {sourceType === 'screen' && (
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-xs font-medium text-zinc-500 md:col-span-2 xl:col-span-6">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="font-semibold text-zinc-300">Мониторы для записи</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {screenSources.map((source) => (
                        <label key={source.id} className="flex min-h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-zinc-200">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-violet-500"
                            checked={selectedCaptureTargetIds.has(source.id)}
                            onChange={(event) => toggleScreenCaptureTarget(source, event.target.checked)}
                          />
                          {source.name}
                        </label>
                      ))}
                      {screenSources.length === 0 && <span className="text-zinc-500">Экраны не найдены</span>}
                    </div>
                  </div>
                  <div className="min-w-[220px]">
                    <div className="flex rounded-2xl border border-white/10 bg-black/30 p-1">
                      <button
                        className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${saveTargetMode === 'all' ? 'bg-violet-500 text-white' : 'text-zinc-400 hover:text-zinc-100'}`}
                        onClick={() => setSaveTargetMode('all')}
                        type="button"
                      >
                        Все мониторы
                      </button>
                      <button
                        className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${saveTargetMode === 'selected' ? 'bg-violet-500 text-white' : 'text-zinc-400 hover:text-zinc-100'}`}
                        onClick={() => setSaveTargetMode('selected')}
                        type="button"
                      >
                        Выбранный монитор
                      </button>
                    </div>
                    {saveTargetMode === 'selected' && (
                      <select
                        className={`${inputClass} appearance-none`}
                        value={saveTargetId}
                        onChange={(event) => setSaveTargetId(event.target.value)}
                      >
                        <option value="">Выберите монитор</option>
                        {captureTargets.filter((target) => target.type === 'screen').map((target) => (
                          <option key={target.id} value={target.id}>{target.name}</option>
                        ))}
                      </select>
                    )}
                    {saveTargetMode === 'all' && (
                      <label className="mt-2 flex min-h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-zinc-200">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-violet-500"
                          checked={saveTradeDisplayOnly}
                          onChange={(event) => setSaveTradeDisplayOnly(event.target.checked)}
                        />
                        Только монитор сделки
                      </label>
                    )}
                  </div>
                </div>
              </div>
            )}
            <label className="text-xs font-medium text-zinc-500">
              FPS записи
              <input className={inputClass} value={frameRate} onChange={(event) => setFrameRate(event.target.value)} inputMode="numeric" />
            </label>
            <label className="text-xs font-medium text-zinc-500">
              <span>Интервал буфера, сек<FieldHint text={segmentSecondsHint} /></span>
              <input className={inputClass} value={segmentSeconds} onChange={(event) => setSegmentSeconds(event.target.value)} inputMode="numeric" />
            </label>
            <label className="text-xs font-medium text-zinc-500">
              <span>Буфер до входа, сек<FieldHint text={replayBufferSecondsHint} /></span>
              <input className={inputClass} value={replayBufferSeconds} onChange={(event) => setReplayBufferSeconds(event.target.value)} inputMode="numeric" />
            </label>
            <label className="flex min-h-10 items-center gap-2 whitespace-nowrap rounded-2xl border border-white/10 bg-black/20 px-3 text-xs font-semibold text-zinc-200">
              <input
                type="checkbox"
                className="h-4 w-4 accent-violet-500"
                checked={systemAudioEnabled}
                onChange={(event) => setSystemAudioEnabled(event.target.checked)}
              />
              Звук с ПК
            </label>
            <label className="flex min-h-10 items-center gap-2 whitespace-nowrap rounded-2xl border border-white/10 bg-black/20 px-3 text-xs font-semibold text-zinc-200">
              <input
                type="checkbox"
                className="h-4 w-4 accent-violet-500"
                checked={microphoneEnabled}
                onChange={(event) => setMicrophoneEnabled(event.target.checked)}
              />
              Микрофон
            </label>
            <p className="self-end text-xs leading-5 text-zinc-500 md:col-span-2 xl:col-span-6">Если window capture замирает на Windows, выберите экран. На macOS может потребоваться разрешение записи экрана.</p>
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
