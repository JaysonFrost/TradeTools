import { useEffect, useMemo, useState } from 'react'
import type { BinanceFuturesWatchStatus } from '../../main/services/exchanges/binanceFuturesClipWatcher'
import type { ObsStatus, ObsTestReplayResult } from '../../main/services/obs/obsService'
import type { AppSettings } from '../../main/services/settings/settings'
import type { ClipQueueItem } from '../../main/services/trades/tradeClipPipeline'
import { IntegrationStatusCard } from '../components/integrations/IntegrationStatusCard'
import { TopBar } from '../components/layout/TopBar'
import { SetupWizard } from '../components/setup/SetupWizard'
import { BinanceFuturesSettingsPanel } from '../components/settings/BinanceFuturesSettingsPanel'
import { ObsSettingsPanel } from '../components/settings/ObsSettingsPanel'
import { YouTubeSettingsPanel } from '../components/settings/YouTubeSettingsPanel'
import { ClipCard } from '../components/trade/ClipCard'
import { getTradeCutApi } from '../lib/tradeCutApi'

type ObsUiState = {
  status: string
  message: string
  connected: boolean
  replayBufferActive: boolean
}

export const Dashboard = () => {
  const [appVersion, setAppVersion] = useState<string>()
  const [settings, setSettings] = useState<AppSettings>()
  const [clips, setClips] = useState<ClipQueueItem[]>([])
  const [lastCheck, setLastCheck] = useState<ObsTestReplayResult>()
  const [clipMessage, setClipMessage] = useState('')
  const [setupWizardOpen, setSetupWizardOpen] = useState(false)
  const [binanceWatch, setBinanceWatch] = useState<BinanceFuturesWatchStatus>({
    configured: false,
    running: false,
    message: 'Binance watcher ещё не проверялся'
  })
  const [obs, setObs] = useState<ObsUiState>({
    status: 'Не проверено',
    message: 'OBS не проверяется автоматически. Нажмите «Проверить систему», когда OBS запущен.',
    connected: false,
    replayBufferActive: false
  })

  const loadLocalState = async () => {
    try {
      const api = getTradeCutApi()
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
            ? 'OBS WebSocket сохранён. Нажмите «Проверить систему», чтобы проверить подключение и Replay Buffer.'
            : 'Сначала сохраните OBS WebSocket пароль, затем нажмите «Проверить систему».',
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
    const api = getTradeCutApi()
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
      const api = getTradeCutApi()
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

  const runHealthCheck = async () => {
    try {
      const api = getTradeCutApi()
      const result = await api.obs.testReplaySave()
      setLastCheck(result)
      await Promise.all([refreshObsStatus(), loadLocalState()])
    } catch (error) {
      setLastCheck({
        ok: false,
        message: error instanceof Error ? error.message : 'Не удалось проверить систему',
        requestedAtMs: Date.now()
      })
    }
  }

  const createTestClip = async () => {
    setClipMessage('Создаём тестовый клип: сохраняем OBS replay, ищем файл и режем ffmpeg...')
    try {
      const api = getTradeCutApi()
      const clip = await api.clips.createTest()
      setClipMessage(`Клип создан: ${clip.title}`)
      await loadLocalState()
    } catch (error) {
      setClipMessage(error instanceof Error ? error.message : 'Не удалось создать клип')
    }
  }

  useEffect(() => {
    void loadLocalState()
    const interval = window.setInterval(() => void refreshPendingClips(), 2_000)
    return () => window.clearInterval(interval)
  }, [])

  const integrations = useMemo(() => [
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
    },
    {
      name: 'YouTube загрузка',
      description: settings?.youtube.authorized
        ? 'Google OAuth подключён. Кнопка в очереди загружает клип на YouTube.'
        : settings?.youtube.oauthClientConfigured
          ? 'Google OAuth готов. Авторизуйтесь, чтобы включить экспорт.'
          : 'Google OAuth не настроен в этой сборке приложения.',
      status: settings?.youtube.authorized ? 'Готово' : 'Нужно настроить',
      tone: settings?.youtube.authorized ? 'success' as const : 'warning' as const
    },
    {
      name: 'Trader Make Money',
      description: 'Граница адаптера готова. Ждём API-ключ и схему дневника.',
      status: 'Заглушка',
      tone: 'purple' as const
    },
    {
      name: 'Подписка и доступ',
      description: 'Telegram-регистрация, промокоды и Discord-gate заложены в серверный план.',
      status: settings?.access.subscriptionRequired ? 'Обязательно' : 'Выключено',
      tone: 'neutral' as const
    }
  ], [obs, settings, binanceWatch])

  return (
    <>
      <TopBar appVersion={appVersion} onRunHealthCheck={runHealthCheck} onOpenSetupWizard={() => setSetupWizardOpen(true)} />
      <SetupWizard
        open={setupWizardOpen}
        settings={settings}
        obsMessage={lastCheck?.message ?? obs.message}
        clipMessage={clipMessage}
        onClose={() => setSetupWizardOpen(false)}
        onSaved={(nextSettings) => {
          setSettings(nextSettings)
          void loadLocalState()
        }}
        onRunHealthCheck={runHealthCheck}
        onCreateTestClip={createTestClip}
      />
      <div id="dashboard-top" className="mt-6 grid grid-cols-12 gap-4 pb-8">
        <section id="clip-queue" className="col-span-12 scroll-mt-4">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="m-0 text-xl font-semibold tracking-[-0.03em]">Очередь проверки</h2>
              <p className="mt-1 text-sm text-zinc-500">Клипы остаются локально, пока вы вручную не подтвердите загрузку в YouTube.</p>
              {clipMessage && <p className="mt-2 text-sm text-violet-200">{clipMessage}</p>}
            </div>
            <button className="cursor-pointer whitespace-nowrap rounded-2xl border border-violet-400/30 bg-violet-500/15 px-4 py-2 text-sm font-medium text-violet-100 transition hover:bg-violet-500/25" onClick={createTestClip}>Создать тестовый клип</button>
          </div>
          <div className="space-y-3">
            {clips.length > 0 ? clips.map((clip) => (
              <ClipCard
                key={clip.id}
                clip={clip}
                onChanged={(updatedClip) => setClips((current) => current.map((item) => item.id === updatedClip.id ? updatedClip : item))}
                onDeleted={(deletedClip) => setClips((current) => current.filter((item) => item.metadataPath !== deletedClip.metadataPath))}
              />
            )) : <div className="rounded-3xl border border-dashed border-white/10 p-6 text-sm text-zinc-500">Пока нет локальных клипов на проверке.</div>}
          </div>
        </section>
        <section id="integrations-section" className="col-span-12 grid scroll-mt-4 gap-4 lg:grid-cols-2">
          {integrations.map((integration) => <IntegrationStatusCard key={integration.name} {...integration} />)}
        </section>
        <section id="settings-section" className="col-span-12 scroll-mt-4 space-y-4">
          <YouTubeSettingsPanel settings={settings} onSaved={(nextSettings) => {
            setSettings(nextSettings)
            void loadLocalState()
          }} />
          <BinanceFuturesSettingsPanel settings={settings} onSaved={(nextSettings) => {
            setSettings(nextSettings)
            void loadLocalState()
          }} />
          <ObsSettingsPanel settings={settings} onSaved={(nextSettings) => {
            setSettings(nextSettings)
            void loadLocalState()
          }} />
        </section>
      </div>
    </>
  )
}
