import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, FileText, FolderOpen, ListX, Pause, PictureInPicture2, Play, RefreshCw, Search, Square, Trash2, Video, X, XCircle } from 'lucide-react'
import type { FreeRecordingStatus, WindowRecorderStatus } from '../../main/services/recording/windowRecorderService'
import type { AppSettings } from '../../main/services/settings/settings'
import type { TerminalTradeRecordingStatus } from '../../main/services/trades/terminalTradeRecorder'
import type { ClipProcessingStatus, ClipQueueItem } from '../../main/services/trades/tradeClipPipeline'
import type { AppLogSnapshot } from '../../main/services/logging/appLogService'
import type { RecordingControlStatus } from '../../shared/recordingControl'
import { IntegrationStatusCard } from '../components/integrations/IntegrationStatusCard'
import { TopBar } from '../components/layout/TopBar'
import { SetupWizard } from '../components/setup/SetupWizard'
import { RecordingSettingsPanel } from '../components/settings/RecordingSettingsPanel'
import { ProxyVaultPanel, type ProxyVaultRuntimeState } from '../components/settings/ProxyVaultPanel'
import { WindowRecorderController } from '../components/recording/WindowRecorderController'
import { SystemSettingsPanel } from '../components/settings/SystemSettingsPanel'
import { SupportDeveloperPage } from '../components/support/SupportDeveloperPage'
import { ClipCard } from '../components/trade/ClipCard'
import { filterClips, getClipDayGroups, getClipsForDate, getClipsForPeriod, type ClipSortDirection, type ClipSortKey } from '../lib/clipList'
import type { AppPage } from '../lib/navigation'
import { getTradeToolsApi } from '../lib/tradeToolsApi'
import type { ProxyChainSetupProgress } from '../../preload'

export type DashboardProps = {
  activePage: AppPage
}

type SetupWizardMode = Exclude<AppPage, 'support'>

type VideoPageProps = {
  settings?: AppSettings
  clips: ClipQueueItem[]
  clipMessage: string
  windowRecorder?: WindowRecorderStatus
  freeRecording?: FreeRecordingStatus
  terminalTrade: TerminalTradeRecordingStatus
  backgroundRecordingEnabled: boolean
  onBackgroundRecordingStart: () => void
  onBackgroundRecordingStop: () => void
  onShowRecordingWidget: () => void
  onCreateBuffer: () => void
  onCancelClipRender: (jobId?: string) => void
  onClearQueue: () => void
  onDeleteQueueFiles: () => void
  onOpenClipFolder: () => void
  onClipDeleted: (clip: ClipQueueItem) => void
  onClipRenamed: (clip: ClipQueueItem) => void
  onClipMessage: (message: string) => void
  onFreeRecordingStart: () => void
  onFreeRecordingPause: () => void
  onFreeRecordingResume: () => void
  onFreeRecordingFinish: () => void
  onSettingsSaved: (settings: AppSettings) => void
  clipProcessing?: ClipProcessingStatus
  logs: AppLogSnapshot
  onRefreshLogs: () => void
  onCopyLogs: () => void
  onShowLogFile: () => void
}

type ProxyPageProps = {
  settings?: AppSettings
  runtimeState: ProxyVaultRuntimeState
  onRuntimeStateChange: React.Dispatch<React.SetStateAction<ProxyVaultRuntimeState>>
  onSettingsSaved: (settings: AppSettings) => void
}

const dashboardRefreshIntervalMs = 5_000

const ClipProcessingBar = ({ status, onCancel }: { status: ClipProcessingStatus, onCancel: (jobId?: string) => void }) => {
  const activeJobs = status.activeJobs?.length
    ? status.activeJobs
    : status.active
      ? [{
          id: status.activeJobId ?? 'local-processing',
          title: status.title || 'Клип сделки',
          message: status.message,
          progressPercent: status.progressPercent,
          startedAtMs: status.startedAtMs
        }]
      : []
  const queuedJobs = status.queuedJobs ?? []

  return (
    <div className="border border-[#56b5d5]/40 bg-[#0b1623]/95 p-3 shadow-[inset_3px_0_0_#ff9f30]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold uppercase tracking-[0.08em] text-[#f0f0f0]">Обработка видео</div>
        <div className="text-xs text-[#8b9bb4]">Обрабатывается: {activeJobs.length} · Ожидает: {queuedJobs.length}</div>
      </div>
      <div className="space-y-2">
        {activeJobs.map((job) => (
          <div key={job.id} className="border border-[#56b5d5]/25 bg-[#102435]/90 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-[#f0f0f0]">{job.title}</div>
                <div className="mt-0.5 truncate text-[11px] text-[#8b9bb4]">{job.message}</div>
              </div>
              <span className="text-[11px] font-semibold text-[#ff9f30]">{Math.round(job.progressPercent)}%</span>
              <button className="inline-flex min-h-7 cursor-pointer items-center border border-red-400/40 bg-red-500/10 px-2 text-[11px] font-semibold text-red-100 transition-colors duration-150 hover:bg-red-500/20" onClick={() => onCancel(job.id === 'local-processing' ? undefined : job.id)} type="button">
                <XCircle size={12} className="mr-1" />Отменить
              </button>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden border border-[#56b5d5]/20 bg-[#1c2b3a]">
              <div className="h-full bg-[#ff9f30]" style={{ width: `${Math.max(6, Math.min(100, job.progressPercent))}%` }} />
            </div>
          </div>
        ))}
        {queuedJobs.map((job) => (
          <div key={job.id} className="flex min-w-0 items-center gap-2 border border-[#56b5d5]/20 bg-[#0e1e2c]/90 px-3 py-2">
            <span className="shrink-0 border border-[#56b5d5]/25 bg-[#122536] px-1.5 py-0.5 text-[10px] font-semibold text-[#8b9bb4]">Ожидает</span>
            <span className="min-w-0 flex-1 truncate text-xs text-[#f0f0f0]/85">{job.title}</span>
            <button className="inline-flex min-h-7 cursor-pointer items-center border border-red-400/30 px-2 text-[11px] font-semibold text-red-200 transition-colors duration-150 hover:bg-red-500/10" onClick={() => onCancel(job.id)} type="button">
              <X size={12} className="mr-1" />Убрать
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

const formatSeconds = (value: number): string => `${Math.max(0, Math.round(value))}с`

const createStoppedWindowRecorderStatus = (settings: AppSettings): WindowRecorderStatus => ({
  enabled: true,
  active: false,
  backend: 'browser',
  mode: 'window',
  sourceId: settings.recording.windowSourceId,
  sourceName: settings.recording.windowSourceName,
  segmentCount: 0,
  bufferedSeconds: 0,
  lastSegmentAtMs: 0,
  message: 'Фоновая запись остановлена'
})

const RecordingStatusPanel = ({
  settings,
  windowRecorder,
  terminalTrade,
  backgroundRecordingEnabled,
  onBackgroundRecordingStart,
  onBackgroundRecordingStop,
  onShowRecordingWidget,
  onCreateBuffer
}: {
  settings?: AppSettings
  windowRecorder?: WindowRecorderStatus
  terminalTrade: TerminalTradeRecordingStatus
  backgroundRecordingEnabled: boolean
  onBackgroundRecordingStart: () => void
  onBackgroundRecordingStop: () => void
  onShowRecordingWidget: () => void
  onCreateBuffer: () => void
}) => {
  const targetSeconds = Math.max(1, Math.round(settings?.clip.replayBufferSeconds ?? 1))
  const bufferedSeconds = Math.min(targetSeconds, Math.max(0, Math.round(windowRecorder?.bufferedSeconds ?? 0)))
  const progressPercent = Math.min(100, Math.max(0, bufferedSeconds / targetSeconds * 100))
  const sourceName = windowRecorder?.sourceName || settings?.recording.windowSourceName || settings?.recording.windowSourceId || 'Источник не выбран'
  const hasActiveTrade = terminalTrade.active
  const detectedTerminalNames = terminalTrade.availableSources.map((source) => ({
    tigertrade: 'TigerTrade',
    vataga: 'Vataga',
    metascalp: 'MetaScalp'
  })[source])
  const terminalStatus = `Пишем сделку, позиций: ${terminalTrade.activeTradeCount}. После закрытия TradeTools сам сохранит клип.`
  const activeTradeSummary = `${terminalTrade.activeTradeCount} поз.`
  const showStatusBadge = !backgroundRecordingEnabled || hasActiveTrade
  const statusText = !backgroundRecordingEnabled
    ? 'Фон остановлен'
    : hasActiveTrade
      ? 'Пишем сделку'
      : ''
  const message = !backgroundRecordingEnabled
    ? 'Автоклипы и свободная запись сейчас выключены.'
    : hasActiveTrade
      ? terminalStatus
      : ''
  const buttonBase = 'inline-flex min-h-10 cursor-pointer items-center justify-center border px-4 text-sm font-semibold tracking-[0.02em] transition-colors duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <section className="col-span-12 border border-[#56b5d5]/40 bg-[#0d1d2b]/95 p-4 shadow-[inset_3px_0_0_#ff9f30]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-base font-semibold uppercase tracking-[0.08em] text-[#f0f0f0]">Автозапись терминалов</h2>
            {showStatusBadge && (
              <span className={`border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.06em] ${statusText === 'Пишем сделку' ? 'border-[#00ff9d]/40 bg-[#00ff9d]/10 text-[#00ff9d]' : statusText === 'Фон остановлен' ? 'border-[#8b9bb4]/25 bg-[#07101a]/70 text-[#8b9bb4]' : 'border-[#ff9f30]/40 bg-[#ff9f30]/10 text-[#ffb45f]'}`}>
                {statusText}
              </span>
            )}
          </div>
          {message && <p className="mt-2 text-sm leading-6 text-[#8b9bb4]">{message}</p>}
          {backgroundRecordingEnabled && detectedTerminalNames.length > 0 && (
            <p className="mt-2 text-xs leading-5 text-[#8b9bb4]">Журналы терминалов: <span className="text-[#f0f0f0]">{detectedTerminalNames.join(', ')}</span></p>
          )}
          {hasActiveTrade && (
            <div className="mt-3 grid gap-2 text-xs text-[#8b9bb4] sm:grid-cols-3">
              <div className="border-l border-[#56b5d5]/35 pl-2">Источник: <span className="text-[#f0f0f0]">{sourceName}</span></div>
              <div className="border-l border-[#56b5d5]/35 pl-2">Буфер: <span className="text-[#f0f0f0]">{formatSeconds(bufferedSeconds)} / {formatSeconds(targetSeconds)}</span></div>
              <div className="border-l border-[#56b5d5]/35 pl-2">Сделки: <span className="text-[#f0f0f0]">{activeTradeSummary}</span></div>
            </div>
          )}
          {terminalTrade.lastError && <p className="mt-2 text-xs leading-5 text-[#ffb45f]">{terminalTrade.lastError}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
            {backgroundRecordingEnabled ? (
              <button className={`${buttonBase} border-[#ff9f30] bg-[#ff9f30] text-[#0b1623] shadow-[3px_3px_0_rgba(0,0,0,0.25)] hover:bg-[#e68c22]`} onClick={onBackgroundRecordingStop} type="button">
                <Square size={16} className="mr-2" />Остановить фоновую запись
              </button>
            ) : (
              <button className={`${buttonBase} border-[#ff9f30] bg-[#ff9f30] text-[#0b1623] shadow-[3px_3px_0_rgba(0,0,0,0.25)] hover:bg-[#e68c22]`} onClick={onBackgroundRecordingStart} disabled={!settings} type="button">
                <Play size={16} className="mr-2" />Включить фоновую запись
              </button>
            )}
            <button className={`${buttonBase} border-[#56b5d5]/60 bg-[#56b5d5]/10 text-[#b9edff] hover:bg-[#56b5d5]/20`} onClick={onCreateBuffer} disabled={!settings || !backgroundRecordingEnabled} type="button">
              <Video size={16} className="mr-2" />Сохранить последний буфер
            </button>
            <button className={`${buttonBase} border-[#8b9bb4]/30 bg-[#1c2b3a]/65 text-[#d6e0ee] hover:border-[#56b5d5]/60 hover:bg-[#56b5d5]/10`} onClick={onShowRecordingWidget} type="button">
              <PictureInPicture2 size={16} className="mr-2" />Мини-виджет
            </button>
        </div>
      </div>
      {hasActiveTrade && (
        <div className="mt-4 h-1.5 overflow-hidden border border-[#56b5d5]/20 bg-[#1c2b3a]">
          <div
            className="h-full bg-[#00ff9d]"
            style={{ width: `${progressPercent > 0 ? Math.max(3, progressPercent) : 0}%` }}
          />
        </div>
      )}
    </section>
  )
}

const FreeRecordingControls = ({
  settings,
  freeRecording,
  onStart,
  onPause,
  onResume,
  onFinish,
  backgroundRecordingEnabled
}: {
  settings?: AppSettings
  freeRecording?: FreeRecordingStatus
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onFinish: () => void
  backgroundRecordingEnabled: boolean
}) => {
  const isActive = Boolean(freeRecording?.active)
  const isPaused = Boolean(freeRecording?.paused)
  const disabled = !settings || !backgroundRecordingEnabled
  const buttonBase = 'inline-flex min-h-10 cursor-pointer items-center justify-center border px-4 text-sm font-semibold tracking-[0.02em] transition-colors duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50'
  const startedAt = freeRecording?.startedAtMs ? new Date(freeRecording.startedAtMs).toLocaleTimeString('ru-RU') : ''

  return (
    <section className="col-span-12 border border-[#56b5d5]/35 bg-[#0d1d2b]/95 p-4 shadow-[inset_3px_0_0_#56b5d5]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-base font-semibold uppercase tracking-[0.08em] text-[#f0f0f0]">Свободная запись</h2>
            <span className={`border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.06em] ${isActive ? isPaused ? 'border-[#ff9f30]/40 bg-[#ff9f30]/10 text-[#ffb45f]' : 'border-[#00ff9d]/40 bg-[#00ff9d]/10 text-[#00ff9d]' : 'border-[#8b9bb4]/25 bg-[#07101a]/70 text-[#8b9bb4]'}`}>
              {isActive ? isPaused ? 'Пауза' : 'Идёт запись' : 'Готово'}
            </span>
          </div>
          <p className="mt-1 text-sm leading-6 text-[#8b9bb4]">
            {disabled
              ? 'Сначала включите фоновую запись.'
              : isActive
                ? `${freeRecording?.message ?? 'Записываем терминал'}${startedAt ? ` с ${startedAt}` : ''}.`
                : 'Записывает выбранное окно или экран без привязки к сделкам.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isActive && (
            <button className={`${buttonBase} border-[#ff9f30] bg-[#ff9f30] text-[#0b1623] shadow-[3px_3px_0_rgba(0,0,0,0.25)] hover:bg-[#e68c22]`} onClick={onStart} disabled={disabled} type="button">
              <Video size={16} className="mr-2" />Начать
            </button>
          )}
          {isActive && (
            <button className={`${buttonBase} border-[#ff9f30] bg-[#ff9f30] text-[#0b1623] shadow-[3px_3px_0_rgba(0,0,0,0.25)] hover:bg-[#e68c22]`} onClick={onFinish} type="button">
              <Square size={16} className="mr-2" />Завершить
            </button>
          )}
          {isActive && !isPaused && (
            <button className={`${buttonBase} border-[#56b5d5]/55 bg-[#56b5d5]/10 text-[#b9edff] hover:bg-[#56b5d5]/20`} onClick={onPause} type="button">
              <Pause size={16} className="mr-2" />Пауза
            </button>
          )}
          {isActive && isPaused && (
            <button className={`${buttonBase} border-[#ff9f30] bg-[#ff9f30] text-[#0b1623] shadow-[3px_3px_0_rgba(0,0,0,0.25)] hover:bg-[#e68c22]`} onClick={onResume} type="button">
              <Play size={16} className="mr-2" />Продолжить
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

const DiagnosticsLogPanel = ({
  logs,
  onRefresh,
  onCopy,
  onShowFile
}: {
  logs: AppLogSnapshot
  onRefresh: () => void
  onCopy: () => void
  onShowFile: () => void
}) => (
  <details className="col-span-12 border border-[#56b5d5]/35 bg-[#0d1d2b]/95 p-4 shadow-[inset_3px_0_0_#56b5d5]">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-base font-semibold uppercase tracking-[0.08em] text-[#f0f0f0] [&::-webkit-details-marker]:hidden">
      <span className="flex items-center gap-2">
        <FileText size={16} className="text-[#56b5d5]" />
        Логи
      </span>
      <span className="text-xs font-medium text-[#8b9bb4]">Показать</span>
    </summary>
    <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <p className="min-w-0 break-all text-xs text-[#8b9bb4]">{logs.path || 'Файл логов будет создан после первого события.'}</p>
      <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
        <button className="inline-flex min-h-9 cursor-pointer items-center border border-[#56b5d5]/45 bg-[#56b5d5]/10 px-3 text-xs font-semibold text-[#b9edff] transition-colors duration-150 hover:bg-[#56b5d5]/20" onClick={onRefresh} type="button">
          <RefreshCw size={14} className="mr-2" />Обновить
        </button>
        <button className="inline-flex min-h-9 cursor-pointer items-center border border-[#ff9f30] bg-[#ff9f30] px-3 text-xs font-semibold text-[#0b1623] transition-colors duration-150 hover:bg-[#e68c22] disabled:cursor-not-allowed disabled:opacity-50" onClick={onCopy} disabled={!logs.text} type="button">
          <Copy size={14} className="mr-2" />Скопировать текст
        </button>
        <button className="inline-flex min-h-9 cursor-pointer items-center border border-[#8b9bb4]/30 bg-[#1c2b3a]/65 px-3 text-xs font-semibold text-[#d6e0ee] transition-colors duration-150 hover:border-[#56b5d5]/60 hover:bg-[#56b5d5]/10" onClick={onShowFile} type="button">
          <FileText size={14} className="mr-2" />Открыть файл
        </button>
      </div>
    </div>
    <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words border border-[#56b5d5]/25 bg-[#07101a]/90 p-3 text-xs leading-5 text-[#b9c6d8]">
      {logs.text || 'Лог пока пуст. Ошибки сохранения клипов появятся здесь.'}
    </pre>
  </details>
)

type ClipQueueSectionProps = Pick<VideoPageProps,
  'clipMessage' | 'clipProcessing' | 'clips' | 'onCancelClipRender' | 'onClearQueue' | 'onClipDeleted' | 'onClipRenamed' | 'onDeleteQueueFiles' | 'onOpenClipFolder' | 'onClipMessage'
>

const ClipQueueSection = ({ clips, clipMessage, clipProcessing, onCancelClipRender, onClearQueue, onDeleteQueueFiles, onOpenClipFolder, onClipDeleted, onClipRenamed, onClipMessage }: ClipQueueSectionProps) => {
  const [selectedClipPaths, setSelectedClipPaths] = useState<Set<string>>(new Set())
  const [customDate, setCustomDate] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sort, setSort] = useState<ClipSortKey>('date')
  const [sortDirection, setSortDirection] = useState<ClipSortDirection>('desc')
  const [deletingSelected, setDeletingSelected] = useState(false)
  const filteredClips = useMemo(() => filterClips(clips, searchQuery), [clips, searchQuery])
  const groups = useMemo(() => getClipDayGroups(filteredClips, sort, sortDirection), [filteredClips, sort, sortDirection])
  const selectedClips = useMemo(() => clips.filter((clip) => selectedClipPaths.has(clip.metadataPath)), [clips, selectedClipPaths])
  const allVisibleSelected = filteredClips.length > 0 && filteredClips.every((clip) => selectedClipPaths.has(clip.metadataPath))

  useEffect(() => {
    const availablePaths = new Set(clips.map((clip) => clip.metadataPath))
    setSelectedClipPaths((current) => {
      const next = new Set([...current].filter((path) => availablePaths.has(path)))
      return next.size === current.size ? current : next
    })
  }, [clips])

  const selectClips = (nextClips: ClipQueueItem[]) => setSelectedClipPaths(new Set(nextClips.map((clip) => clip.metadataPath)))
  const toggleClip = (clip: ClipQueueItem, selected: boolean) => {
    setSelectedClipPaths((current) => {
      const next = new Set(current)
      if (selected) next.add(clip.metadataPath)
      else next.delete(clip.metadataPath)
      return next
    })
  }

  const deleteSelected = async () => {
    if (selectedClips.length === 0 || !window.confirm(`Удалить ${selectedClips.length} выбранных видео с диска? Это действие нельзя отменить.`)) return

    setDeletingSelected(true)
    try {
      const results = await Promise.allSettled(selectedClips.map(async (clip) => getTradeToolsApi().clips.deleteFile(clip.metadataPath)))
      const failedPaths = new Set<string>()
      let deletedCount = 0
      results.forEach((result, index) => {
        const clip = selectedClips[index]
        if (!clip) return
        if (result.status === 'fulfilled') {
          deletedCount += 1
          onClipDeleted(clip)
        } else {
          failedPaths.add(clip.metadataPath)
        }
      })
      setSelectedClipPaths(failedPaths)
      onClipMessage(failedPaths.size > 0
        ? `Удалено видео: ${deletedCount}. Не удалось удалить: ${failedPaths.size}`
        : `Удалено выбранных видео: ${deletedCount}`)
    } finally {
      setDeletingSelected(false)
    }
  }

  const selectionButtonClass = 'inline-flex min-h-8 cursor-pointer items-center border border-[#56b5d5]/30 bg-[#102435]/70 px-2.5 text-[11px] font-semibold text-[#d6e0ee] transition-colors duration-150 hover:border-[#56b5d5]/65 hover:bg-[#56b5d5]/10 disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <section className="col-span-12 border border-[#56b5d5]/40 bg-[#0d1d2b]/95 p-4 shadow-[inset_3px_0_0_#56b5d5]">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
        <h2 className="m-0 text-xl font-semibold uppercase tracking-[0.06em] text-[#f0f0f0]">Очередь проверки</h2>
          <p className="mt-1 text-xs text-[#8b9bb4]">Выберите нужные видео, чтобы удалить только их. «Очистить» убирает из списка, «Удалить файл» стирает с диска.</p>
          {clipMessage && <p className="mt-2 border-l-2 border-[#ff9f30] pl-2 text-sm text-[#ffb45f]">{clipMessage}</p>}
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <button className="inline-flex min-h-8 cursor-pointer items-center whitespace-nowrap border border-[#56b5d5]/45 bg-[#56b5d5]/10 px-2.5 text-xs font-semibold text-[#b9edff] transition-colors duration-150 hover:bg-[#56b5d5]/20" onClick={onOpenClipFolder} type="button">
            <FolderOpen size={14} className="mr-1.5" />Открыть папку
          </button>
          <button className="inline-flex min-h-8 cursor-pointer items-center whitespace-nowrap border border-[#8b9bb4]/30 bg-[#1c2b3a]/65 px-2.5 text-xs font-semibold text-[#d6e0ee] transition-colors duration-150 hover:border-[#56b5d5]/60 hover:bg-[#56b5d5]/10 disabled:cursor-not-allowed disabled:opacity-50" onClick={onClearQueue} disabled={clips.length === 0} type="button">
            <ListX size={14} className="mr-1.5" />Убрать все из списка
          </button>
          <button className="inline-flex min-h-8 cursor-pointer items-center whitespace-nowrap border border-red-500/40 bg-red-500/10 px-2.5 text-xs font-semibold text-red-100 transition-colors duration-150 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50" onClick={onDeleteQueueFiles} disabled={clips.length === 0} type="button">
            <Trash2 size={14} className="mr-1.5" />Удалить все видео
          </button>
        </div>
      </div>
      <div className="mb-3 border border-[#56b5d5]/25 bg-[#091522]/90 p-3">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Поиск по пути, имени, тикеру или дате</span>
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#56b5d5]" />
            <input
              className="min-h-10 w-full border border-[#56b5d5]/30 bg-[#07101a]/85 py-2 pl-9 pr-10 text-sm text-[#f0f0f0] outline-none transition-colors duration-150 placeholder:text-[#8b9bb4]/65 focus:border-[#ff9f30] focus:bg-[#07101a] focus:ring-2 focus:ring-[#ff9f30]/25 focus:ring-offset-2 focus:ring-offset-[#0b1623]"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Поиск по пути, имени, тикеру или дате"
              aria-label="Поиск по пути, имени, тикеру или дате"
              spellCheck={false}
              type="text"
            />
            {searchQuery && (
              <button
                className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center text-[#8b9bb4] transition-colors duration-150 hover:bg-[#56b5d5]/10 hover:text-[#f0f0f0]"
                onClick={() => setSearchQuery('')}
                aria-label="Очистить поиск"
                title="Очистить поиск"
                type="button"
              >
                <X size={14} />
              </button>
            )}
          </label>
          <span className="shrink-0 text-xs text-[#8b9bb4]">Найдено <span className="font-semibold text-[#00ff9d]">{filteredClips.length}</span> из {clips.length}</span>
        </div>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button className={selectionButtonClass} onClick={() => selectClips(allVisibleSelected ? [] : filteredClips)} disabled={filteredClips.length === 0} type="button">
              {allVisibleSelected ? 'Снять выбор' : 'Выбрать все'}
            </button>
            <button className={selectionButtonClass} onClick={() => selectClips(getClipsForPeriod(filteredClips, 'day'))} disabled={filteredClips.length === 0} type="button">Выбрать сегодня</button>
            <button className={selectionButtonClass} onClick={() => selectClips(getClipsForPeriod(filteredClips, 'week'))} disabled={filteredClips.length === 0} type="button">Выбрать неделю</button>
            <button className={selectionButtonClass} onClick={() => selectClips(getClipsForPeriod(filteredClips, 'month'))} disabled={filteredClips.length === 0} type="button">Выбрать месяц</button>
            <label className="flex min-h-9 items-center gap-2 border border-[#56b5d5]/30 bg-[#07101a]/75 px-2 text-xs text-[#8b9bb4] focus-within:border-[#ff9f30]">
              <span className="sr-only">Отдельная дата</span>
              <input className="bg-transparent text-xs text-[#f0f0f0] outline-none [color-scheme:dark]" value={customDate} onChange={(event) => setCustomDate(event.target.value)} type="date" />
              <button className="font-semibold text-[#ffb45f] disabled:opacity-50" onClick={() => selectClips(getClipsForDate(filteredClips, customDate))} disabled={!customDate || filteredClips.length === 0} type="button">Выбрать дату</button>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-[#8b9bb4]">Сортировка</span>
            <select className="min-h-9 border border-[#56b5d5]/30 bg-[#07101a]/75 px-3 text-xs font-semibold text-[#f0f0f0] outline-none focus:border-[#ff9f30]" value={sort} onChange={(event) => setSort(event.target.value as ClipSortKey)} aria-label="Сортировка видео">
              <option value="date">Дата</option>
              <option value="name">Имя</option>
              <option value="duration">Длительность</option>
            </select>
            <button className={selectionButtonClass} onClick={() => setSortDirection((current) => current === 'asc' ? 'desc' : 'asc')} type="button">
              {sortDirection === 'asc' ? 'По возрастанию' : 'По убыванию'}
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#56b5d5]/20 pt-3">
          <span className="text-xs text-[#8b9bb4]">Выбрано: <span className="font-semibold text-[#f0f0f0]">{selectedClips.length}</span> из {clips.length}</span>
          <button className="inline-flex min-h-9 cursor-pointer items-center border border-red-500/40 bg-red-500/10 px-3 text-xs font-semibold text-red-100 transition-colors duration-150 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void deleteSelected()} disabled={selectedClips.length === 0 || deletingSelected} type="button">
            <Trash2 size={14} className="mr-2" />{deletingSelected ? 'Удаляем...' : 'Удалить выбранные'}
          </button>
        </div>
      </div>
      {clipProcessing?.active && <div className="mb-3"><ClipProcessingBar status={clipProcessing} onCancel={onCancelClipRender} /></div>}
      <div className="max-h-[620px] space-y-3 overflow-y-auto pr-1">
        {groups.length > 0 ? groups.map((group) => (
          <section key={group.key} aria-label={`Видео за ${group.label}`}>
            <div className="sticky top-0 z-10 mb-2 flex items-center justify-between border-b border-[#56b5d5]/25 bg-[#0b1623]/95 py-1 backdrop-blur">
              <h3 className="m-0 capitalize text-sm font-semibold uppercase tracking-[0.06em] text-[#d6e0ee]">{group.label}</h3>
              <span className="text-xs text-[#00ff9d]">{group.clips.length}</span>
            </div>
            <div className="space-y-2">
              {group.clips.map((clip) => (
                <ClipCard
                  key={clip.id}
                  clip={clip}
                  selected={selectedClipPaths.has(clip.metadataPath)}
                  onSelectedChange={(selected) => toggleClip(clip, selected)}
                  onDeleted={onClipDeleted}
                  onRenamed={onClipRenamed}
                />
              ))}
            </div>
          </section>
        )) : <div className="border border-dashed border-[#56b5d5]/30 bg-[#07101a]/40 p-6 text-sm text-[#8b9bb4]">
          {clips.length > 0 && searchQuery.trim() ? 'По запросу ничего не найдено.' : 'Пока нет клипов в очереди.'}
        </div>}
      </div>
    </section>
  )
}

const VideoPage = ({ settings, clips, clipMessage, windowRecorder, freeRecording, terminalTrade, backgroundRecordingEnabled, onBackgroundRecordingStart, onBackgroundRecordingStop, onShowRecordingWidget, onCreateBuffer, onCancelClipRender, onClearQueue, onDeleteQueueFiles, onOpenClipFolder, onClipDeleted, onClipRenamed, onClipMessage, onFreeRecordingStart, onFreeRecordingPause, onFreeRecordingResume, onFreeRecordingFinish, onSettingsSaved, clipProcessing, logs, onRefreshLogs, onCopyLogs, onShowLogFile }: VideoPageProps) => (
    <div
      data-theme="engineering-blueprint"
      className="mono relative mt-6 grid grid-cols-12 gap-4 overflow-hidden border border-[#56b5d5]/30 bg-[#0b1623] p-4 pb-8 text-[#f0f0f0] shadow-[inset_0_0_48px_rgba(36,184,230,0.06)]"
      style={{
        backgroundImage: 'linear-gradient(rgba(36, 184, 230, 0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(36, 184, 230, 0.055) 1px, transparent 1px)',
        backgroundSize: '24px 24px'
      }}
    >
      <RecordingStatusPanel
        settings={settings}
        windowRecorder={windowRecorder}
        terminalTrade={terminalTrade}
        backgroundRecordingEnabled={backgroundRecordingEnabled}
        onBackgroundRecordingStart={onBackgroundRecordingStart}
        onBackgroundRecordingStop={onBackgroundRecordingStop}
        onShowRecordingWidget={onShowRecordingWidget}
        onCreateBuffer={onCreateBuffer}
      />
      <FreeRecordingControls
        settings={settings}
        freeRecording={freeRecording}
        onStart={onFreeRecordingStart}
        onPause={onFreeRecordingPause}
        onResume={onFreeRecordingResume}
        onFinish={onFreeRecordingFinish}
        backgroundRecordingEnabled={backgroundRecordingEnabled}
      />
      <DiagnosticsLogPanel logs={logs} onRefresh={onRefreshLogs} onCopy={onCopyLogs} onShowFile={onShowLogFile} />
      <ClipQueueSection
        clips={clips}
        clipMessage={clipMessage}
        clipProcessing={clipProcessing}
        onCancelClipRender={onCancelClipRender}
        onClearQueue={onClearQueue}
        onDeleteQueueFiles={onDeleteQueueFiles}
        onOpenClipFolder={onOpenClipFolder}
        onClipDeleted={onClipDeleted}
        onClipRenamed={onClipRenamed}
        onClipMessage={onClipMessage}
      />
      <section className="col-span-12 space-y-4 border border-[#56b5d5]/30 bg-[#0d1d2b]/90 p-1">
        <RecordingSettingsPanel settings={settings} onSaved={onSettingsSaved} />
      </section>
    </div>
  )

const ProxyPage = ({ settings, runtimeState, onRuntimeStateChange, onSettingsSaved }: ProxyPageProps) => {
  const proxyStatuses = useMemo(() => [
    {
      name: 'Серверы',
      description: settings?.proxies.length
        ? `Сохранено серверов: ${settings.proxies.length}. Напоминания за ${settings.system.paymentReminderDaysBefore} дн.`
        : 'Добавьте IP, SSH-доступ, число оплаты и сайт хостинга.',
      status: settings?.proxies.length ? 'Настроено' : 'Пусто',
      tone: settings?.proxies.length ? 'success' as const : 'neutral' as const
    },
    {
      name: 'Связки',
      description: 'Добавьте серверы, расставьте их в нужном порядке и запустите SSH-проверку для настроек терминала.',
      status: 'Готово к сборке',
      tone: 'purple' as const
    }
  ], [settings])

  return (
    <div className="mt-6 grid grid-cols-12 gap-4 pb-8">
      <section className="col-span-12 grid gap-4 lg:grid-cols-2">
        {proxyStatuses.map((status) => <IntegrationStatusCard key={status.name} {...status} />)}
      </section>
      <ProxyVaultPanel
        settings={settings}
        runtimeState={runtimeState}
        onRuntimeStateChange={onRuntimeStateChange}
        onSaved={onSettingsSaved}
      />
      <section className="col-span-12">
        <SystemSettingsPanel mode="proxy" settings={settings} onSaved={onSettingsSaved} />
      </section>
    </div>
  )
}

export const Dashboard = ({ activePage }: DashboardProps) => {
  const [appVersion, setAppVersion] = useState<string>()
  const [settings, setSettings] = useState<AppSettings>()
  const [clips, setClips] = useState<ClipQueueItem[]>([])
  const [clipMessage, setClipMessage] = useState('')
  const [localClipProcessing, setLocalClipProcessing] = useState<ClipProcessingStatus>({
    active: false,
    title: '',
    message: '',
    progressPercent: 0
  })
  const [remoteClipProcessing, setRemoteClipProcessing] = useState<ClipProcessingStatus>({
    active: false,
    title: '',
    message: '',
    progressPercent: 0
  })
  const [windowRecorder, setWindowRecorder] = useState<WindowRecorderStatus>()
  const [backgroundRecordingEnabled, setBackgroundRecordingEnabled] = useState(false)
  const backgroundRecordingEnabledRef = useRef(false)
  const [recordingEnsureKey, setRecordingEnsureKey] = useState(0)
  const [freeRecording, setFreeRecording] = useState<FreeRecordingStatus>()
  const [terminalTrade, setTerminalTrade] = useState<TerminalTradeRecordingStatus>({
    active: false,
    startedAtMs: 0,
    message: 'Автоматически ждём сделки Vataga, TigerTrade или MetaScalp',
    source: 'multi-terminal',
    availableSources: [],
    activeTradeCount: 0
  })
  const [appLogs, setAppLogs] = useState<AppLogSnapshot>({
    path: '',
    text: ''
  })
  const lastLogsRefreshAtRef = useRef(0)
  const [setupWizardMode, setSetupWizardMode] = useState<SetupWizardMode>()
  const [proxyVaultRuntime, setProxyVaultRuntime] = useState<ProxyVaultRuntimeState>({
    chainCheckProgress: [],
    chainSetupProgress: []
  })
  const setBackgroundRecording = (enabled: boolean) => {
    backgroundRecordingEnabledRef.current = enabled
    setBackgroundRecordingEnabled(enabled)
  }

  const loadLocalState = async () => {
    try {
      const api = getTradeToolsApi()
      const [version, nextSettings, pendingClips, nextClipProcessing, nextFreeRecording, nextTerminalTrade, nextLogs, controlStatus] = await Promise.all([
        api.app.getVersion(),
        api.settings.get(),
        api.clips.listPending(),
        api.clips.getProcessingStatus(),
        api.recording.getFreeStatus(),
        api.terminalTrade.getStatus(),
        api.logs.get(),
        api.recording.getControlStatus()
      ])
      setBackgroundRecording(controlStatus.enabled)
      const nextWindowRecorder = !controlStatus.enabled
        ? createStoppedWindowRecorderStatus(nextSettings)
        : await api.recording.getStatus()

      setAppVersion(version)
      setSettings(nextSettings)
      setClips(pendingClips)
      setRemoteClipProcessing(nextClipProcessing)
      setWindowRecorder(nextWindowRecorder)
      setFreeRecording(nextFreeRecording)
      setTerminalTrade(nextTerminalTrade)
      setAppLogs(nextLogs)
      lastLogsRefreshAtRef.current = Date.now()
    } catch (error) {
      setClipMessage(error instanceof Error ? error.message : 'Electron preload API недоступен')
    }
  }

  const refreshPendingClips = async () => {
    try {
      const api = getTradeToolsApi()
      const now = Date.now()
      const shouldRefreshLogs = now - lastLogsRefreshAtRef.current > 5_000
      const [pendingClips, nextClipProcessing, nextFreeRecording, nextTerminalTrade, nextLogs] = await Promise.all([
        api.clips.listPending(),
        api.clips.getProcessingStatus(),
        api.recording.getFreeStatus(),
        api.terminalTrade.getStatus(),
        shouldRefreshLogs ? api.logs.get() : Promise.resolve(undefined)
      ])
      setClips(pendingClips)
      setRemoteClipProcessing(nextClipProcessing)
      const currentSettings = settings ?? await api.settings.get()
      const nextWindowRecorder = !backgroundRecordingEnabledRef.current
        ? createStoppedWindowRecorderStatus(currentSettings)
        : await api.recording.getStatus()
      setWindowRecorder(nextWindowRecorder)
      setFreeRecording(nextFreeRecording)
      setTerminalTrade(nextTerminalTrade)
      if (nextLogs) {
        lastLogsRefreshAtRef.current = now
        setAppLogs((current) => (
          current.path === nextLogs.path && current.text === nextLogs.text ? current : nextLogs
        ))
      }
    } catch {
      // The initial load already surfaces Electron API errors; polling stays quiet.
    }
  }

  const appendProxyProgress = (kind: 'check' | 'connect', progress: ProxyChainSetupProgress) => {
    setProxyVaultRuntime((current) => ({
      ...current,
      activeOperation: progress.step === 'done' || progress.status === 'error'
        ? current.activeOperation === kind ? undefined : current.activeOperation
        : current.activeOperation ?? kind,
      ...(kind === 'check'
        ? { chainCheckProgress: [...current.chainCheckProgress, progress].slice(-80) }
        : { chainSetupProgress: [...current.chainSetupProgress, progress].slice(-80) })
    }))
  }

  const runHealthCheck = async (): Promise<string> => {
    try {
      const api = getTradeToolsApi()
      const controlStatus = await api.recording.getControlStatus()
      setBackgroundRecording(controlStatus.enabled)
      if (!controlStatus.enabled) return controlStatus.message
      const status = await api.recording.check()
      setWindowRecorder(status)
      return status.message
    } catch (error) {
      return error instanceof Error ? error.message : 'Не удалось проверить видео'
    }
  }

  const createBuffer = async () => {
    const startedAtMs = Date.now()
    setLocalClipProcessing({
      active: true,
      title: 'Буфер TradeTools',
      message: 'Сохраняем последний встроенный буфер',
      progressPercent: 35,
      startedAtMs
    })
    setClipMessage('Сохраняем последний буфер встроенной записи...')
    try {
      const api = getTradeToolsApi()
      const createdClips = await api.clips.createBuffer()
      const firstClip = createdClips[0]
      setLocalClipProcessing({
        active: true,
        title: firstClip?.title ?? 'Буфер TradeTools',
        message: 'Клип сохранён, обновляем очередь',
        progressPercent: 95,
        startedAtMs
      })
      setClipMessage(createdClips.length > 1
        ? `Буферы сохранены: ${createdClips.length}`
        : `Буфер сохранён: ${firstClip?.title ?? 'готово'}`)
      await loadLocalState()
    } catch (error) {
      setClipMessage(error instanceof Error ? error.message : 'Не удалось сохранить буфер')
    } finally {
      setLocalClipProcessing({
        active: false,
        title: '',
        message: '',
        progressPercent: 0
      })
    }
  }

  const cancelClipRender = async (jobId?: string) => {
    try {
      const api = getTradeToolsApi()
      const result = await api.clips.cancelRender(jobId)
      setClipMessage(result.cancelledCount > 0 ? 'Сохранение отменено' : 'Нет задач для отмены')
      await loadLocalState()
    } catch (error) {
      setClipMessage(error instanceof Error ? error.message : 'Не удалось отменить сохранение')
    }
  }

  const stopBackgroundRecording = async () => {
    try {
      const api = getTradeToolsApi()
      const currentSettings = settings ?? await api.settings.get()
      const controlStatus = await api.recording.setEnabled(false)
      if (controlStatus.enabled) {
        setBackgroundRecording(true)
        setClipMessage(controlStatus.message)
        return
      }
      setWindowRecorder(createStoppedWindowRecorderStatus(currentSettings))
      setClipMessage('Фоновая запись остановлена')
    } catch (error) {
      setBackgroundRecording(true)
      setClipMessage(error instanceof Error ? error.message : 'Не удалось остановить фоновую запись')
    }
  }

  const startBackgroundRecording = async () => {
    try {
      const api = getTradeToolsApi()
      const controlStatus = await api.recording.setEnabled(true)
      setClipMessage(controlStatus.message)
    } catch (error) {
      setClipMessage(error instanceof Error ? error.message : 'Не удалось включить фоновую запись')
    }
  }

  const startFreeRecording = async () => {
    if (!backgroundRecordingEnabledRef.current) {
      setClipMessage('Сначала включите фоновую запись')
      return
    }

    try {
      const status = await getTradeToolsApi().recording.startFree()
      setFreeRecording(status)
      setClipMessage(status.message)
    } catch (error) {
      setClipMessage(error instanceof Error ? error.message : 'Не удалось начать свободную запись')
    }
  }

  const pauseFreeRecording = async () => {
    try {
      const status = await getTradeToolsApi().recording.pauseFree()
      setFreeRecording(status)
      setClipMessage(status.message)
    } catch (error) {
      setClipMessage(error instanceof Error ? error.message : 'Не удалось поставить свободную запись на паузу')
    }
  }

  const resumeFreeRecording = async () => {
    try {
      const status = await getTradeToolsApi().recording.resumeFree()
      setFreeRecording(status)
      setClipMessage(status.message)
    } catch (error) {
      setClipMessage(error instanceof Error ? error.message : 'Не удалось продолжить свободную запись')
    }
  }

  const finishFreeRecording = async () => {
    try {
      setClipMessage('Сохраняем свободную запись...')
      setFreeRecording((current) => current ? { ...current, active: false, paused: false, message: 'Сохраняем свободную запись...' } : current)
      const result = await getTradeToolsApi().recording.finishFree()
      setFreeRecording(await getTradeToolsApi().recording.getFreeStatus())
      setClipMessage(`Свободная запись добавлена в очередь: ${result.fileName}`)
      await loadLocalState()
    } catch (error) {
      setClipMessage(error instanceof Error ? error.message : 'Не удалось сохранить свободную запись')
    }
  }

  const clearQueue = async () => {
    try {
      const result = await getTradeToolsApi().clips.clearQueue()
      setClips([])
      setClipMessage(result.removedCount > 0 ? `Очередь очищена: ${result.removedCount}` : 'Очередь уже пустая')
    } catch (error) {
      setClipMessage(error instanceof Error ? error.message : 'Не удалось очистить очередь')
    }
  }

  const deleteQueueFiles = async () => {
    try {
      const result = await getTradeToolsApi().clips.deleteQueueFiles()
      setClips([])
      setClipMessage(result.removedCount > 0 ? `Удалены файлы очереди: ${result.deletedFileCount}` : 'Очередь уже пустая')
    } catch (error) {
      setClipMessage(error instanceof Error ? error.message : 'Не удалось удалить файлы очереди')
    }
  }

  const openClipFolder = async () => {
    try {
      await getTradeToolsApi().clips.openOutputFolder()
    } catch (error) {
      setClipMessage(error instanceof Error ? error.message : 'Не удалось открыть папку с видео')
    }
  }

  const testNotification = () => getTradeToolsApi().notifications.test()

  const refreshLogs = async () => {
    try {
      const logs = await getTradeToolsApi().logs.get()
      setAppLogs(logs)
      lastLogsRefreshAtRef.current = Date.now()
    } catch (error) {
      setClipMessage(error instanceof Error ? error.message : 'Не удалось прочитать лог')
    }
  }

  const copyLogs = async () => {
    try {
      const logs = await getTradeToolsApi().logs.get()
      setAppLogs(logs)
      lastLogsRefreshAtRef.current = Date.now()
      await getTradeToolsApi().clipboard.writeText(logs.text)
      setClipMessage('Логи скопированы в буфер обмена')
    } catch (error) {
      setClipMessage(error instanceof Error ? error.message : 'Не удалось скопировать лог')
    }
  }

  const showLogFile = async () => {
    try {
      await getTradeToolsApi().logs.showFile()
    } catch (error) {
      setClipMessage(error instanceof Error ? error.message : 'Не удалось открыть файл логов')
    }
  }

  useEffect(() => {
    void loadLocalState()
    let unsubscribeProxyCheck: (() => void) | undefined
    let unsubscribeProxySetup: (() => void) | undefined
    let unsubscribeRecordingEnsure: (() => void) | undefined
    let unsubscribeRecordingControl: (() => void) | undefined
    try {
      const api = getTradeToolsApi()
      unsubscribeProxyCheck = api.proxies.onConfigureChainProgress((progress) => appendProxyProgress('check', progress))
      unsubscribeProxySetup = api.proxies.onSetupChainProgress((progress) => appendProxyProgress('connect', progress))
      unsubscribeRecordingEnsure = api.recording.onEnsureWindowRecording(() => {
        if (!backgroundRecordingEnabledRef.current) return
        void api.settings.get()
          .then((nextSettings) => {
            setSettings(nextSettings)
            setRecordingEnsureKey((current) => current + 1)
          })
          .catch(() => undefined)
      })
      unsubscribeRecordingControl = api.recording.onControlStatus((controlStatus: RecordingControlStatus) => {
        const wasEnabled = backgroundRecordingEnabledRef.current
        setBackgroundRecording(controlStatus.enabled)
        if (controlStatus.enabled && !wasEnabled) setRecordingEnsureKey((current) => current + 1)
        if (controlStatus.lastError || controlStatus.protected) setClipMessage(controlStatus.message)
      })
      void api.recording.getControlStatus().then((controlStatus) => {
        setBackgroundRecording(controlStatus.enabled)
      }).catch(() => undefined)
    } catch {
      // loadLocalState already surfaces Electron API errors.
    }
    const interval = window.setInterval(() => void refreshPendingClips(), dashboardRefreshIntervalMs)
    return () => {
      window.clearInterval(interval)
      unsubscribeProxyCheck?.()
      unsubscribeProxySetup?.()
      unsubscribeRecordingEnsure?.()
      unsubscribeRecordingControl?.()
    }
  }, [])

  const onSettingsSaved = (nextSettings: AppSettings) => {
    setSettings(nextSettings)
    void loadLocalState()
  }

  const activeClipProcessing = localClipProcessing.active
    ? localClipProcessing
    : remoteClipProcessing.active ? remoteClipProcessing : undefined

  return (
    <>
      <TopBar
        activePage={activePage}
        appVersion={appVersion}
        onRunHealthCheck={runHealthCheck}
        onOpenSetupWizard={activePage === 'support' ? undefined : () => setSetupWizardMode(activePage)}
        onTestNotification={testNotification}
      />
      <SetupWizard
        mode={setupWizardMode ?? 'video'}
        open={setupWizardMode !== undefined}
        settings={settings}
        clipMessage={clipMessage}
        onClose={() => setSetupWizardMode(undefined)}
        onSaved={onSettingsSaved}
        onRunHealthCheck={runHealthCheck}
        onCreateTestClip={() => createBuffer()}
      />
      {activePage === 'video' ? (
        <VideoPage
          settings={settings}
          clips={clips}
          clipMessage={clipMessage}
          windowRecorder={windowRecorder}
          freeRecording={freeRecording}
          terminalTrade={terminalTrade}
          backgroundRecordingEnabled={backgroundRecordingEnabled}
          clipProcessing={activeClipProcessing}
          onBackgroundRecordingStart={() => void startBackgroundRecording()}
          onBackgroundRecordingStop={() => void stopBackgroundRecording()}
          onShowRecordingWidget={() => void getTradeToolsApi().app.showRecordingWidget()}
          onCreateBuffer={() => void createBuffer()}
          onCancelClipRender={(jobId) => void cancelClipRender(jobId)}
          onClearQueue={() => void clearQueue()}
          onDeleteQueueFiles={() => void deleteQueueFiles()}
          onOpenClipFolder={() => void openClipFolder()}
          onClipDeleted={(deletedClip) => setClips((current) => current.filter((item) => item.metadataPath !== deletedClip.metadataPath))}
          onClipRenamed={(renamedClip) => setClips((current) => current.map((item) => item.metadataPath === renamedClip.metadataPath ? renamedClip : item))}
          onClipMessage={setClipMessage}
          onFreeRecordingStart={() => void startFreeRecording()}
          onFreeRecordingPause={() => void pauseFreeRecording()}
          onFreeRecordingResume={() => void resumeFreeRecording()}
          onFreeRecordingFinish={() => void finishFreeRecording()}
          onSettingsSaved={onSettingsSaved}
          logs={appLogs}
          onRefreshLogs={() => void refreshLogs()}
          onCopyLogs={() => void copyLogs()}
          onShowLogFile={() => void showLogFile()}
        />
      ) : activePage === 'proxy' ? (
        <ProxyPage
          settings={settings}
          runtimeState={proxyVaultRuntime}
          onRuntimeStateChange={setProxyVaultRuntime}
          onSettingsSaved={onSettingsSaved}
        />
      ) : (
        <SupportDeveloperPage />
      )}
      <WindowRecorderController settings={settings} enabled={backgroundRecordingEnabled} recordingEnsureKey={recordingEnsureKey} onStatusChange={setWindowRecorder} onSettingsChange={setSettings} />
    </>
  )
}
