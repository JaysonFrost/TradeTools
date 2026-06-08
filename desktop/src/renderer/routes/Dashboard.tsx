import { useEffect, useMemo, useState } from 'react'
import type { BinanceFuturesWatchStatus } from '../../main/services/exchanges/binanceFuturesClipWatcher'
import type { ObsTestReplayResult } from '../../main/services/obs/obsService'
import type { AppSettings } from '../../main/services/settings/settings'
import type { ClipQueueItem } from '../../main/services/trades/tradeClipPipeline'
import { IntegrationStatusCard } from '../components/integrations/IntegrationStatusCard'
import { TopBar } from '../components/layout/TopBar'
import { SetupWizard } from '../components/setup/SetupWizard'
import { BinanceFuturesSettingsPanel } from '../components/settings/BinanceFuturesSettingsPanel'
import { ObsSettingsPanel } from '../components/settings/ObsSettingsPanel'
import { ProxyVaultPanel, type ProxyVaultRuntimeState } from '../components/settings/ProxyVaultPanel'
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
  binanceWatch: BinanceFuturesWatchStatus
  onCreateTestClip: () => void
  onClipDeleted: (clip: ClipQueueItem) => void
  onClipRenamed: (clip: ClipQueueItem) => void
  onSettingsSaved: (settings: AppSettings) => void
}

type ProxyPageProps = {
  settings?: AppSettings
  runtimeState: ProxyVaultRuntimeState
  onRuntimeStateChange: React.Dispatch<React.SetStateAction<ProxyVaultRuntimeState>>
  onSettingsSaved: (settings: AppSettings) => void
}

const VideoPage = ({ settings, clips, clipMessage, obs, binanceWatch, onCreateTestClip, onClipDeleted, onClipRenamed, onSettingsSaved }: VideoPageProps) => {
  const videoStatuses = useMemo(() => [
    {
      name: 'OBS Replay Buffer',
      description: obs.message,
      status: obs.status,
      tone: obs.connected ? 'success' as const : 'warning' as const
    },
    {
      name: 'Binance USDT-M Futures',
      description: binanceWatch.message,
      status: settings?.exchange.binanceFutures.apiKeyConfigured && settings.exchange.binanceFutures.apiSecretConfigured
        ? binanceWatch.lastError ? 'Ошибка' : binanceWatch.running ? 'Работает' : 'Готов'
        : 'Нужно настроить',
      tone: settings?.exchange.binanceFutures.apiKeyConfigured && settings.exchange.binanceFutures.apiSecretConfigured && !binanceWatch.lastError ? 'success' as const : 'warning' as const
    }
  ], [obs, settings, binanceWatch])

  return (
    <div className="mt-6 grid grid-cols-12 gap-4 pb-8">
      <section className="col-span-12 grid gap-4 lg:grid-cols-2">
        {videoStatuses.map((status) => <IntegrationStatusCard key={status.name} {...status} />)}
      </section>
      <section className="col-span-12">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="m-0 text-xl font-semibold tracking-[-0.03em]">Очередь проверки</h2>
            {clipMessage && <p className="mt-2 text-sm text-violet-200">{clipMessage}</p>}
          </div>
          <button className="cursor-pointer whitespace-nowrap rounded-2xl border border-violet-400/30 bg-violet-500/15 px-4 py-2 text-sm font-medium text-violet-100 transition hover:bg-violet-500/25 sm:self-auto" onClick={onCreateTestClip}>Создать тестовый клип</button>
        </div>
        <div className="space-y-3">
          {clips.length > 0 ? clips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} onDeleted={onClipDeleted} onRenamed={onClipRenamed} />
          )) : <div className="rounded-3xl border border-dashed border-white/10 p-6 text-sm text-zinc-500">Пока нет клипов в очереди.</div>}
        </div>
      </section>
      <section className="col-span-12 space-y-4">
        <SystemSettingsPanel mode="video" settings={settings} onSaved={onSettingsSaved} />
        <ObsSettingsPanel settings={settings} onSaved={onSettingsSaved} />
        <BinanceFuturesSettingsPanel settings={settings} onSaved={onSettingsSaved} />
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
  const [setupWizardMode, setSetupWizardMode] = useState<SetupWizardMode>()
  const [proxyVaultRuntime, setProxyVaultRuntime] = useState<ProxyVaultRuntimeState>({
    chainCheckProgress: [],
    chainSetupProgress: []
  })
  const [binanceWatch, setBinanceWatch] = useState<BinanceFuturesWatchStatus>({
    configured: false,
    running: false,
    message: 'Binance watcher ещё не проверялся'
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
      const [version, nextSettings, pendingClips, nextBinanceWatch] = await Promise.all([
        api.app.getVersion(),
        api.settings.get(),
        api.clips.listPending(),
        api.binance.getWatchStatus()
      ])

      setAppVersion(version)
      setSettings(nextSettings)
      setClips(pendingClips)
      setBinanceWatch(nextBinanceWatch)
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
      const [pendingClips, nextBinanceWatch] = await Promise.all([
        api.clips.listPending(),
        api.binance.getWatchStatus()
      ])
      setClips(pendingClips)
      setBinanceWatch(nextBinanceWatch)
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
    setClipMessage('Создаём тестовый клип: сохраняем OBS replay, ищем файл и режем ffmpeg...')
    try {
      const api = getTradeToolsApi()
      const clip = await api.clips.createTest()
      setClipMessage(`Клип создан: ${clip.title}`)
      await loadLocalState()
    } catch (error) {
      setClipMessage(error instanceof Error ? error.message : 'Не удалось создать клип')
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
          binanceWatch={binanceWatch}
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
    </>
  )
}
