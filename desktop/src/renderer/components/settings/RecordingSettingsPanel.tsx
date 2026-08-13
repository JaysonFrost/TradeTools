import { CircleHelp, Clock3, Clapperboard, ExternalLink, FolderOpen, Link2, Monitor, Pin, Power, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { WindowCaptureSource } from '../../../main/services/recording/windowRecorderService'
import type { AppSettings } from '../../../main/services/settings/settings'
import type { VideoEncoderOption } from '../../../main/services/video/videoEncoderDevices'
import { defaultClipPaddingAfterSeconds, defaultClipPaddingBeforeSeconds, defaultReplayBufferSeconds, longClipAfterExitSeconds, longClipPresetSeconds } from '../../../shared/videoDefaults'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'
import { refreshWindowSourceList } from '../../lib/windowSourceListRefresh'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

export type RecordingSettingsPanelProps = {
  settings?: AppSettings
  onSaved: (settings: AppSettings) => void
}

const inputClass = 'mt-1 w-full border border-[#1c2b3a] bg-[#07111c] px-3 py-2 font-mono text-sm text-[#f0f0f0] outline-none transition-colors duration-150 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/30 focus:ring-offset-2 focus:ring-offset-[#0b1623]'
const sectionClass = 'min-w-0 border-t border-[#1c2b3a] pt-4 first:border-t-0 first:pt-0'
const sectionTitleClass = 'font-mono text-sm font-semibold uppercase tracking-[0.08em] text-cyan-200'
const sectionHintClass = 'mt-1 font-mono text-xs leading-5 text-[#8b9bb4]'
const checkCardClass = 'flex min-w-0 items-start gap-3 border border-[#1c2b3a] bg-[#07111c] p-3 font-mono text-sm leading-5 text-[#8b9bb4] transition-colors duration-150 hover:border-cyan-400/30'
const fieldLabelClass = 'text-xs font-medium uppercase tracking-[0.08em] text-[#8b9bb4]'
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
  <span className="ml-1 inline-flex align-middle text-[#8b9bb4] transition-colors duration-150 hover:text-cyan-200" title={text}>
    <CircleHelp size={13} />
  </span>
)

const toCaptureTarget = (source: WindowCaptureSource): AppSettings['recording']['captureTargets'][number] => ({
  id: source.id,
  name: source.name,
  type: source.type,
  ...(source.processId ? { processId: source.processId } : {}),
  ...(source.displayId ? { displayId: source.displayId } : {})
})

const sourceMatchesCaptureTarget = (source: WindowCaptureSource, target: AppSettings['recording']['captureTargets'][number]): boolean => (
  source.type === target.type && (
    source.id === target.id ||
    source.name === target.name ||
    (source.type === 'screen' && Boolean(source.displayId) && source.displayId === target.displayId)
  )
)

export const RecordingSettingsPanel = ({ settings, onSaved }: RecordingSettingsPanelProps) => {
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
  const [paddingBefore, setPaddingBefore] = useState(String(defaultClipPaddingBeforeSeconds))
  const [paddingAfter, setPaddingAfter] = useState(String(defaultClipPaddingAfterSeconds))
  const [replayBufferSeconds, setReplayBufferSeconds] = useState(String(defaultReplayBufferSeconds))
  const [outputDir, setOutputDir] = useState('')
  const [tmmApiKey, setTmmApiKey] = useState('')
  const [tmmApiKeyConfigured, setTmmApiKeyConfigured] = useState(false)
  const [savingTmmApiKey, setSavingTmmApiKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [clearingCache, setClearingCache] = useState(false)
  const [message, setMessage] = useState('')
  const [editingDraft, setEditingDraft] = useState(false)
  const hydratedSettingsRef = useRef(false)
  const lastSavedSnapshotRef = useRef('')
  const skipNextAutosaveRef = useRef(false)

  const buildSettingsSnapshot = (): string => JSON.stringify({
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
    paddingBefore,
    paddingAfter,
    replayBufferSeconds,
    outputDir
  })

  const buildSettingsSnapshotFromSettings = (nextSettings: AppSettings): string => JSON.stringify({
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
    paddingBefore: String(nextSettings.clip.paddingBeforeSeconds),
    paddingAfter: String(nextSettings.clip.paddingAfterSeconds),
    replayBufferSeconds: String(nextSettings.clip.replayBufferSeconds),
    outputDir: nextSettings.clip.outputDir
  })

  useEffect(() => {
    if (!settings) return
    if (editingDraft && hydratedSettingsRef.current) return

    skipNextAutosaveRef.current = true
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
    setPaddingBefore(String(settings.clip.paddingBeforeSeconds))
    setPaddingAfter(String(settings.clip.paddingAfterSeconds))
    setReplayBufferSeconds(String(settings.clip.replayBufferSeconds))
    setOutputDir(settings.clip.outputDir)
    lastSavedSnapshotRef.current = buildSettingsSnapshotFromSettings(settings)
    hydratedSettingsRef.current = true
  }, [settings, editingDraft])

  const refreshWindowSources = async (options: { announce?: boolean } = {}) => {
    const announce = options.announce !== false
    setLoadingSources(true)
    if (announce) setMessage('')
    try {
      const sources = await refreshWindowSourceList(
        () => getTradeToolsApi().recording.listWindowSources(announce),
        setWindowSources
      )
      if (announce) setMessage(sources.length > 0 ? 'Список окон обновлён' : 'Окна для записи не найдены')
    } catch (error) {
      if (announce) setMessage(error instanceof Error ? error.message : 'Не удалось получить список окон')
    } finally {
      setLoadingSources(false)
    }
  }

  useEffect(() => {
    void refreshWindowSources({ announce: false })
  }, [sourceType])

  useEffect(() => {
    void getTradeToolsApi().recording.listVideoEncoders()
      .then(setVideoEncoderOptions)
      .catch(() => setVideoEncoderOptions([{ id: 'gpu', label: 'Видеокарта (авто)', kind: 'gpu' }, { id: 'cpu', label: 'Процессор', kind: 'cpu' }]))
  }, [])

  useEffect(() => {
    void getTradeToolsApi().tmm.getStatus()
      .then((status) => setTmmApiKeyConfigured(status.apiKeyConfigured))
      .catch(() => setTmmApiKeyConfigured(false))
  }, [])

  useEffect(() => {
    if (videoEncoderOptions.length === 0 || videoEncoderOptions.some((option) => option.id === videoEncoder)) return

    setVideoEncoder(videoEncoderOptions[0]?.id ?? 'cpu')
  }, [videoEncoderOptions, videoEncoder])

  const windowOptions = windowSources.filter((source) => source.type === 'window')
  const screenSources = windowSources.filter((source) => source.type === 'screen')
  const selectedWindowTemporarilyUnavailable = Boolean(
    windowSourceId && !windowOptions.some((source) => source.id === windowSourceId)
  )
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
      const replayBufferSecondsValue = Math.max(Number.isFinite(parsedReplayBufferSeconds) ? parsedReplayBufferSeconds : 0, paddingBeforeSeconds)
      const updated = await api.settings.update({
        recording: {
          mode: 'window',
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
        clip: {
          paddingBeforeSeconds: numberOrUndefined(paddingBefore),
          paddingAfterSeconds: numberOrUndefined(paddingAfter),
          replayBufferSeconds: replayBufferSecondsValue,
          outputDir
        },
        system: {
          launchAtLogin,
          alwaysOnTop,
          clipSuccessNotificationsEnabled
        }
      })
      onSaved(updated)
      lastSavedSnapshotRef.current = snapshot
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
    paddingBefore,
    paddingAfter,
    replayBufferSeconds,
    outputDir,
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
    setMessage('Пресет включён: 10 минут до входа и 2 минуты после выхода. Клип появится примерно через 2 минуты после выхода.')
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

  const saveTmmApiKey = async () => {
    const value = tmmApiKey.trim()
    if (!value) {
      setMessage('Укажите API-ключ TMM')
      return
    }

    setSavingTmmApiKey(true)
    try {
      const status = await getTradeToolsApi().tmm.saveApiKey(value)
      setTmmApiKeyConfigured(status.apiKeyConfigured)
      setTmmApiKey('')
      if (settings) onSaved(settings)
      setMessage(status.sync
        ? `TMM подключён. Найдено ссылок: ${status.sync.matchedCount} из ${status.sync.checkedCount}. Новые клипы будут связываться сразу.`
        : 'TMM подключён. Перезапустите TradeTools один раз, чтобы запустить синхронизацию сохранённым ключом.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось сохранить API-ключ TMM')
    } finally {
      setSavingTmmApiKey(false)
    }
  }

  const clearTmmApiKey = async () => {
    setSavingTmmApiKey(true)
    try {
      const status = await getTradeToolsApi().tmm.clearApiKey()
      setTmmApiKeyConfigured(status.apiKeyConfigured)
      setTmmApiKey('')
      setMessage('Подключение TMM отключено')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось отключить TMM')
    } finally {
      setSavingTmmApiKey(false)
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
      className="rounded-none border-[#1c2b3a] bg-[#0b1623] font-mono shadow-none backdrop-blur-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300">REC.CONFIG // CAPTURE PIPELINE</div>
          <h2 className="m-0 text-xl font-semibold tracking-[-0.03em] text-[#f0f0f0]">Настройки записи</h2>
          <p className="mt-1 text-sm text-[#8b9bb4]">Источник, буфер, качество, звук, уведомления и папки клипов.</p>
        </div>
        {saving && <span className="border border-orange-400/30 bg-orange-400/10 px-3 py-2 text-sm text-orange-200" role="status">Применяем...</span>}
      </div>

      <div className="mt-5 grid gap-6 xl:grid-cols-2">
        <section className={sectionClass}>
          <div className={sectionTitleClass}>Источник записи</div>
          <p className={sectionHintClass}>Встроенная запись пишет выбранное окно терминала или выбранные мониторы.</p>
          <div className="mt-3 inline-flex items-center border border-cyan-400/50 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100">
            <Monitor size={16} className="mr-2" />Встроенная запись
          </div>

          <div className="mt-4 space-y-4">
              <div className="flex border border-[#1c2b3a] bg-[#07111c] p-1">
                <button
                  className={`flex-1 border px-3 py-2 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/40 ${sourceType === 'window' ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-100' : 'border-transparent text-[#8b9bb4] hover:text-[#f0f0f0]'}`}
                  onClick={() => {
                    setSourceType('window')
                    setWindowSourceId('')
                    setWindowSourceName('')
                    setCaptureTargets([])
                  }}
                  aria-pressed={sourceType === 'window'}
                  type="button"
                >
                  Окно терминала
                </button>
                <button
                  className={`flex-1 border px-3 py-2 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/40 ${sourceType === 'screen' ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-100' : 'border-transparent text-[#8b9bb4] hover:text-[#f0f0f0]'}`}
                  onClick={() => {
                    setSourceType('screen')
                    setWindowSourceId('')
                    setWindowSourceName('')
                    setCaptureTargets([])
                  }}
                  aria-pressed={sourceType === 'screen'}
                  type="button"
                >
                  Мониторы
                </button>
              </div>

              {sourceType === 'window' ? (
                <label className="block text-xs font-medium uppercase tracking-[0.08em] text-[#8b9bb4]">
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
                      <option value="">Выберите окно</option>
                      {selectedWindowTemporarilyUnavailable && (
                        <option value={windowSourceId}>{windowSourceName || 'Сохранённое окно'} (временно недоступно)</option>
                      )}
                      {windowOptions.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
                    </select>
                    <Button variant="ghost" onClick={() => void refreshWindowSources({ announce: true })} disabled={loadingSources}>
                      <RefreshCw size={16} className="mr-2" />{loadingSources ? 'Обновляем...' : 'Обновить'}
                    </Button>
                  </div>
                </label>
              ) : (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b9bb4]">Мониторы для записи</div>
                      <p className={sectionHintClass}>Каждый выбранный монитор сохранится отдельным видео. Лишнее можно быстро удалить в очереди проверки.</p>
                    </div>
                    <Button variant="ghost" onClick={() => void refreshWindowSources({ announce: true })} disabled={loadingSources}>
                      <RefreshCw size={16} className="mr-2" />{loadingSources ? 'Обновляем...' : 'Обновить'}
                    </Button>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {screenSources.map((source) => (
                      <label key={source.id} className={checkCardClass}>
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-orange-400"
                          checked={isCaptureTargetSelected(source)}
                          onChange={(event) => toggleScreenCaptureTarget(source, event.target.checked)}
                        />
                        <span>
                          <span className="block font-semibold text-[#f0f0f0]">{source.name}</span>
                          <span className="mt-1 block text-xs text-[#8b9bb4]">Сохранять сделки с этого монитора</span>
                        </span>
                      </label>
                    ))}
                    {screenSources.length === 0 && <span className="text-sm text-[#8b9bb4]">Экраны не найдены</span>}
                  </div>
                </div>
              )}
          </div>
        </section>

        <section className={sectionClass}>
          <div className={sectionTitleClass}>Пресеты и длительность</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <button
              className="border border-emerald-400/30 bg-emerald-400/[0.06] p-4 text-left transition-colors duration-150 hover:bg-emerald-400/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1623]"
              onClick={applyDefaultClipPreset}
              type="button"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-emerald-100"><Clock3 size={16} />Пресет 2с до / 2с после</span>
              <span className="mt-2 block text-xs uppercase tracking-[0.18em] text-emerald-200">буфер 60с</span>
            </button>
            <button
              className="border border-orange-400/30 bg-orange-400/[0.06] p-4 text-left transition-colors duration-150 hover:bg-orange-400/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1623]"
              onClick={applyLongClipPreset}
              type="button"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-orange-100"><Clock3 size={16} />Пресет 10 минут до / 2 минуты после</span>
              <span className="mt-2 block text-xs uppercase tracking-[0.18em] text-orange-200">Тяжёлый режим</span>
            </button>
          </div>
          <p className={sectionHintClass}>Длинный пресет хранит большой локальный буфер и завершает клип только после записи времени после выхода.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className={fieldLabelClass}>
              Секунд до входа
              <input className={inputClass} value={paddingBefore} onChange={(event) => setPaddingBefore(event.target.value)} inputMode="numeric" />
            </label>
            <label className={fieldLabelClass}>
              Секунд после выхода
              <input className={inputClass} value={paddingAfter} onChange={(event) => setPaddingAfter(event.target.value)} inputMode="numeric" />
            </label>
            <label className={fieldLabelClass}>
              <span>Буфер до входа, сек<FieldHint text={replayBufferSecondsHint} /></span>
              <input className={inputClass} value={replayBufferSeconds} onChange={(event) => setReplayBufferSeconds(event.target.value)} inputMode="numeric" />
            </label>
          </div>
        </section>

        <section className={sectionClass}>
          <div className={sectionTitleClass}>Параметры видео</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            <label className={fieldLabelClass}>
              Кодирование
              <select
                className={`${inputClass} appearance-none`}
                value={videoEncoder}
                onChange={(event) => setVideoEncoder(normalizeVideoEncoderValue(event.target.value))}
              >
                {videoEncoderOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <label className={fieldLabelClass}>
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
                <option value="native">Нативное 1:1, высокое качество</option>
                <option value="1080p">Лёгкое 1080p</option>
              </select>
            </label>
            <label className={fieldLabelClass}>
              FPS записи
              <input className={inputClass} value={frameRate} onChange={(event) => setFrameRate(event.target.value)} inputMode="numeric" />
            </label>
            <label className={fieldLabelClass}>
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
                className="mt-1 h-4 w-4 accent-orange-400"
                checked={systemAudioEnabled}
                onChange={(event) => setSystemAudioEnabled(event.target.checked)}
              />
              <span>
                <span className="block font-semibold text-[#f0f0f0]">Звук с ПК</span>
                <span className="mt-1 block text-xs text-[#8b9bb4]">Добавлять системный звук в запись.</span>
              </span>
            </label>
            <label className={checkCardClass}>
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-orange-400"
                checked={microphoneEnabled}
                onChange={(event) => setMicrophoneEnabled(event.target.checked)}
              />
              <span>
                <span className="block font-semibold text-[#f0f0f0]">Микрофон</span>
                <span className="mt-1 block text-xs text-[#8b9bb4]">Добавлять голос с микрофона.</span>
              </span>
            </label>
          </div>
        </section>

        <section className={sectionClass}>
          <div className={sectionTitleClass}>Поведение приложения</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            <label className={checkCardClass}>
              <input className="mt-1 h-4 w-4 shrink-0 accent-orange-400" checked={launchAtLogin} onChange={(event) => setLaunchAtLogin(event.target.checked)} type="checkbox" />
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-semibold text-[#f0f0f0]"><Power className="text-cyan-300" size={16} />Автозапуск</span>
                <span className="mt-1 block text-xs text-[#8b9bb4]">Стартовать вместе с Windows.</span>
              </span>
            </label>
            <label className={checkCardClass}>
              <input className="mt-1 h-4 w-4 shrink-0 accent-orange-400" checked={alwaysOnTop} onChange={(event) => setAlwaysOnTop(event.target.checked)} type="checkbox" />
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-semibold text-[#f0f0f0]"><Pin className="text-cyan-300" size={16} />Поверх окон</span>
                <span className="mt-1 block text-xs text-[#8b9bb4]">Держать TradeTools выше других окон.</span>
              </span>
            </label>
            <label className={checkCardClass}>
              <input className="mt-1 h-4 w-4 shrink-0 accent-orange-400" checked={clipSuccessNotificationsEnabled} onChange={(event) => setClipSuccessNotificationsEnabled(event.target.checked)} type="checkbox" />
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-semibold text-[#f0f0f0]"><Clapperboard className="text-cyan-300" size={16} />Готовая запись сделки</span>
                <span className="mt-1 block text-xs text-[#8b9bb4]">Показывать системное уведомление после сохранения клипа.</span>
              </span>
            </label>
          </div>
        </section>

        <section className={sectionClass}>
          <div className={sectionTitleClass}>TraderMake.Money</div>
          <p className={sectionHintClass}>TradeTools подбирает ближайшую запись дневника с тем же тикером. Время входа и выхода может отличаться до 30 минут, затем ссылка сохраняется внутри клипа.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              className={`${inputClass.replace('mt-1 ', '')} min-w-0 flex-1`}
              value={tmmApiKey}
              onChange={(event) => setTmmApiKey(event.target.value)}
              type="password"
              placeholder={tmmApiKeyConfigured ? 'API-ключ сохранён в Windows' : 'API-ключ TMM'}
            />
            <Button variant="ghost" onClick={() => void saveTmmApiKey()} disabled={savingTmmApiKey}>
              <Link2 size={16} className="mr-2" />{savingTmmApiKey ? 'Сохраняем...' : tmmApiKeyConfigured ? 'Заменить ключ' : 'Подключить TMM'}
            </Button>
            {tmmApiKeyConfigured && <Button variant="ghost" onClick={() => void clearTmmApiKey()} disabled={savingTmmApiKey}>Отключить</Button>}
          </div>
          <Button
            variant="ghost"
            className="mt-3"
            onClick={() => void getTradeToolsApi().links.openExternal('https://tradermake.money/app2/settings?modal=apiIntegrations')}
          >
            <ExternalLink size={16} className="mr-2" />Создать API-ключ TMM
          </Button>
        </section>

        <section className={`${sectionClass} xl:col-span-2`}>
          <div className={sectionTitleClass}>Папки</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className={`${fieldLabelClass} md:col-span-2 xl:col-span-4`}>
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
          <p className={sectionHintClass}>Если захват окна замирает на Windows, выберите мониторы. На macOS может потребоваться разрешение записи экрана.</p>
        </section>
      </div>

      {message && <p className="mt-4 border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300" role="status">{message}</p>}
    </Card>
  )
}
