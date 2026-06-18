import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, FileText, FolderOpen, ListX, Pause, Play, RefreshCw, Square, Trash2, Video, XCircle } from 'lucide-react'
import type { ObsTestReplayResult } from '../../main/services/obs/obsService'
import type { FreeRecordingStatus, WindowRecorderStatus } from '../../main/services/recording/windowRecorderService'
import type { AppSettings } from '../../main/services/settings/settings'
import type { TerminalTradeRecordingStatus } from '../../main/services/trades/terminalTradeRecorder'
import type { ClipProcessingStatus, ClipQueueItem } from '../../main/services/trades/tradeClipPipeline'
import type { AppLogSnapshot } from '../../main/services/logging/appLogService'
import { IntegrationStatusCard } from '../components/integrations/IntegrationStatusCard'
import { TopBar } from '../components/layout/TopBar'
import { SetupWizard } from '../components/setup/SetupWizard'
import { ObsSettingsPanel } from '../components/settings/ObsSettingsPanel'
import { ProxyVaultPanel, type ProxyVaultRuntimeState } from '../components/settings/ProxyVaultPanel'
import { WindowRecorderController } from '../components/recording/WindowRecorderController'
import { SystemSettingsPanel } from '../components/settings/SystemSettingsPanel'
import { SupportDeveloperPage } from '../components/support/SupportDeveloperPage'
import { ClipCard } from '../components/trade/ClipCard'
import type { AppPage } from '../lib/navigation'
import { getTradeToolsApi } from '../lib/tradeToolsApi'
import type { ProxyChainSetupProgress } from '../../preload'

type ObsUiState = {
  status: string
  message: string
  connected: boolean
  replayBufferActive: boolean
}

export type DashboardProps = {
  activePage: AppPage
}

type SetupWizardMode = Exclude<AppPage, 'support'>

type VideoPageProps = {
  settings?: AppSettings
  clips: ClipQueueItem[]
  clipMessage: string
  obs: ObsUiState
  windowRecorder?: WindowRecorderStatus
  freeRecording?: FreeRecordingStatus
  terminalTrade: TerminalTradeRecordingStatus
  backgroundRecordingEnabled: boolean
  onBackgroundRecordingStart: () => void
  onBackgroundRecordingStop: () => void
  onCreateBuffer: (captureTargetId?: string) => void
  onCancelClipRender: (jobId?: string) => void
  onClearQueue: () => void
  onDeleteQueueFiles: () => void
  onOpenClipFolder: () => void
  onClipDeleted: (clip: ClipQueueItem) => void
  onClipRenamed: (clip: ClipQueueItem) => void
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

const ClipProcessingBar = ({ status, onCancel }: { status: ClipProcessingStatus, onCancel: (jobId?: string) => void }) => (
  <div className="rounded-3xl border border-violet-400/20 bg-violet-500/[0.07] p-4">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-semibold text-violet-100">{status.title || 'Клип сделки'}</div>
        <div className="mt-1 text-sm text-zinc-400">{status.message}</div>
      </div>
      <div className="flex items-center gap-2">
        <div className="text-xs font-semibold text-violet-200">{Math.round(status.progressPercent)}%</div>
        <button className="inline-flex cursor-pointer items-center rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100 transition hover:bg-red-500/15" onClick={() => onCancel(status.activeJobId)} type="button">
          <XCircle size={14} className="mr-1" />Отменить
        </button>
      </div>
    </div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full bg-violet-400 transition-[width] duration-500"
        style={{ width: `${Math.max(6, Math.min(100, status.progressPercent))}%` }}
      />
    </div>
  </div>
)

const formatSeconds = (value: number): string => `${Math.max(0, Math.round(value))}с`

const createStoppedWindowRecorderStatus = (settings: AppSettings): WindowRecorderStatus => ({
  enabled: true,
  active: false,
  backend: 'browser',
  mode: settings.recording.mode,
  sourceId: settings.recording.windowSourceId,
  sourceName: settings.recording.windowSourceName,
  segmentCount: 0,
  bufferedSeconds: 0,
  lastSegmentAtMs: 0,
  message: 'Фоновая запись остановлена'
})

const RecordingStatusPanel = ({
  settings,
  obs,
  windowRecorder,
  terminalTrade,
  backgroundRecordingEnabled,
  onBackgroundRecordingStart,
  onBackgroundRecordingStop,
  onCreateBuffer
}: {
  settings?: AppSettings
  obs: ObsUiState
  windowRecorder?: WindowRecorderStatus
  terminalTrade: TerminalTradeRecordingStatus
  backgroundRecordingEnabled: boolean
  onBackgroundRecordingStart: () => void
  onBackgroundRecordingStop: () => void
  onCreateBuffer: (captureTargetId?: string) => void
}) => {
  const [manualBufferTargetId, setManualBufferTargetId] = useState('')
  const isWindowMode = settings?.recording.mode === 'window'
  const manualBufferTargets = settings?.recording.mode === 'window' ? settings.recording.captureTargets : []
  const targetSeconds = Math.max(1, Math.round(settings?.clip.replayBufferSeconds ?? 1))
  const bufferedSeconds = Math.min(targetSeconds, Math.max(0, Math.round(windowRecorder?.bufferedSeconds ?? 0)))
  const progressPercent = Math.min(100, Math.max(0, bufferedSeconds / targetSeconds * 100))
  const sourceName = windowRecorder?.sourceName || settings?.recording.windowSourceName || settings?.recording.windowSourceId || 'Источник не выбран'
  const hasActiveTrade = terminalTrade.active
  const terminalStatus = `Пишем сделку, позиций: ${terminalTrade.activeTradeCount}. После закрытия TradeTools сам сохранит клип.`
  const activeTradeSummary = `${terminalTrade.activeTradeCount} поз.`
  const showStatusBadge = !isWindowMode || !backgroundRecordingEnabled || hasActiveTrade
  const statusText = !isWindowMode
    ? obs.status
    : !backgroundRecordingEnabled
      ? 'Фон остановлен'
      : hasActiveTrade
        ? 'Пишем сделку'
        : ''
  const message = !isWindowMode
    ? obs.message
    : !backgroundRecordingEnabled
      ? 'Автоклипы и свободная запись сейчас выключены.'
      : hasActiveTrade
        ? terminalStatus
        : ''
  const buttonBase = 'inline-flex min-h-10 cursor-pointer items-center justify-center rounded-2xl border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <section className="col-span-12 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-base font-semibold">Автозапись терминалов</h2>
            {showStatusBadge && (
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusText === 'Пишем сделку' ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200' : statusText === 'Фон остановлен' ? 'border-white/10 bg-black/20 text-zinc-400' : 'border-amber-300/30 bg-amber-300/10 text-amber-200'}`}>
                {statusText}
              </span>
            )}
          </div>
          {message && <p className="mt-2 text-sm leading-6 text-zinc-400">{message}</p>}
          {isWindowMode && hasActiveTrade && (
            <div className="mt-3 grid gap-2 text-xs text-zinc-500 sm:grid-cols-3">
              <div>Источник: <span className="text-zinc-300">{sourceName}</span></div>
              <div>Буфер: <span className="text-zinc-300">{formatSeconds(bufferedSeconds)} / {formatSeconds(targetSeconds)}</span></div>
              <div>Сделки: <span className="text-zinc-300">{activeTradeSummary}</span></div>
            </div>
          )}
          {terminalTrade.lastError && <p className="mt-2 text-xs leading-5 text-amber-300">{terminalTrade.lastError}</p>}
        </div>
        {isWindowMode && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {backgroundRecordingEnabled ? (
              <button className={`${buttonBase} border-rose-400/30 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25`} onClick={onBackgroundRecordingStop} type="button">
                <Square size={16} className="mr-2" />Остановить фоновую запись
              </button>
            ) : (
              <button className={`${buttonBase} border-emerald-400/30 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25`} onClick={onBackgroundRecordingStart} disabled={!settings} type="button">
                <Play size={16} className="mr-2" />Включить фоновую запись
              </button>
            )}
            {manualBufferTargets.length > 1 && (
              <select
                className="min-h-10 cursor-pointer rounded-2xl border border-white/10 bg-black/20 px-3 text-sm text-zinc-100 outline-none"
                value={manualBufferTargetId}
                onChange={(event) => setManualBufferTargetId(event.target.value)}
              >
                <option value="">Все мониторы</option>
                {manualBufferTargets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
              </select>
            )}
            <button className={`${buttonBase} border-violet-400/30 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25`} onClick={() => onCreateBuffer(manualBufferTargetId || undefined)} disabled={!settings || !backgroundRecordingEnabled} type="button">
              <Video size={16} className="mr-2" />Сохранить последний буфер
            </button>
          </div>
        )}
      </div>
      {isWindowMode && hasActiveTrade && (
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-violet-400"
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
  const isWindowMode = settings?.recording.mode === 'window'
  const isActive = Boolean(freeRecording?.active)
  const isPaused = Boolean(freeRecording?.paused)
  const disabled = !settings || !isWindowMode || !backgroundRecordingEnabled
  const buttonBase = 'inline-flex min-h-10 cursor-pointer items-center justify-center rounded-2xl border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50'
  const startedAt = freeRecording?.startedAtMs ? new Date(freeRecording.startedAtMs).toLocaleTimeString('ru-RU') : ''

  return (
    <section className="col-span-12 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-base font-semibold">Свободная запись</h2>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${isActive ? isPaused ? 'border-amber-300/30 bg-amber-300/10 text-amber-200' : 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200' : 'border-white/10 bg-black/20 text-zinc-400'}`}>
              {isActive ? isPaused ? 'Пауза' : 'Идёт запись' : 'Готово'}
            </span>
          </div>
          <p className="mt-1 text-sm leading-6 text-zinc-400">
            {disabled
              ? backgroundRecordingEnabled ? 'Свободная запись доступна во встроенной записи окна или экрана.' : 'Сначала включите фоновую запись.'
              : isActive
                ? `${freeRecording?.message ?? 'Записываем терминал'}${startedAt ? ` с ${startedAt}` : ''}.`
                : 'Записывает выбранное окно или экран без привязки к сделкам.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isActive && (
            <button className={`${buttonBase} border-violet-400/40 bg-violet-500/20 text-violet-100 hover:bg-violet-500/30`} onClick={onStart} disabled={disabled} type="button">
              <Video size={16} className="mr-2" />Начать
            </button>
          )}
          {isActive && (
            <button className={`${buttonBase} border-rose-400/30 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25`} onClick={onFinish} type="button">
              <Square size={16} className="mr-2" />Завершить
            </button>
          )}
          {isActive && !isPaused && (
            <button className={`${buttonBase} border-white/10 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]`} onClick={onPause} type="button">
              <Pause size={16} className="mr-2" />Пауза
            </button>
          )}
          {isActive && isPaused && (
            <button className={`${buttonBase} border-emerald-400/30 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25`} onClick={onResume} type="button">
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
  <details className="col-span-12 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-base font-semibold [&::-webkit-details-marker]:hidden">
      <span className="flex items-center gap-2">
        <FileText size={16} className="text-violet-200" />
        Логи
      </span>
      <span className="text-xs font-medium text-zinc-500">Показать</span>
    </summary>
    <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <p className="min-w-0 break-all text-xs text-zinc-500">{logs.path || 'Файл логов будет создан после первого события.'}</p>
      <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
        <button className="inline-flex min-h-9 cursor-pointer items-center rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-zinc-200 transition hover:bg-white/[0.08]" onClick={onRefresh} type="button">
          <RefreshCw size={14} className="mr-2" />Обновить
        </button>
        <button className="inline-flex min-h-9 cursor-pointer items-center rounded-2xl border border-violet-400/30 bg-violet-500/15 px-3 text-xs font-semibold text-violet-100 transition hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-50" onClick={onCopy} disabled={!logs.text} type="button">
          <Copy size={14} className="mr-2" />Скопировать текст
        </button>
        <button className="inline-flex min-h-9 cursor-pointer items-center rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-zinc-200 transition hover:bg-white/[0.08]" onClick={onShowFile} type="button">
          <FileText size={14} className="mr-2" />Открыть файл
        </button>
      </div>
    </div>
    <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-white/10 bg-black/30 p-3 text-xs leading-5 text-zinc-300">
      {logs.text || 'Лог пока пуст. Ошибки сохранения клипов появятся здесь.'}
    </pre>
  </details>
)

const VideoPage = ({ settings, clips, clipMessage, obs, windowRecorder, freeRecording, terminalTrade, backgroundRecordingEnabled, onBackgroundRecordingStart, onBackgroundRecordingStop, onCreateBuffer, onCancelClipRender, onClearQueue, onDeleteQueueFiles, onOpenClipFolder, onClipDeleted, onClipRenamed, onFreeRecordingStart, onFreeRecordingPause, onFreeRecordingResume, onFreeRecordingFinish, onSettingsSaved, clipProcessing, logs, onRefreshLogs, onCopyLogs, onShowLogFile }: VideoPageProps) => (
    <div className="mt-6 grid grid-cols-12 gap-4 pb-8">
      <RecordingStatusPanel
        settings={settings}
        obs={obs}
        windowRecorder={windowRecorder}
        terminalTrade={terminalTrade}
        backgroundRecordingEnabled={backgroundRecordingEnabled}
        onBackgroundRecordingStart={onBackgroundRecordingStart}
        onBackgroundRecordingStop={onBackgroundRecordingStop}
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
      <section className="col-span-12">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="m-0 text-xl font-semibold tracking-[-0.03em]">Очередь проверки</h2>
            <p className="mt-1 text-xs text-zinc-500">Очистить - убрать из списка. Удалить файлы - стереть видео с диска.</p>
            {clipMessage && <p className="mt-2 text-sm text-violet-200">{clipMessage}</p>}
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <button className="inline-flex cursor-pointer items-center whitespace-nowrap rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.08]" onClick={onOpenClipFolder} type="button">
              <FolderOpen size={16} className="mr-2" />Открыть папку с видео
            </button>
            <button className="inline-flex cursor-pointer items-center whitespace-nowrap rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50" onClick={onClearQueue} disabled={clips.length === 0} type="button">
              <ListX size={16} className="mr-2" />Очистить очередь
            </button>
            <button className="inline-flex cursor-pointer items-center whitespace-nowrap rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-100 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50" onClick={onDeleteQueueFiles} disabled={clips.length === 0} type="button">
              <Trash2 size={16} className="mr-2" />Удалить все файлы
            </button>
          </div>
        </div>
        {clipProcessing?.active && <div className="mb-3"><ClipProcessingBar status={clipProcessing} onCancel={onCancelClipRender} /></div>}
        <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
          {clips.length > 0 ? clips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} onDeleted={onClipDeleted} onRenamed={onClipRenamed} />
          )) : <div className="rounded-3xl border border-dashed border-white/10 p-6 text-sm text-zinc-500">Пока нет клипов в очереди.</div>}
        </div>
      </section>
      <section className="col-span-12 space-y-4">
        <SystemSettingsPanel mode="video" settings={settings} onSaved={onSettingsSaved} />
        <ObsSettingsPanel settings={settings} onSaved={onSettingsSaved} />
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
  const [lastCheck, setLastCheck] = useState<ObsTestReplayResult>()
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
  const [backgroundRecordingEnabled, setBackgroundRecordingEnabled] = useState(true)
  const backgroundRecordingEnabledRef = useRef(true)
  const [recordingEnsureKey, setRecordingEnsureKey] = useState(0)
  const [freeRecording, setFreeRecording] = useState<FreeRecordingStatus>()
  const [terminalTrade, setTerminalTrade] = useState<TerminalTradeRecordingStatus>({
    active: false,
    startedAtMs: 0,
    message: 'Автоматически ждём сделки Vataga, TigerTrade или MetaScalp',
    source: 'multi-terminal',
    activeTradeCount: 0
  })
  const [appLogs, setAppLogs] = useState<AppLogSnapshot>({
    path: '',
    text: ''
  })
  const [setupWizardMode, setSetupWizardMode] = useState<SetupWizardMode>()
  const [proxyVaultRuntime, setProxyVaultRuntime] = useState<ProxyVaultRuntimeState>({
    chainCheckProgress: [],
    chainSetupProgress: []
  })
  const [obs, setObs] = useState<ObsUiState>({
    status: 'Не проверено',
    message: 'OBS не проверяется автоматически. Нажмите «Проверить видео», когда OBS запущен.',
    connected: false,
    replayBufferActive: false
  })

  const setBackgroundRecording = (enabled: boolean) => {
    backgroundRecordingEnabledRef.current = enabled
    setBackgroundRecordingEnabled(enabled)
  }

  const loadLocalState = async () => {
    try {
      const api = getTradeToolsApi()
      const [version, nextSettings, pendingClips, nextClipProcessing, nextFreeRecording, nextTerminalTrade, nextLogs] = await Promise.all([
        api.app.getVersion(),
        api.settings.get(),
        api.clips.listPending(),
        api.clips.getProcessingStatus(),
        api.recording.getFreeStatus(),
        api.terminalTrade.getStatus(),
        api.logs.get()
      ])
      const nextWindowRecorder = nextSettings.recording.mode === 'window' && !backgroundRecordingEnabledRef.current
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
      setObs((current) => {
        if (current.connected || current.status === 'Отключено') return current

        return {
          status: nextSettings.obs.passwordConfigured ? 'Готов к проверке' : 'Нужно настроить',
          message: nextSettings.obs.passwordConfigured
            ? 'OBS WebSocket сохранён. Нажмите «Проверить видео», чтобы проверить подключение и Replay Buffer.'
            : 'Сначала сохраните OBS WebSocket пароль, затем нажмите «Проверить видео».',
          connected: false,
          replayBufferActive: false
        }
      })
    } catch (error) {
      setObs({
        status: 'Electron API недоступен',
        message: error instanceof Error ? error.message : 'Electron preload API недоступен',
        connected: false,
        replayBufferActive: false
      })
    }
  }

  const refreshObsStatus = async () => {
    const api = getTradeToolsApi()
    const currentSettings = settings ?? await api.settings.get()
    if (currentSettings.recording.mode === 'window') {
      const status = backgroundRecordingEnabledRef.current
        ? await api.recording.getStatus()
        : createStoppedWindowRecorderStatus(currentSettings)
      setWindowRecorder(status)
      setObs({
        status: status.active ? 'Пишет' : 'Нужно настроить',
        message: status.message,
        connected: status.active,
        replayBufferActive: status.active
      })
      return
    }

    const status = await api.obs.getStatus()

    setObs({
      status: status.status === 'setup-needed' ? 'Нужно настроить' : status.status === 'connected' ? 'Подключено' : 'Отключено',
      message: status.message,
      connected: status.connected,
      replayBufferActive: status.replayBufferActive
    })
  }

  const refreshPendingClips = async () => {
    try {
      const api = getTradeToolsApi()
      const [pendingClips, nextClipProcessing, nextFreeRecording, nextTerminalTrade, nextLogs] = await Promise.all([
        api.clips.listPending(),
        api.clips.getProcessingStatus(),
        api.recording.getFreeStatus(),
        api.terminalTrade.getStatus(),
        api.logs.get()
      ])
      setClips(pendingClips)
      setRemoteClipProcessing(nextClipProcessing)
      const currentSettings = settings ?? await api.settings.get()
      const nextWindowRecorder = currentSettings.recording.mode === 'window' && !backgroundRecordingEnabledRef.current
        ? createStoppedWindowRecorderStatus(currentSettings)
        : await api.recording.getStatus()
      setWindowRecorder(nextWindowRecorder)
      setFreeRecording(nextFreeRecording)
      setTerminalTrade(nextTerminalTrade)
      setAppLogs(nextLogs)
    } catch {
      // The initial load already surfaces Electron API errors; polling stays quiet.
    }
  }

  const appendProxyProgress = (kind: 'check' | 'setup', progress: ProxyChainSetupProgress) => {
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
      const currentSettings = settings ?? await api.settings.get()
      if (currentSettings.recording.mode === 'window') {
        const status = backgroundRecordingEnabledRef.current
          ? await api.recording.getStatus()
          : createStoppedWindowRecorderStatus(currentSettings)
        setWindowRecorder(status)
        setLastCheck({
          ok: status.active,
          message: status.message,
          requestedAtMs: Date.now(),
          replayPath: undefined
        })
        await loadLocalState()
        return status.message
      }

      const result = await api.obs.testReplaySave()
      setLastCheck(result)
      await Promise.all([refreshObsStatus(), loadLocalState()])
      return result.message
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось проверить видео'
      setLastCheck({
        ok: false,
        message,
        requestedAtMs: Date.now()
      })
      return message
    }
  }

  const createBuffer = async (captureTargetId?: string) => {
    const startedAtMs = Date.now()
    setLocalClipProcessing({
      active: true,
      title: 'Буфер TradeTools',
      message: settings?.recording.mode === 'window'
        ? 'Сохраняем последний встроенный буфер'
        : 'Сохраняем OBS replay и режем клип',
      progressPercent: 35,
      startedAtMs
    })
    setClipMessage(settings?.recording.mode === 'window'
      ? 'Сохраняем последний буфер встроенной записи...'
      : 'Сохраняем последний OBS replay...'
    )
    try {
      const api = getTradeToolsApi()
      const createdClips = await api.clips.createBuffer({ captureTargetId })
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
      setBackgroundRecording(false)
      await api.recording.stop()
      setWindowRecorder(createStoppedWindowRecorderStatus(currentSettings))
      setClipMessage('Фоновая запись остановлена')
    } catch (error) {
      setBackgroundRecording(true)
      setClipMessage(error instanceof Error ? error.message : 'Не удалось остановить фоновую запись')
    }
  }

  const startBackgroundRecording = async (options: { silent?: boolean } = {}) => {
    try {
      const api = getTradeToolsApi()
      const currentSettings = settings ?? await api.settings.get()
      if (currentSettings.recording.mode !== 'window') {
        if (!options.silent) setClipMessage('Фоновая запись доступна во встроенном режиме')
        return
      }

      setBackgroundRecording(true)
      setRecordingEnsureKey((current) => current + 1)
      if (options.silent) return

      const status = await api.recording.start()
      setWindowRecorder(status)
      setClipMessage(status.message)
    } catch (error) {
      if (!options.silent) setClipMessage(error instanceof Error ? error.message : 'Не удалось включить фоновую запись')
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
    } catch (error) {
      setClipMessage(error instanceof Error ? error.message : 'Не удалось прочитать лог')
    }
  }

  const copyLogs = async () => {
    try {
      const logs = await getTradeToolsApi().logs.get()
      setAppLogs(logs)
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
    try {
      const api = getTradeToolsApi()
      unsubscribeProxyCheck = api.proxies.onConfigureChainProgress((progress) => appendProxyProgress('check', progress))
      unsubscribeProxySetup = api.proxies.onSetupChainProgress((progress) => appendProxyProgress('setup', progress))
      unsubscribeRecordingEnsure = api.recording.onEnsureWindowRecording(() => {
        if (backgroundRecordingEnabledRef.current) void startBackgroundRecording({ silent: true })
      })
    } catch {
      // loadLocalState already surfaces Electron API errors.
    }
    const interval = window.setInterval(() => void refreshPendingClips(), 1_000)
    return () => {
      window.clearInterval(interval)
      unsubscribeProxyCheck?.()
      unsubscribeProxySetup?.()
      unsubscribeRecordingEnsure?.()
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
        obsMessage={lastCheck?.message ?? ''}
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
          obs={obs}
          windowRecorder={windowRecorder}
          freeRecording={freeRecording}
          terminalTrade={terminalTrade}
          backgroundRecordingEnabled={backgroundRecordingEnabled}
          clipProcessing={activeClipProcessing}
          onBackgroundRecordingStart={() => void startBackgroundRecording()}
          onBackgroundRecordingStop={() => void stopBackgroundRecording()}
          onCreateBuffer={(captureTargetId) => void createBuffer(captureTargetId)}
          onCancelClipRender={(jobId) => void cancelClipRender(jobId)}
          onClearQueue={() => void clearQueue()}
          onDeleteQueueFiles={() => void deleteQueueFiles()}
          onOpenClipFolder={() => void openClipFolder()}
          onClipDeleted={(deletedClip) => setClips((current) => current.filter((item) => item.metadataPath !== deletedClip.metadataPath))}
          onClipRenamed={(renamedClip) => setClips((current) => current.map((item) => item.metadataPath === renamedClip.metadataPath ? renamedClip : item))}
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
