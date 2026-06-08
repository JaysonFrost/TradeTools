import { ArrowLeft, ArrowRight, CheckCircle2, FolderOpen, Route, Server, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AppSettings } from '../../../main/services/settings/settings'
import type { ProxyChainInstructionResult } from '../../../preload'
import { defaultLocalProxyPort } from '../../../shared/defaults'
import type { AppPage } from '../../lib/navigation'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'
import { proxySetupWizardSteps, videoSetupWizardSteps } from './setupWizardSteps'
import { Button } from '../ui/Button'

export type SetupWizardProps = {
  mode: Exclude<AppPage, 'support'>
  open: boolean
  settings?: AppSettings
  obsMessage: string
  clipMessage: string
  onClose: () => void
  onSaved: (settings: AppSettings) => void
  onRunHealthCheck: () => Promise<string>
  onCreateTestClip: () => Promise<void>
}

const inputClass = 'mt-1 w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-violet-400/60'
const compactInputClass = inputClass.replace('mt-1 ', '')

const proxyName = (settings: AppSettings | undefined, proxyId: string): string => {
  const proxy = settings?.proxies.find((item) => item.id === proxyId)
  return proxy?.name || proxy?.server || 'Сервер'
}

const proxyPresetNames = ['Edgecenter', 'Vultr']
const currentPaymentDueDay = (): string => String(new Date().getDate())
const defaultProxyTitle = (settings?: AppSettings): string => proxyPresetNames[settings?.proxies.length ?? 0] ?? ''

export const SetupWizard = ({ mode, open, settings, obsMessage, clipMessage, onClose, onSaved, onRunHealthCheck, onCreateTestClip }: SetupWizardProps) => {
  const steps = mode === 'video' ? videoSetupWizardSteps : proxySetupWizardSteps
  const [stepIndex, setStepIndex] = useState(0)
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('4455')
  const [obsPassword, setObsPassword] = useState('')
  const [replaySourceDir, setReplaySourceDir] = useState('')
  const [outputDir, setOutputDir] = useState('')
  const [paddingBefore, setPaddingBefore] = useState('2')
  const [paddingAfter, setPaddingAfter] = useState('2')
  const [binanceApiKey, setBinanceApiKey] = useState('')
  const [binanceApiSecret, setBinanceApiSecret] = useState('')
  const [binanceTestnet, setBinanceTestnet] = useState(false)
  const [proxyTitle, setProxyTitle] = useState(defaultProxyTitle())
  const [proxyServer, setProxyServer] = useState('')
  const [proxyLogin, setProxyLogin] = useState('root')
  const [proxyPassword, setProxyPassword] = useState('')
  const [proxyDashboardUrl, setProxyDashboardUrl] = useState('')
  const [proxyPaymentDueDay, setProxyPaymentDueDay] = useState(currentPaymentDueDay())
  const [proxyLocalPort, setProxyLocalPort] = useState(String(defaultLocalProxyPort))
  const [proxyNotes, setProxyNotes] = useState('')
  const [selectedProxyId, setSelectedProxyId] = useState('')
  const [chainResult, setChainResult] = useState<ProxyChainInstructionResult>()
  const [saving, setSaving] = useState(false)
  const [checkingVideo, setCheckingVideo] = useState(false)
  const [testingBinance, setTestingBinance] = useState(false)
  const [localMessage, setLocalMessage] = useState('')

  const resetProxyDraft = (nextSettings = settings) => {
    setProxyTitle(defaultProxyTitle(nextSettings))
    setProxyServer('')
    setProxyLogin('root')
    setProxyPassword('')
    setProxyDashboardUrl('')
    setProxyPaymentDueDay(currentPaymentDueDay())
    setProxyLocalPort(String(defaultLocalProxyPort))
    setProxyNotes('')
  }

  useEffect(() => {
    if (!open) return
    setStepIndex(0)
    setLocalMessage('')
    setChainResult(undefined)
    if (mode === 'proxy') resetProxyDraft(settings)
  }, [open, mode])

  useEffect(() => {
    if (!settings) return
    setHost(settings.obs.host)
    setPort(String(settings.obs.port))
    setReplaySourceDir(settings.clip.replaySourceDir)
    setOutputDir(settings.clip.outputDir)
    setPaddingBefore(String(settings.clip.paddingBeforeSeconds))
    setPaddingAfter(String(settings.clip.paddingAfterSeconds))
    setBinanceTestnet(settings.exchange.binanceFutures.testnet)
  }, [settings])

  useEffect(() => {
    if (!settings?.proxies.length) {
      setSelectedProxyId('')
      return
    }

    if (!selectedProxyId || !settings.proxies.some((proxy) => proxy.id === selectedProxyId)) {
      setSelectedProxyId(settings.proxies[0]?.id ?? '')
    }
  }, [selectedProxyId, settings])

  const step = steps[stepIndex]
  const progress = useMemo(() => Math.round(((stepIndex + 1) / steps.length) * 100), [stepIndex, steps.length])

  if (!open || !step) return null

  const saveVideoSettings = async () => {
    setSaving(true)
    setLocalMessage('')
    try {
      const api = getTradeToolsApi()
      const updated = await api.settings.update({
        obsPassword: obsPassword.trim() || undefined,
        obs: {
          host,
          port: Number(port)
        },
        clip: {
          replaySourceDir,
          outputDir,
          paddingBeforeSeconds: Number(paddingBefore),
          paddingAfterSeconds: Number(paddingAfter)
        }
      })
      onSaved(updated)
      setObsPassword('')
      setLocalMessage('Настройки видео сохранены')
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : 'Не удалось сохранить настройки видео')
    } finally {
      setSaving(false)
    }
  }

  const saveProxyServer = async () => {
    setSaving(true)
    setLocalMessage('')
    try {
      const api = getTradeToolsApi()
      const updated = await api.proxies.save({
        name: proxyTitle,
        server: proxyServer,
        login: proxyLogin,
        password: proxyPassword || undefined,
        dashboardUrl: proxyDashboardUrl,
        paymentDueDay: Number(proxyPaymentDueDay) || undefined,
        nextProxyId: '',
        localProxyPort: Number(proxyLocalPort) || defaultLocalProxyPort,
        notes: proxyNotes
      })
      onSaved(updated)
      const latestProxy = updated.proxies.at(-1)
      setSelectedProxyId(latestProxy?.id ?? '')
      resetProxyDraft(updated)
      setLocalMessage('Сервер сохранён')
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : 'Не удалось сохранить сервер')
    } finally {
      setSaving(false)
    }
  }

  const saveBinanceSettings = async () => {
    const apiKey = binanceApiKey.trim()
    const apiSecret = binanceApiSecret.trim()
    const binanceConfigured = settings?.exchange.binanceFutures.apiKeyConfigured && settings.exchange.binanceFutures.apiSecretConfigured
    if (!apiKey && !apiSecret && !binanceConfigured) {
      setLocalMessage('Введите API Key и API Secret или нажмите «Дальше», чтобы пропустить этот шаг.')
      return
    }
    if ((apiKey || apiSecret) && (!apiKey || !apiSecret)) {
      setLocalMessage('Для Binance Futures укажите и API Key, и API Secret.')
      return
    }

    setSaving(true)
    setLocalMessage('')
    try {
      const updated = await getTradeToolsApi().settings.update({
        exchange: {
          binanceFutures: {
            enabled: settings?.exchange.binanceFutures.enabled ?? false,
            testnet: binanceTestnet
          }
        },
        binanceFuturesApiKey: apiKey || undefined,
        binanceFuturesApiSecret: apiSecret || undefined
      })
      onSaved(updated)
      setBinanceApiKey('')
      setBinanceApiSecret('')
      setLocalMessage(apiKey && apiSecret ? 'Binance Futures ключи сохранены' : 'Binance Futures настройки сохранены')
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : 'Не удалось сохранить Binance Futures')
    } finally {
      setSaving(false)
    }
  }

  const testBinanceConnection = async () => {
    setTestingBinance(true)
    setLocalMessage('Проверяем Binance Futures...')
    try {
      const status = await getTradeToolsApi().binance.testFuturesConnection()
      setLocalMessage(status.message)
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : 'Не удалось проверить Binance Futures')
    } finally {
      setTestingBinance(false)
    }
  }

  const checkProxyChain = async () => {
    if (!selectedProxyId) {
      setLocalMessage('Сначала добавьте или выберите первый сервер маршрута.')
      return
    }

    setSaving(true)
    setLocalMessage('')
    setChainResult(undefined)
    try {
      const result = await getTradeToolsApi().proxies.configureChain(selectedProxyId)
      setChainResult(result)
      setLocalMessage('SSH-подключение проверено, инструкция готова')
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : 'Не удалось проверить связку')
    } finally {
      setSaving(false)
    }
  }

  const runVideoHealthCheck = async () => {
    setCheckingVideo(true)
    setLocalMessage('Проверяем OBS WebSocket и Replay Buffer...')
    try {
      const message = await onRunHealthCheck()
      setLocalMessage(message || 'Проверка видео завершена')
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : 'Не удалось проверить видео')
    } finally {
      setCheckingVideo(false)
    }
  }

  const selectDirectory = async (currentPath: string, setValue: (value: string) => void) => {
    try {
      const api = getTradeToolsApi()
      const selectedPath = await api.dialog.selectDirectory(currentPath.trim() || undefined)
      if (!selectedPath) return
      setValue(selectedPath)
      setLocalMessage('Папка выбрана. Не забудьте сохранить этот шаг.')
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : 'Не удалось открыть выбор папки')
    }
  }

  const runStepAction = async (actionIndex: number) => {
    setLocalMessage('')

    if (step.id === 'video-welcome') {
      changeStep(actionIndex === 0 ? 1 : actionIndex === 1 ? 3 : actionIndex === 2 ? 4 : 5)
      return
    }

    if (step.id === 'proxy-welcome') {
      changeStep(actionIndex === 0 ? 1 : actionIndex === 1 ? 2 : 3)
      return
    }

    if (step.id === 'obs-websocket') {
      setLocalMessage(actionIndex === 3 ? 'Введите пароль ниже и нажмите «Сохранить этот шаг».' : 'Выполните этот пункт в OBS, затем вернитесь в мастер.')
      return
    }

    if (step.id === 'obs-replay') {
      if (actionIndex === step.actions.length - 1) {
        await runVideoHealthCheck()
      } else {
        setLocalMessage('Выполните этот пункт в OBS. После запуска Replay Buffer нажмите проверку видео.')
      }
      return
    }

    if (step.id === 'folders') {
      if (actionIndex === 0) {
        await selectDirectory(replaySourceDir, setReplaySourceDir)
      } else if (actionIndex === 1) {
        await selectDirectory(outputDir, setOutputDir)
      } else {
        setLocalMessage('Задайте отступы ниже и нажмите «Сохранить этот шаг».')
      }
      return
    }

    if (step.id === 'test-clip') {
      await onCreateTestClip()
      return
    }

    if (step.id === 'trade-source') {
      if (actionIndex === step.actions.length - 1) {
        await testBinanceConnection()
      } else {
        setLocalMessage('Заполните API Key и API Secret ниже, затем нажмите «Сохранить ключи».')
      }
      return
    }

    if (step.id === 'proxy-server') {
      setLocalMessage('Заполните форму ниже и нажмите «Сохранить сервер».')
      return
    }

    if (step.id === 'proxy-chain') {
      setLocalMessage('Добавьте все серверы, закройте мастер и перетащите их в нужном порядке в блоке «Порядок связки» на странице прокси.')
      return
    }

    if (step.id === 'proxy-check') {
      await checkProxyChain()
      return
    }

    if (step.id === 'video-done' || step.id === 'proxy-done') {
      onClose()
      return
    }

    setLocalMessage('Этот пункт пока информационный.')
  }

  const changeStep = (target: number | ((current: number) => number)) => {
    setLocalMessage('')
    setStepIndex((current) => {
      const nextIndex = typeof target === 'function' ? target(current) : target
      return Math.min(Math.max(nextIndex, 0), steps.length - 1)
    })
  }

  const next = () => changeStep((value) => value + 1)
  const previous = () => changeStep((value) => value - 1)
  const statusMessage = localMessage || (mode === 'video'
    ? step.id === 'obs-replay'
      ? obsMessage
      : step.id === 'test-clip'
        ? clipMessage
        : ''
    : '')

  const resultText = () => {
    switch (step.id) {
      case 'video-welcome':
        return 'Вы пройдёте только видео-настройки, не смешивая их с прокси.'
      case 'obs-websocket':
        return 'Приложение сможет безопасно подключаться к OBS и отправлять команду сохранения replay.'
      case 'obs-replay':
        return 'OBS начнет держать последние минуты записи в памяти и отдавать их по команде.'
      case 'folders':
        return 'TradeTools будет знать, где найти исходный replay и куда положить готовый клип.'
      case 'trade-source':
        return 'Ключи сохранятся в системном keychain, а TradeTools сможет отслеживать Binance Futures.'
      case 'test-clip':
        return 'В очереди проверки появится реальный локальный MP4 с metadata JSON.'
      case 'proxy-welcome':
        return 'Вы пройдёте только прокси-настройки: серверы, связка, SSH-проверка, инструкция.'
      case 'proxy-server':
        return 'Сервер появится в хранилище, а пароль сохранится в системный keychain.'
      case 'proxy-chain':
        return 'После добавления серверов вы сможете собрать маршрут перетаскиванием: первый сервер -> следующий -> exit-сервер.'
      case 'proxy-check':
        return 'TradeTools проверит SSH-доступ к каждому серверу и покажет настройки для торгового терминала.'
      case 'proxy-done':
        return 'Прокси-страница станет местом для оплаты, доступа и проверки маршрутов.'
      default:
        return 'Можно закрыть мастер и пользоваться основным экраном.'
    }
  }

  const actionButtons = (
    <div className="space-y-3">
      {step.actions.map((action, index) => (
        <button key={action} type="button" className="flex w-full cursor-pointer gap-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-left text-sm text-zinc-300 transition hover:border-violet-400/40 hover:bg-violet-500/10 hover:text-zinc-100" onClick={() => void runStepAction(index)}>
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-violet-300" />
          <span>{action}</span>
        </button>
      ))}
    </div>
  )

  const folderFields = step.id === 'folders' ? (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <div className="text-xs font-medium text-zinc-500">Папка OBS replay</div>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <input className={`${compactInputClass} min-w-0 flex-1`} value={replaySourceDir} onChange={(event) => setReplaySourceDir(event.target.value)} />
          <Button variant="ghost" onClick={() => void selectDirectory(replaySourceDir, setReplaySourceDir)}><FolderOpen size={16} className="mr-2" />Выбрать</Button>
        </div>
      </div>
      <div className="md:col-span-2">
        <div className="text-xs font-medium text-zinc-500">Папка клипов</div>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <input className={`${compactInputClass} min-w-0 flex-1`} value={outputDir} onChange={(event) => setOutputDir(event.target.value)} />
          <Button variant="ghost" onClick={() => void selectDirectory(outputDir, setOutputDir)}><FolderOpen size={16} className="mr-2" />Выбрать</Button>
        </div>
      </div>
      <label className="text-xs font-medium text-zinc-500">Секунд до входа<input className={inputClass} value={paddingBefore} onChange={(event) => setPaddingBefore(event.target.value)} inputMode="numeric" /></label>
      <label className="text-xs font-medium text-zinc-500">Секунд после выхода<input className={inputClass} value={paddingAfter} onChange={(event) => setPaddingAfter(event.target.value)} inputMode="numeric" /></label>
    </div>
  ) : null

  const binanceFields = step.id === 'trade-source' ? (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
      <label className="text-xs font-medium text-zinc-500">
        API Key
        <input className={inputClass} value={binanceApiKey} onChange={(event) => setBinanceApiKey(event.target.value)} type="password" placeholder={settings?.exchange.binanceFutures.apiKeyConfigured ? 'Сохранён' : 'Не задан'} />
      </label>
      <label className="text-xs font-medium text-zinc-500">
        API Secret
        <input className={inputClass} value={binanceApiSecret} onChange={(event) => setBinanceApiSecret(event.target.value)} type="password" placeholder={settings?.exchange.binanceFutures.apiSecretConfigured ? 'Сохранён' : 'Не задан'} />
      </label>
      <label className="mt-6 flex items-center gap-2 text-sm text-zinc-300">
        <input className="h-4 w-4 accent-violet-500" checked={binanceTestnet} onChange={(event) => setBinanceTestnet(event.target.checked)} type="checkbox" />
        Testnet
      </label>
    </div>
  ) : null

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center overflow-hidden bg-black/70 p-2 backdrop-blur-xl sm:p-4 lg:items-center lg:p-6">
      <div className="flex h-full max-h-[calc(100dvh-16px)] w-full max-w-6xl overflow-hidden rounded-[24px] border border-white/10 bg-[#0b0c10] shadow-[0_24px_90px_rgba(0,0,0,0.65)] sm:max-h-[calc(100dvh-32px)] lg:max-h-[90dvh] lg:rounded-[32px]">
        <aside className="hidden w-72 shrink-0 border-r border-white/10 bg-white/[0.03] p-5 lg:block">
          <div className="text-sm font-semibold text-zinc-200">{mode === 'video' ? 'Настройка видео' : 'Настройка прокси'}</div>
          <div className="mt-2 h-2 rounded-full bg-white/10">
            <div className="h-full rounded-full bg-violet-500" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-5 space-y-2">
            {steps.map((item, index) => (
              <button
                key={item.id}
                className={`flex w-full cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm transition ${index === stepIndex ? 'bg-violet-500/20 text-violet-100' : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300'}`}
                onClick={() => changeStep(index)}
              >
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${index < stepIndex ? 'bg-emerald-400 text-black' : index === stepIndex ? 'bg-violet-500 text-white' : 'bg-white/10 text-zinc-500'}`}>{index < stepIndex ? '✓' : index + 1}</span>
                <span>{item.title}</span>
              </button>
            ))}
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-white/10 p-4 sm:p-6">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.24em] text-violet-300">Шаг {stepIndex + 1} из {steps.length}</div>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-zinc-100 sm:text-3xl">{step.title}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{step.goal}</p>
            </div>
            <button className="cursor-pointer rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-zinc-400 transition hover:text-zinc-100" onClick={onClose} aria-label="Закрыть пошаговую настройку">
              <X size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_240px]">
              <section className="min-w-0 rounded-[24px] border border-white/10 bg-white/[0.03] p-4 sm:p-5">
                <div className="mb-4 rounded-2xl border border-violet-400/20 bg-violet-500/10 p-3 text-sm leading-5 text-zinc-300 xl:hidden">
                  <span className="font-semibold text-violet-100">Что получится: </span>{resultText()}
                </div>
                {step.id === 'folders' ? folderFields : step.id === 'trade-source' ? binanceFields : actionButtons}
                {step.id === 'obs-websocket' && (
                  <div className="mt-5 grid gap-4 md:grid-cols-3">
                    <label className="text-xs font-medium text-zinc-500">OBS host<input className={inputClass} value={host} onChange={(event) => setHost(event.target.value)} /></label>
                    <label className="text-xs font-medium text-zinc-500">OBS port<input className={inputClass} value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" /></label>
                    <label className="text-xs font-medium text-zinc-500">OBS пароль<input className={inputClass} value={obsPassword} onChange={(event) => setObsPassword(event.target.value)} type="password" placeholder={settings?.obs.passwordConfigured ? 'Сохранён' : 'Не задан'} /></label>
                  </div>
                )}
                {step.id === 'folders' && <div className="mt-5">{actionButtons}</div>}
                {step.id === 'trade-source' && (
                  <>
                    <div className="mt-5">{actionButtons}</div>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <Button onClick={saveBinanceSettings} disabled={saving}>{saving ? 'Сохраняем...' : 'Сохранить ключи'}</Button>
                      <Button variant="ghost" onClick={() => void testBinanceConnection()} disabled={testingBinance}>{testingBinance ? 'Проверяем...' : 'Проверить Binance'}</Button>
                    </div>
                  </>
                )}
                {step.id === 'proxy-server' && (
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <label className="text-xs font-medium text-zinc-500">Название<input className={inputClass} value={proxyTitle} onChange={(event) => setProxyTitle(event.target.value)} placeholder="Tokyo exit / Hetzner #1" /></label>
                    <label className="text-xs font-medium text-zinc-500">IP или домен<input className={inputClass} value={proxyServer} onChange={(event) => setProxyServer(event.target.value)} placeholder="1.2.3.4" /></label>
                    <label className="text-xs font-medium text-zinc-500">SSH-логин<input className={inputClass} value={proxyLogin} onChange={(event) => setProxyLogin(event.target.value)} /></label>
                    <label className="text-xs font-medium text-zinc-500">SSH-пароль<input className={inputClass} value={proxyPassword} onChange={(event) => setProxyPassword(event.target.value)} type="password" /></label>
                    <label className="text-xs font-medium text-zinc-500">Сайт хостинга<input className={inputClass} value={proxyDashboardUrl} onChange={(event) => setProxyDashboardUrl(event.target.value)} placeholder="https://..." /></label>
                    <label className="text-xs font-medium text-zinc-500">День оплаты в месяце<input className={inputClass} value={proxyPaymentDueDay} onChange={(event) => setProxyPaymentDueDay(event.target.value)} type="number" min="1" max="31" inputMode="numeric" /></label>
                    <label className="text-xs font-medium text-zinc-500">Локальный порт терминала<input className={inputClass} value={proxyLocalPort} onChange={(event) => setProxyLocalPort(event.target.value)} inputMode="numeric" /></label>
                    <label className="text-xs font-medium text-zinc-500 md:col-span-2">Заметки<textarea className={`${inputClass} min-h-20 resize-none`} value={proxyNotes} onChange={(event) => setProxyNotes(event.target.value)} /></label>
                  </div>
                )}
                {step.id === 'proxy-check' && (
                  <div className="mt-5 space-y-4">
                    <label className="block text-xs font-medium text-zinc-500">Первый сервер маршрута
                      <select className={`${inputClass} appearance-none`} value={selectedProxyId} onChange={(event) => setSelectedProxyId(event.target.value)}>
                        <option value="">Сервер не выбран</option>
                        {settings?.proxies.map((proxy) => <option key={proxy.id} value={proxy.id}>{proxy.name || proxy.server}</option>)}
                      </select>
                    </label>
                    {chainResult && (
                      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-xs leading-5 text-zinc-200">
                        <div className="mb-2 flex items-center gap-2 font-semibold text-emerald-100"><Route size={15} />{chainResult.route}</div>
                        {chainResult.sshChecks.map((check) => (
                          <div key={`${check.host}:${check.port}`} className="text-zinc-400">{check.host}:{check.port} - {check.message}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {step.id === 'test-clip' && <Button className="mt-5" onClick={onCreateTestClip}>Создать тестовый клип</Button>}
                {(step.id === 'obs-websocket' || step.id === 'folders') && <Button className="mt-5" onClick={saveVideoSettings} disabled={saving}>{saving ? 'Сохраняем...' : 'Сохранить этот шаг'}</Button>}
                {step.id === 'proxy-server' && <Button className="mt-5" onClick={saveProxyServer} disabled={saving}><Server size={16} className="mr-2" />{saving ? 'Сохраняем...' : 'Сохранить сервер'}</Button>}
                {step.id === 'proxy-check' && <Button className="mt-5" onClick={checkProxyChain} disabled={saving}>{saving ? 'Проверяем...' : 'Проверить SSH и собрать инструкцию'}</Button>}
              </section>
              <aside className="hidden rounded-[24px] border border-violet-400/20 bg-violet-500/10 p-4 xl:block">
                <div className="text-sm font-semibold text-violet-100">Что получится после шага</div>
                <p className="mt-3 text-sm leading-6 text-zinc-300">{resultText()}</p>
                {mode === 'proxy' && settings?.proxies.length ? (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs leading-5 text-zinc-400">
                    <div className="font-semibold text-zinc-200">Сейчас сохранено</div>
                    {settings.proxies.slice(0, 4).map((proxy) => (
                      <div key={proxy.id}>{proxy.name || proxy.server}{proxy.nextProxyId ? ` -> ${proxyName(settings, proxy.nextProxyId)}` : ''}</div>
                    ))}
                  </div>
                ) : null}
              </aside>
            </div>
          </div>
          {statusMessage && (
            <div className="max-h-24 overflow-auto border-t border-violet-400/20 bg-violet-400/10 px-4 py-3 text-sm leading-5 text-violet-100 sm:px-6">
              {statusMessage}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 p-4 sm:p-6">
            <Button variant="ghost" onClick={previous} disabled={stepIndex === 0}><ArrowLeft size={16} className="mr-2" />Назад</Button>
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              {step.id === 'obs-replay' && <Button onClick={() => void runVideoHealthCheck()} disabled={checkingVideo}>{checkingVideo ? 'Проверяем...' : 'Проверить видео'}</Button>}
              {stepIndex === steps.length - 1 ? <Button onClick={onClose}>Закрыть мастер</Button> : <Button onClick={next}>Дальше<ArrowRight size={16} className="ml-2" /></Button>}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
