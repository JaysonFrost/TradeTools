import { CircleHelp, Clock3, Clapperboard, FolderOpen, Monitor, Pin, Power, Radio, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { WindowCaptureSource } from '../../../main/services/recording/windowRecorderService'
import type { AppSettings } from '../../../main/services/settings/settings'
import type { VideoEncoderOption } from '../../../main/services/video/videoEncoderDevices'
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
const sectionClass = 'min-w-0 border-t border-white/10 pt-4 first:border-t-0 first:pt-0'
const sectionTitleClass = 'text-sm font-semibold text-zinc-100'
const sectionHintClass = 'mt-1 text-xs leading-5 text-zinc-500'
const checkCardClass = 'flex min-w-0 items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm leading-5 text-zinc-300'
const segmentSecondsHint = 'Размер одного куска записи. Обычно 2с: статус обновляется часто, а файлов не слишком много. Это не общая длина хранения.'
const replayBufferSecondsHint = 'Сколько секунд видео TradeTools держит до входа. Это должно быть не меньше поля «Секунд до входа».'

const isDraftInput = (element: EventTarget | null): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement => (
  element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement
)

const numberOrUndefined = (value: string): number | undefined => {
  const trimmed = value.trim()
  if (!trimmed) return undefined

  const numericValue = Number(trimmed)
  return Number.isFinite(numericValue) ? numericValue : undefined
}

const normalizeVideoEncoderValue = (value: string): AppSettings['recording']['videoEncoder'] => {
  if (value === 'cpu' || value === 'gpu' || value === 'nvidia' || value === 'amd' || value === 'intel') return value
  return /^gpu:(nvidia|amd|intel):\d+$/.test(value) ? value as AppSettings['recording']['videoEncoder'] : 'gpu'
}

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

const sourceMatchesCaptureTarget = (source: WindowCaptureSource, target: AppSettings['recording']['captureTargets'][number]): boolean => (
  source.type === target.type && (
    source.id === target.id ||
    source.name === target.name ||
    (source.type === 'screen' && Boolean(source.displayId) && source.displayId === target.displayId)
  )
)

export const ObsSettingsPanel = ({ settings, onSaved }: ObsSettingsPanelProps) => {
  const [recordingMode, setRecordingMode] = useState<AppSettings['recording']['mode']>('window')
  const [sourceType, setSourceType] = useState<AppSettings['recording']['sourceType']>('window')
  const [windowSourceId, setWindowSourceId] = useState('')
  const [windowSourceName, setWindowSourceName] = useState('')
  const [captureTargets, setCaptureTargets] = useState<AppSettings['recording']['captureTargets']>([])
  const [videoEncoder, setVideoEncoder] = useState<AppSettings['recording']['videoEncoder']>('gpu')
  const [resolutionPreset, setResolutionPreset] = useState<AppSettings['recording']['resolutionPreset']>('1440p')
  const [frameRate, setFrameRate] = useState('30')
  const [segmentSeconds, setSegmentSeconds] = useState('2')
  const [systemAudioEnabled, setSystemAudioEnabled] = useState(false)
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false)
  const [launchAtLogin, setLaunchAtLogin] = useState(false)
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [clipSuccessNotificationsEnabled, setClipSuccessNotificationsEnabled] = useState(true)
  const [windowSources, setWindowSources] = useState<WindowCaptureSource[]>([])
  const [videoEncoderOptions, setVideoEncoderOptions] = useState<VideoEncoderOption[]>([])
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
  const [clearingCache, setClearingCache] = useState(false)
  const [message, setMessage] = useState('')
  const [editingDraft, setEditingDraft] = useState(false)
  const hydratedSettingsRef = useRef(false)
  const lastSavedSnapshotRef = useRef('')
  const skipNextAutosaveRef = useRef(false)

  const buildSettingsSnapshot = (password = obsPassword): string => JSON.stringify({
    recordingMode,
    sourceType,
    windowSourceId,
    windowSourceName,
    captureTargets,
    videoEncoder,
    resolutionPreset,
    frameRate,
    segmentSeconds,
    systemAudioEnabled,
    microphoneEnabled,
    launchAtLogin,
    alwaysOnTop,
    clipSuccessNotificationsEnabled,
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
    videoEncoder: nextSettings.recording.videoEncoder,
    resolutionPreset: nextSettings.recording.resolutionPreset,
    frameRate: String(nextSettings.recording.frameRate),
    segmentSeconds: String(nextSettings.recording.segmentSeconds),
    systemAudioEnabled: nextSettings.recording.systemAudioEnabled,
    microphoneEnabled: nextSettings.recording.microphoneEnabled,
    launchAtLogin: nextSettings.system.launchAtLogin,
    alwaysOnTop: nextSettings.system.alwaysOnTop,
    clipSuccessNotificationsEnabled: nextSettings.system.clipSuccessNotificationsEnabled,
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
    if (editingDraft && hydratedSettingsRef.current) return

    skipNextAutosaveRef.current = true
    setRecordingMode(settings.recording.mode)
    setSourceType(settings.recording.sourceType)
    setWindowSourceId(settings.recording.windowSourceId)
    setWindowSourceName(settings.recording.windowSourceName)
    setCaptureTargets(settings.recording.captureTargets)
    setVideoEncoder(settings.recording.videoEncoder)
    setResolutionPreset(settings.recording.resolutionPreset)
    setFrameRate(String(settings.recording.frameRate))
    setSegmentSeconds(String(settings.recording.segmentSeconds))
    setSystemAudioEnabled(settings.recording.systemAudioEnabled)
    setMicrophoneEnabled(settings.recording.microphoneEnabled)
    setLaunchAtLogin(settings.system.launchAtLogin)
    setAlwaysOnTop(settings.system.alwaysOnTop)
    setClipSuccessNotificationsEnabled(settings.system.clipSuccessNotificationsEnabled)
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
  }, [settings, editingDraft])

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
  }, [recordingMode, sourceType])

  useEffect(() => {
    void getTradeToolsApi().recording.listVideoEncoders()
      .then(setVideoEncoderOptions)
      .catch(() => setVideoEncoderOptions([{ id: 'gpu', label: 'Видеокарта (авто)', kind: 'gpu' }, { id: 'cpu', label: 'Процессор', kind: 'cpu' }]))
  }, [])

  useEffect(() => {
    if (videoEncoderOptions.length === 0 || videoEncoderOptions.some((option) => option.id === videoEncoder)) return

    setVideoEncoder(videoEncoderOptions[0]?.id ?? 'cpu')
  }, [videoEncoderOptions, videoEncoder])

  const windowOptions = windowSources.filter((source) => source.type === 'window')
  const screenSources = windowSources.filter((source) => source.type === 'screen')
  const isCaptureTargetSelected = (source: WindowCaptureSource): boolean => captureTargets.some((target) => sourceMatchesCaptureTarget(source, target))

  const toggleScreenCaptureTarget = (source: WindowCaptureSource, checked: boolean) => {
    const target = toCaptureTarget(source)
    setCaptureTargets((current) => (
      checked
        ? [...current.filter((candidate) => !sourceMatchesCaptureTarget(source, candidate)), target]
        : current.filter((candidate) => !sourceMatchesCaptureTarget(source, candidate))
    ))
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
      const savedScreenCaptureTargets = settings?.recording.sourceType === 'screen'
        ? settings.recording.captureTargets.filter((target) => target.type === 'screen')
        : []
      const screenCaptureTargets = captureTargets.filter((target) => target.type === 'screen')
      const nextCaptureTargets = sourceType === 'screen'
        ? (screenCaptureTargets.length > 0 ? screenCaptureTargets : savedScreenCaptureTargets)
            .map((target) => {
              const source = windowSources.find((source) => sourceMatchesCaptureTarget(source, target))
              return source ? toCaptureTarget(source) : target
            })
        : selectedCaptureTarget ? [selectedCaptureTarget] : captureTargets.filter((target) => target.type === 'window')
      const firstCaptureTarget = nextCaptureTargets[0]
      const saveTargetId = sourceType === 'screen'
        ? firstCaptureTarget?.id ?? ''
        : selectedCaptureTarget?.id ?? nextCaptureTargets[0]?.id ?? ''
      const replayBufferSecondsValue = recordingMode === 'window'
        ? Math.max(Number.isFinite(parsedReplayBufferSeconds) ? parsedReplayBufferSeconds : 0, paddingBeforeSeconds)
        : parsedReplayBufferSeconds
      const updated = await api.settings.update({
        obsPassword: submittedPassword || undefined,
        recording: {
          mode: recordingMode,
          sourceType,
          windowSourceId: sourceType === 'screen' ? firstCaptureTarget?.id ?? '' : windowSourceId,
          windowSourceName: sourceType === 'screen' ? firstCaptureTarget?.name ?? '' : selectedSource?.name ?? windowSourceName,
          captureTargets: nextCaptureTargets,
          saveTargetMode: sourceType === 'screen' ? 'all' : 'selected',
          saveTargetId,
          videoEncoder,
          resolutionPreset,
          frameRate: numberOrUndefined(frameRate),
          segmentSeconds: numberOrUndefined(segmentSeconds),
          systemAudioEnabled,
          microphoneEnabled
        },
        obs: {
          host,
          port: numberOrUndefined(port)
        },
        clip: {
          paddingBeforeSeconds: numberOrUndefined(paddingBefore),
          paddingAfterSeconds: numberOrUndefined(paddingAfter),
          replayBufferSeconds: replayBufferSecondsValue,
          replaySourceDir,
          outputDir
        },
        system: {
          launchAtLogin,
          alwaysOnTop,
          clipSuccessNotificationsEnabled
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
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false
      return
    }

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
    videoEncoder,
    resolutionPreset,
    frameRate,
    segmentSeconds,
    systemAudioEnabled,
    microphoneEnabled,
    launchAtLogin,
    alwaysOnTop,
    clipSuccessNotificationsEnabled,
    host,
    port,
    paddingBefore,
    paddingAfter,
    replayBufferSeconds,
    replaySourceDir,
    outputDir,
    obsPassword,
    settings
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

  const clearVideoCache = async () => {
    if (!window.confirm('Удалить временные записи кэша? Итоговые клипы в папке клипов не будут затронуты.')) return

    setClearingCache(true)
    try {
      const result = await getTradeToolsApi().recording.clearCache()
      setMessage(result.legacyCacheRemoved
        ? 'Кэш видео очищен, включая старые записи после обновления. Итоговые клипы сохранены.'
        : 'Кэш видео очищен. Итоговые клипы сохранены.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось очистить кэш видео')
    } finally {
      setClearingCache(false)
    }
  }

  return (
    <Card
      onFocusCapture={(event) => {
        if (isDraftInput(event.target)) setEditingDraft(true)
      }}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget
        if (isDraftInput(nextTarget) && event.currentTarget.contains(nextTarget)) return
        setEditingDraft(false)
        void saveCurrentSettings()
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="m-0 text-xl font-semibold tracking-[-0.03em]">Настройки записи</h2>
          <p className="mt-1 text-sm text-zinc-500">Источник, буфер, качество, звук, уведомления и папки клипов.</p>
        </div>
        {saving && <span className="text-sm text-violet-200">Применяем...</span>}
      </div>

      <div className="mt-5 grid gap-6 xl:grid-cols-2">
        <section className={sectionClass}>
          <div className={sectionTitleClass}>Источник записи</div>
          <p className={sectionHintClass}>OBS использует Replay Buffer. Встроенная запись пишет выбранное окно или выбранные мониторы.</p>
          <div className="mt-3 flex flex-wrap gap-2">
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

          {recordingMode === 'window' && (
            <div className="mt-4 space-y-4">
              <div className="flex rounded-2xl border border-white/10 bg-black/20 p-1">
                <button
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${sourceType === 'window' ? 'bg-violet-500 text-white' : 'text-zinc-400 hover:text-zinc-100'}`}
                  onClick={() => {
                    setSourceType('window')
                    setWindowSourceId('')
                    setWindowSourceName('')
                    setCaptureTargets([])
                  }}
                  type="button"
                >
                  Окно терминала
                </button>
                <button
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${sourceType === 'screen' ? 'bg-violet-500 text-white' : 'text-zinc-400 hover:text-zinc-100'}`}
                  onClick={() => {
                    setSourceType('screen')
                    setWindowSourceId('')
                    setWindowSourceName('')
                    setCaptureTargets([])
                  }}
                  type="button"
                >
                  Мониторы
                </button>
              </div>

              {sourceType === 'window' ? (
                <label className="block text-xs font-medium text-zinc-500">
                  Окно для записи
                  <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                    <select
                      className={`${inputClass.replace('mt-1 ', '')} min-w-0 flex-1 appearance-none`}
                      value={windowSourceId}
                      onChange={(event) => {
                        const source = windowSources.find((candidate) => candidate.id === event.target.value)
                        setWindowSourceId(event.target.value)
                        setWindowSourceName(source?.name ?? '')
                        setCaptureTargets(source ? [toCaptureTarget(source)] : [])
                      }}
                    >
                      <option value="">{windowSourceName || 'Выберите окно'}</option>
                      {windowOptions.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
                    </select>
                    <Button variant="ghost" onClick={() => void refreshWindowSources({ announce: true })} disabled={loadingSources}>
                      <RefreshCw size={16} className={`mr-2 ${loadingSources ? 'animate-spin' : ''}`} />Обновить
                    </Button>
                  </div>
                </label>
              ) : (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Мониторы для записи</div>
                      <p className={sectionHintClass}>Каждый выбранный монитор сохранится отдельным видео. Лишнее можно быстро удалить в очереди проверки.</p>
                    </div>
                    <Button variant="ghost" onClick={() => void refreshWindowSources({ announce: true })} disabled={loadingSources}>
                      <RefreshCw size={16} className={`mr-2 ${loadingSources ? 'animate-spin' : ''}`} />Обновить
                    </Button>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {screenSources.map((source) => (
                      <label key={source.id} className={checkCardClass}>
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-violet-500"
                          checked={isCaptureTargetSelected(source)}
                          onChange={(event) => toggleScreenCaptureTarget(source, event.target.checked)}
                        />
                        <span>
                          <span className="block font-semibold text-zinc-100">{source.name}</span>
                          <span className="mt-1 block text-xs text-zinc-500">Сохранять сделки с этого монитора</span>
                        </span>
                      </label>
                    ))}
                    {screenSources.length === 0 && <span className="text-sm text-zinc-500">Экраны не найдены</span>}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <section className={sectionClass}>
          <div className={sectionTitleClass}>Пресеты и длительность</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <button
              className="rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.06] p-4 text-left transition hover:bg-emerald-400/[0.1]"
              onClick={applyDefaultClipPreset}
              type="button"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-emerald-100"><Clock3 size={16} />Пресет 2с до / 2с после</span>
              <span className="mt-2 block text-xs uppercase tracking-[0.18em] text-emerald-200">буфер 60с</span>
            </button>
            <button
              className="rounded-2xl border border-amber-300/20 bg-amber-400/[0.06] p-4 text-left transition hover:bg-amber-400/[0.1]"
              onClick={applyLongClipPreset}
              type="button"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-amber-100"><Clock3 size={16} />Пресет 10 минут до / 2 минуты после</span>
              <span className="mt-2 block text-xs uppercase tracking-[0.18em] text-amber-200">Тяжёлый режим</span>
            </button>
          </div>
          <p className={sectionHintClass}>Длинный пресет хранит большой локальный буфер и завершает клип только после записи времени после выхода.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium text-zinc-500">
              Секунд до входа
              <input className={inputClass} value={paddingBefore} onChange={(event) => setPaddingBefore(event.target.value)} inputMode="numeric" />
            </label>
            <label className="text-xs font-medium text-zinc-500">
              Секунд после выхода
              <input className={inputClass} value={paddingAfter} onChange={(event) => setPaddingAfter(event.target.value)} inputMode="numeric" />
            </label>
            <label className="text-xs font-medium text-zinc-500">
              <span>Буфер до входа, сек<FieldHint text={replayBufferSecondsHint} /></span>
              <input className={inputClass} value={replayBufferSeconds} onChange={(event) => setReplayBufferSeconds(event.target.value)} inputMode="numeric" />
            </label>
          </div>
        </section>

        <section className={sectionClass}>
          <div className={sectionTitleClass}>Параметры видео</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            <label className="text-xs font-medium text-zinc-500">
              Кодирование
              <select
                className={`${inputClass} appearance-none`}
                value={videoEncoder}
                onChange={(event) => setVideoEncoder(normalizeVideoEncoderValue(event.target.value))}
              >
                {videoEncoderOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-zinc-500">
              Разрешение
              <select
                className={`${inputClass} appearance-none`}
                value={resolutionPreset}
                onChange={(event) => {
                  const value = event.target.value
                  setResolutionPreset(value === 'native' || value === '1080p' ? value : '1440p')
                }}
              >
                <option value="1440p">Оптимально 1440p</option>
                <option value="native">Нативное</option>
                <option value="1080p">Лёгкое 1080p</option>
              </select>
            </label>
            <label className="text-xs font-medium text-zinc-500">
              FPS записи
              <input className={inputClass} value={frameRate} onChange={(event) => setFrameRate(event.target.value)} inputMode="numeric" />
            </label>
            <label className="text-xs font-medium text-zinc-500">
              <span>Интервал буфера, сек<FieldHint text={segmentSecondsHint} /></span>
              <input className={inputClass} value={segmentSeconds} onChange={(event) => setSegmentSeconds(event.target.value)} inputMode="numeric" />
            </label>
          </div>
        </section>

        <section className={sectionClass}>
          <div className={sectionTitleClass}>Звук записи</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className={checkCardClass}>
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-violet-500"
                checked={systemAudioEnabled}
                onChange={(event) => setSystemAudioEnabled(event.target.checked)}
              />
              <span>
                <span className="block font-semibold text-zinc-100">Звук с ПК</span>
                <span className="mt-1 block text-xs text-zinc-500">Добавлять системный звук в запись.</span>
              </span>
            </label>
            <label className={checkCardClass}>
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-violet-500"
                checked={microphoneEnabled}
                onChange={(event) => setMicrophoneEnabled(event.target.checked)}
              />
              <span>
                <span className="block font-semibold text-zinc-100">Микрофон</span>
                <span className="mt-1 block text-xs text-zinc-500">Добавлять голос с микрофона.</span>
              </span>
            </label>
          </div>
        </section>

        <section className={sectionClass}>
          <div className={sectionTitleClass}>Поведение приложения</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            <label className={checkCardClass}>
              <input className="mt-1 h-4 w-4 shrink-0 accent-violet-500" checked={launchAtLogin} onChange={(event) => setLaunchAtLogin(event.target.checked)} type="checkbox" />
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-semibold text-zinc-100"><Power size={16} />Автозапуск</span>
                <span className="mt-1 block text-xs text-zinc-500">Стартовать вместе с Windows.</span>
              </span>
            </label>
            <label className={checkCardClass}>
              <input className="mt-1 h-4 w-4 shrink-0 accent-violet-500" checked={alwaysOnTop} onChange={(event) => setAlwaysOnTop(event.target.checked)} type="checkbox" />
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-semibold text-zinc-100"><Pin size={16} />Поверх окон</span>
                <span className="mt-1 block text-xs text-zinc-500">Держать TradeTools выше других окон.</span>
              </span>
            </label>
            <label className={checkCardClass}>
              <input className="mt-1 h-4 w-4 shrink-0 accent-violet-500" checked={clipSuccessNotificationsEnabled} onChange={(event) => setClipSuccessNotificationsEnabled(event.target.checked)} type="checkbox" />
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-semibold text-zinc-100"><Clapperboard size={16} />Готовая запись сделки</span>
                <span className="mt-1 block text-xs text-zinc-500">Показывать системное уведомление после сохранения клипа.</span>
              </span>
            </label>
          </div>
        </section>

        <section className={`${sectionClass} xl:col-span-2`}>
          <div className={sectionTitleClass}>Папки и OBS</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {recordingMode === 'obs' && (
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
                <div className="text-xs font-medium text-zinc-500">
                  Папка OBS replay
                  <div className="mt-1 flex gap-2">
                    <input className={`${inputClass.replace('mt-1 ', '')} min-w-0 flex-1`} value={replaySourceDir} onChange={(event) => setReplaySourceDir(event.target.value)} />
                    <Button variant="ghost" onClick={() => void selectDirectory(replaySourceDir, setReplaySourceDir)}><FolderOpen size={16} className="mr-2" />Выбрать</Button>
                  </div>
                </div>
              </>
            )}
            <div className={`text-xs font-medium text-zinc-500 ${recordingMode === 'obs' ? 'md:col-span-2 xl:col-span-4' : 'md:col-span-2 xl:col-span-4'}`}>
              Папка клипов
              <div className="mt-1 flex gap-2">
                <input className={`${inputClass.replace('mt-1 ', '')} min-w-0 flex-1`} value={outputDir} onChange={(event) => setOutputDir(event.target.value)} />
                <Button variant="ghost" onClick={() => void selectDirectory(outputDir, setOutputDir)}><FolderOpen size={16} className="mr-2" />Выбрать</Button>
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="ghost" onClick={() => void clearVideoCache()} disabled={saving || clearingCache}>
              <Trash2 size={16} className="mr-2" />{clearingCache ? 'Очищаем...' : 'Очистить кэш видео'}
            </Button>
            <span className={sectionHintClass}>Удаляются только временные записи, итоговые клипы остаются.</span>
          </div>
          {recordingMode === 'window' && <p className={sectionHintClass}>Если window capture замирает на Windows, выберите мониторы. На macOS может потребоваться разрешение записи экрана.</p>}
        </section>
      </div>

      {message && <p className="mt-4 text-sm text-emerald-300">{message}</p>}
    </Card>
  )
}
