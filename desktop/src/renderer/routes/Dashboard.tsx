import { useEffect, useMemo, useState } from 'react'
import type { ObsTestReplayResult } from '../../main/services/obs/obsService'
import type { WindowRecorderStatus } from '../../main/services/recording/windowRecorderService'
import type { AppSettings } from '../../main/services/settings/settings'
import type { TerminalTradeRecordingStatus } from '../../main/services/trades/terminalTradeRecorder'
import type { ClipProcessingStatus, ClipQueueItem } from '../../main/services/trades/tradeClipPipeline'
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
  terminalTrade: TerminalTradeRecordingStatus
  onCreateTestClip: () => void
  onClipDeleted: (clip: ClipQueueItem) => void
  onClipRenamed: (clip: ClipQueueItem) => void
  onSettingsSaved: (settings: AppSettings) => void
  clipProcessing?: ClipProcessingStatus
}

type ProxyPageProps = {
  settings?: AppSettings
  runtimeState: ProxyVaultRuntimeState
  onRuntimeStateChange: React.Dispatch<React.SetStateAction<ProxyVaultRuntimeState>>
  onSettingsSaved: (settings: AppSettings) => void
}

const ClipProcessingBar = ({ status }: { status: ClipProcessingStatus }) => (
  <div className="rounded-3xl border border-violet-400/20 bg-violet-500/[0.07] p-4">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-semibold text-violet-100">{status.title || 'Клип сделки'}</div>
        <div className="mt-1 text-sm text-zinc-400">{status.message}</div>
      </div>
      <div className="text-xs font-semibold text-violet-200">{Math.round(status.progressPercent)}%</div>
    </div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full bg-violet-400 transition-[width] duration-500"
        style={{ width: `${Math.max(6, Math.min(100, status.progressPercent))}%` }}
      />
    </div>
  </div>
)

const TerminalTradeControls = ({
  windowRecorder,
  terminalTrade
}: {
  windowRecorder?: WindowRecorderStatus
  terminalTrade: TerminalTradeRecordingStatus
}) => {
  const recorderActive = Boolean(windowRecorder?.active)
  const startedAt = terminalTrade.startedAtMs ? new Date(terminalTrade.startedAtMs).toLocaleTimeString('ru-RU') : ''

  return (
    <section className="col-span-12 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h2 className="m-0 text-base font-semibold">Автозапись терминалов</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-400">
            {terminalTrade.active
              ? `Идёт сделка с ${startedAt}. Активных позиций: ${terminalTrade.activeTradeCount}. После закрытия TradeTools сам сохранит клип.`
              : recorderActive
                ? terminalTrade.message
                : windowRecorder?.message ?? 'Откройте торговый терминал, TradeTools выберет окно и начнёт запись.'}
          </p>
          {terminalTrade.lastError && <p className="mt-2 text-xs leading-5 text-amber-300">{terminalTrade.lastError}</p>}
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-semibold text-zinc-300">
          {terminalTrade.active ? 'Пишем сделку' : 'Ждём сделку'}
        </div>
      </div>
    </section>
  )
}

const VideoPage = ({ settings, clips, clipMessage, obs, windowRecorder, terminalTrade, onCreateTestClip, onClipDeleted, onClipRenamed, onSettingsSaved, clipProcessing }: VideoPageProps) => {
  const recordingMode = settings?.recording.mode ?? 'window'
  const videoStatuses = useMemo(() => {
    return [
      {
        name: recordingMode === 'window' ? 'Встроенная запись окна' : 'OBS Replay Buffer',
        description: recordingMode === 'window' ? windowRecorder?.message ?? 'Выберите окно терминала и сохраните настройки.' : obs.message,
        status: recordingMode === 'window'
          ? windowRecorder?.active ? 'Пишет' : 'Нужно настроить'
          : obs.status,
        tone: recordingMode === 'window'
          ? windowRecorder?.active ? 'success' as const : 'warning' as const
          : obs.connected ? 'success' as const : 'warning' as const
      },
      {
        name: 'Источник сделок',
        description: windowRecorder?.active
          ? terminalTrade.message || 'TradeTools автоматически пишет окно терминала и ждёт сделки Vataga, TigerTrade или MetaScalp.'
          : windowRecorder?.message ?? 'Откройте терминал, чтобы TradeTools начал локальную запись.',
        status: terminalTrade.active ? 'Пишем сделку' : windowRecorder?.active ? 'Авто' : 'Ждём окно',
        tone: terminalTrade.lastError ? 'warning' as const : windowRecorder?.active ? 'success' as const : 'warning' as const
      }
    ]
  }, [obs, windowRecorder, recordingMode, terminalTrade])

  return (
    <div className="mt-6 grid grid-cols-12 gap-4 pb-8">
      <section className="col-span-12 grid gap-4 lg:grid-cols-2">
        {videoStatuses.map((status) => <IntegrationStatusCard key={status.name} {...status} />)}
      </section>
      <TerminalTradeControls
        windowRecorder={windowRecorder}
        terminalTrade={terminalTrade}
      />
      <section className="col-span-12">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="m-0 text-xl font-semibold tracking-[-0.03em]">Очередь проверки</h2>
            {clipMessage && <p className="mt-2 text-sm text-violet-200">{clipMessage}</p>}
          </div>
          <button className="cursor-pointer whitespace-nowrap rounded-2xl border border-violet-400/30 bg-violet-500/15 px-4 py-2 text-sm font-medium text-violet-100 transition hover:bg-violet-500/25 sm:self-auto" onClick={onCreateTestClip}>Создать тестовый клип</button>
        </div>
        {clipProcessing?.active && <div className="mb-3"><ClipProcessingBar status={clipProcessing} /></div>}
        <div className="space-y-3">
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
}

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
  const [terminalTrade, setTerminalTrade] = useState<TerminalTradeRecordingStatus>({
    active: false,
    startedAtMs: 0,
    message: 'Автоматически ждём сделки Vataga, TigerTrade или MetaScalp',
    source: 'multi-terminal',
    activeTradeCount: 0
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

  const loadLocalState = async () => {
    try {
      const api = getTradeToolsApi()
      const [version, nextSettings, pendingClips, nextClipProcessing, nextWindowRecorder, nextTerminalTrade] = await Promise.all([
        api.app.getVersion(),
        api.settings.get(),
        api.clips.listPending(),
        api.clips.getProcessingStatus(),
        api.recording.getStatus(),
        api.terminalTrade.getStatus()
      ])

      setAppVersion(version)
      setSettings(nextSettings)
      setClips(pendingClips)
      setRemoteClipProcessing(nextClipProcessing)
      setWindowRecorder(nextWindowRecorder)
      setTerminalTrade(nextTerminalTrade)
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
      const status = await api.recording.getStatus()
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
      const [pendingClips, nextClipProcessing, nextTerminalTrade] = await Promise.all([
        api.clips.listPending(),
        api.clips.getProcessingStatus(),
        api.terminalTrade.getStatus()
      ])
      setClips(pendingClips)
      setRemoteClipProcessing(nextClipProcessing)
      setTerminalTrade(nextTerminalTrade)
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
        const status = await api.recording.getStatus()
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

  const createTestClip = async () => {
    const startedAtMs = Date.now()
    setLocalClipProcessing({
      active: true,
      title: 'Тестовый клип',
      message: settings?.recording.mode === 'window'
        ? 'Собираем встроенный replay и режем клип'
        : 'Сохраняем OBS replay и режем клип',
      progressPercent: 35,
      startedAtMs
    })
    setClipMessage(settings?.recording.mode === 'window'
      ? 'Создаём тестовый клип: собираем встроенный replay из окна и режем ffmpeg...'
      : 'Создаём тестовый клип: сохраняем OBS replay, ищем файл и режем ffmpeg...'
    )
    try {
      const api = getTradeToolsApi()
      const clip = await api.clips.createTest()
      setLocalClipProcessing({
        active: true,
        title: clip.title,
        message: 'Клип сохранён, обновляем очередь',
        progressPercent: 95,
        startedAtMs
      })
      setClipMessage(`Клип создан: ${clip.title}`)
      await loadLocalState()
    } catch (error) {
      setClipMessage(error instanceof Error ? error.message : 'Не удалось создать клип')
    } finally {
      setLocalClipProcessing({
        active: false,
        title: '',
        message: '',
        progressPercent: 0
      })
    }
  }

  const testNotification = () => getTradeToolsApi().notifications.test()

  useEffect(() => {
    void loadLocalState()
    let unsubscribeProxyCheck: (() => void) | undefined
    let unsubscribeProxySetup: (() => void) | undefined
    try {
      const api = getTradeToolsApi()
      unsubscribeProxyCheck = api.proxies.onConfigureChainProgress((progress) => appendProxyProgress('check', progress))
      unsubscribeProxySetup = api.proxies.onSetupChainProgress((progress) => appendProxyProgress('setup', progress))
    } catch {
      // loadLocalState already surfaces Electron API errors.
    }
    const interval = window.setInterval(() => void refreshPendingClips(), 2_000)
    return () => {
      window.clearInterval(interval)
      unsubscribeProxyCheck?.()
      unsubscribeProxySetup?.()
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
        onCreateTestClip={createTestClip}
      />
      {activePage === 'video' ? (
        <VideoPage
          settings={settings}
          clips={clips}
          clipMessage={clipMessage}
          obs={obs}
          windowRecorder={windowRecorder}
          terminalTrade={terminalTrade}
          clipProcessing={activeClipProcessing}
          onCreateTestClip={() => void createTestClip()}
          onClipDeleted={(deletedClip) => setClips((current) => current.filter((item) => item.metadataPath !== deletedClip.metadataPath))}
          onClipRenamed={(renamedClip) => setClips((current) => current.map((item) => item.metadataPath === renamedClip.metadataPath ? renamedClip : item))}
          onSettingsSaved={onSettingsSaved}
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
      <WindowRecorderController settings={settings} onStatusChange={setWindowRecorder} onSettingsChange={setSettings} />
    </>
  )
}
