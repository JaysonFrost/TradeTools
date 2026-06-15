import { ArrowLeft, ArrowRight, CheckCircle2, CircleHelp, Clock3, FolderOpen, Monitor, Radio, RefreshCw, Route, Server, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { WindowCaptureSource } from '../../../main/services/recording/windowRecorderService'
import type { AppSettings } from '../../../main/services/settings/settings'
import type { ProxyChainInstructionResult, ProxyChainSetupProgress, ProxyChainSetupResult } from '../../../preload'
import { defaultLocalProxyPort } from '../../../shared/defaults'
import { defaultClipPaddingAfterSeconds, defaultClipPaddingBeforeSeconds, defaultReplayBufferSeconds, longClipAfterExitSeconds, longClipPresetSeconds } from '../../../shared/videoDefaults'
import type { AppPage } from '../../lib/navigation'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'
import { findPreferredTerminalSource } from '../../lib/windowCaptureSources'
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
const segmentSecondsHint = 'Размер одного куска записи. Обычно 2с: статус обновляется часто, а файлов не слишком много. Это не общая длина хранения.'
const replayBufferSecondsHint = 'Сколько секунд видео TradeTools держит до входа в сделку. Это должно быть не меньше поля «Секунд до входа».'

const FieldHint = ({ text }: { text: string }) => (
  <span className="ml-1 inline-flex align-middle text-zinc-500 transition hover:text-violet-200" title={text}>
    <CircleHelp size={13} />
  </span>
)

const proxyName = (settings: AppSettings | undefined, proxyId: string): string => {
  const proxy = settings?.proxies.find((item) => item.id === proxyId)
  return proxy?.name || proxy?.server || 'Сервер'
}

const proxyPresetNames = ['Edgecenter', 'Vultr']
const currentPaymentDueDay = (): string => String(new Date().getDate())
const defaultProxyTitle = (settings?: AppSettings, offset = 0): string => proxyPresetNames[(settings?.proxies.length ?? 0) + offset] ?? ''

const progressStatusLabel = (status: ProxyChainSetupProgress['status']): string => {
  if (status === 'success') return 'OK'
  if (status === 'error') return 'ERR'
  if (status === 'info') return 'INFO'
  return '...'
}

const progressStatusClass = (status: ProxyChainSetupProgress['status']): string => {
  if (status === 'success') return 'text-emerald-300'
  if (status === 'error') return 'text-rose-300'
  if (status === 'info') return 'text-amber-300'
  return 'text-sky-300'
}

const userFacingErrorMessage = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error)) return fallback

  return error.message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
}

export const SetupWizard = ({ mode, open, settings, obsMessage, clipMessage, onClose, onSaved, onRunHealthCheck, onCreateTestClip }: SetupWizardProps) => {
  const steps = mode === 'video' ? videoSetupWizardSteps : proxySetupWizardSteps
  const [stepIndex, setStepIndex] = useState(0)
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('4455')
  const [obsPassword, setObsPassword] = useState('')
  const [recordingMode, setRecordingMode] = useState<AppSettings['recording']['mode']>('window')
  const [sourceType, setSourceType] = useState<AppSettings['recording']['sourceType']>('window')
  const [windowSourceId, setWindowSourceId] = useState('')
  const [windowSourceName, setWindowSourceName] = useState('')
  const [frameRate, setFrameRate] = useState('30')
  const [segmentSeconds, setSegmentSeconds] = useState('2')
  const [windowSources, setWindowSources] = useState<WindowCaptureSource[]>([])
  const [loadingSources, setLoadingSources] = useState(false)
  const [replaySourceDir, setReplaySourceDir] = useState('')
  const [outputDir, setOutputDir] = useState('')
  const [paddingBefore, setPaddingBefore] = useState(String(defaultClipPaddingBeforeSeconds))
  const [paddingAfter, setPaddingAfter] = useState(String(defaultClipPaddingAfterSeconds))
  const [replayBufferSeconds, setReplayBufferSeconds] = useState(String(defaultReplayBufferSeconds))
  const [proxyTitle, setProxyTitle] = useState(defaultProxyTitle())
  const [proxyServer, setProxyServer] = useState('')
  const [proxyLogin, setProxyLogin] = useState('root')
  const [proxyPassword, setProxyPassword] = useState('')
  const [proxyDashboardUrl, setProxyDashboardUrl] = useState('')
  const [proxyPaymentDueDay, setProxyPaymentDueDay] = useState(currentPaymentDueDay())
  const [proxyLocalPort, setProxyLocalPort] = useState(String(defaultLocalProxyPort))
  const [proxyNotes, setProxyNotes] = useState('')
  const [secondProxyTitle, setSecondProxyTitle] = useState(defaultProxyTitle(undefined, 1))
  const [secondProxyServer, setSecondProxyServer] = useState('')
  const [secondProxyLogin, setSecondProxyLogin] = useState('root')
  const [secondProxyPassword, setSecondProxyPassword] = useState('')
  const [secondProxyDashboardUrl, setSecondProxyDashboardUrl] = useState('')
  const [secondProxyPaymentDueDay, setSecondProxyPaymentDueDay] = useState(currentPaymentDueDay())
  const [secondProxyLocalPort, setSecondProxyLocalPort] = useState(String(defaultLocalProxyPort))
  const [secondProxyNotes, setSecondProxyNotes] = useState('')
  const [savedWizardProxyIds, setSavedWizardProxyIds] = useState<string[]>([])
  const [selectedProxyId, setSelectedProxyId] = useState('')
  const [chainResult, setChainResult] = useState<ProxyChainInstructionResult>()
  const [chainSetupResult, setChainSetupResult] = useState<ProxyChainSetupResult>()
  const [chainCheckProgress, setChainCheckProgress] = useState<ProxyChainSetupProgress[]>([])
  const [chainSetupProgress, setChainSetupProgress] = useState<ProxyChainSetupProgress[]>([])
  const [saving, setSaving] = useState(false)
  const [checkingVideo, setCheckingVideo] = useState(false)
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
    setSecondProxyTitle(defaultProxyTitle(nextSettings, 1))
    setSecondProxyServer('')
    setSecondProxyLogin('root')
    setSecondProxyPassword('')
    setSecondProxyDashboardUrl('')
    setSecondProxyPaymentDueDay(currentPaymentDueDay())
    setSecondProxyLocalPort(String(defaultLocalProxyPort))
    setSecondProxyNotes('')
    setSavedWizardProxyIds([])
  }

  useEffect(() => {
    if (!open) return
    setStepIndex(0)
    setLocalMessage('')
    setChainResult(undefined)
    setChainSetupResult(undefined)
    setChainCheckProgress([])
    setChainSetupProgress([])
    if (mode === 'proxy') resetProxyDraft(settings)
  }, [open, mode])

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
    setReplaySourceDir(settings.clip.replaySourceDir)
    setOutputDir(settings.clip.outputDir)
    setPaddingBefore(String(settings.clip.paddingBeforeSeconds))
    setPaddingAfter(String(settings.clip.paddingAfterSeconds))
    setReplayBufferSeconds(String(settings.clip.replayBufferSeconds))
  }, [settings])

  const refreshWindowSources = async () => {
    setLoadingSources(true)
    setLocalMessage('')
    try {
      const sources = await getTradeToolsApi().recording.listWindowSources()
      setWindowSources(sources)
      const preferredSource = recordingMode === 'window' && sourceType === 'window' && !windowSourceId && !windowSourceName
        ? findPreferredTerminalSource(sources)
        : undefined
      if (preferredSource) {
        setWindowSourceId(preferredSource.id)
        setWindowSourceName(preferredSource.name)
        setLocalMessage(`Автоматически выбрали окно: ${preferredSource.name}`)
        return
      }
      setLocalMessage(sources.length > 0 ? 'Список окон обновлён' : 'Окна для записи не найдены')
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : 'Не удалось получить список окон')
    } finally {
      setLoadingSources(false)
    }
  }

  useEffect(() => {
    if (!open || mode !== 'video' || recordingMode !== 'window') return
    void refreshWindowSources()
  }, [mode, open, recordingMode])

  useEffect(() => {
    if (!settings?.proxies.length) {
      setSelectedProxyId('')
      return
    }

    if (!selectedProxyId || !settings.proxies.some((proxy) => proxy.id === selectedProxyId)) {
      setSelectedProxyId(settings.proxies[0]?.id ?? '')
    }
  }, [selectedProxyId, settings])

  useEffect(() => {
    if (!open || mode !== 'proxy') return undefined

    let unsubscribeCheck: (() => void) | undefined
    let unsubscribeSetup: (() => void) | undefined
    try {
      const api = getTradeToolsApi()
      unsubscribeCheck = api.proxies.onConfigureChainProgress((progress) => {
        setChainCheckProgress((current) => [...current.slice(-39), progress])
      })
      unsubscribeSetup = api.proxies.onSetupChainProgress((progress) => {
        setChainSetupProgress((current) => [...current.slice(-39), progress])
      })
    } catch {
      // The master can still save forms if progress events are unavailable.
    }

    return () => {
      unsubscribeCheck?.()
      unsubscribeSetup?.()
    }
  }, [mode, open])

  const step = steps[stepIndex]
  const progress = useMemo(() => Math.round(((stepIndex + 1) / steps.length) * 100), [stepIndex, steps.length])
  const filteredSources = windowSources.filter((source) => source.type === sourceType)
  const stepActionLabels = useMemo(() => {
    if (!step) return []
    if (mode === 'video' && step.id === 'obs-websocket') {
      return [
        'Использовать встроенную запись окна или экрана',
        'Использовать OBS Replay Buffer',
        'Сохранить выбранный режим записи'
      ]
    }
    if (mode === 'video' && step.id === 'obs-replay' && recordingMode === 'window') {
      return [
        'Откройте окно торгового терминала',
        'Если окно не выбрано, TradeTools попробует выбрать его автоматически',
        'Нажмите проверку видео'
      ]
    }
    if (mode === 'video' && step.id === 'folders' && recordingMode === 'window') {
      return [
        'Выбрать папку готовых клипов',
        'Поставить секунды до входа и после выхода'
      ]
    }

    return step.actions
  }, [mode, recordingMode, step])

  if (!open || !step) return null

  const saveVideoSettings = async () => {
    setSaving(true)
    setLocalMessage('')
    try {
      const api = getTradeToolsApi()
      const latestSources = recordingMode === 'window' && !windowSourceId && !windowSourceName
        ? await api.recording.listWindowSources()
        : windowSources
      if (latestSources !== windowSources) setWindowSources(latestSources)
      const selectedSource = windowSources.find((source) => source.id === windowSourceId)
        ?? latestSources.find((source) => source.id === windowSourceId)
        ?? (recordingMode === 'window' && sourceType === 'window' ? findPreferredTerminalSource(latestSources) : undefined)
      const parsedPaddingBeforeSeconds = Number(paddingBefore)
      const parsedReplayBufferSeconds = Number(replayBufferSeconds)
      const paddingBeforeSeconds = Number.isFinite(parsedPaddingBeforeSeconds) ? parsedPaddingBeforeSeconds : 0
      const replayBufferSecondsValue = recordingMode === 'window'
        ? Math.max(Number.isFinite(parsedReplayBufferSeconds) ? parsedReplayBufferSeconds : 0, paddingBeforeSeconds)
        : parsedReplayBufferSeconds
      const updated = await api.settings.update({
        obsPassword: obsPassword.trim() || undefined,
        recording: {
          mode: recordingMode,
          sourceType: selectedSource?.type ?? sourceType,
          windowSourceId: selectedSource?.id ?? windowSourceId,
          windowSourceName: selectedSource?.name ?? windowSourceName,
          frameRate: Number(frameRate),
          segmentSeconds: Number(segmentSeconds)
        },
        obs: {
          host,
          port: Number(port)
        },
        clip: {
          replaySourceDir,
          outputDir,
          paddingBeforeSeconds: Number(paddingBefore),
          paddingAfterSeconds: Number(paddingAfter),
          replayBufferSeconds: replayBufferSecondsValue
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

  const applyDefaultClipPreset = () => {
    setPaddingBefore(String(defaultClipPaddingBeforeSeconds))
    setPaddingAfter(String(defaultClipPaddingAfterSeconds))
    setReplayBufferSeconds(String(defaultReplayBufferSeconds))
    setLocalMessage('Дефолтный пресет включён: 2с до входа, 2с после выхода, буфер 60с.')
  }

  const applyLongClipPreset = () => {
    const beforeSeconds = String(longClipPresetSeconds)
    const afterSeconds = String(longClipAfterExitSeconds)
    setPaddingBefore(beforeSeconds)
    setPaddingAfter(afterSeconds)
    setReplayBufferSeconds(beforeSeconds)
    setLocalMessage(recordingMode === 'window'
      ? 'Пресет включён: 10 минут до входа и 2 минуты после выхода. Клип появится примерно через 2 минуты после выхода.'
      : 'Пресет включён: 10 минут до входа и 2 минуты после выхода. В OBS вручную поставьте Replay Buffer минимум 12 минут плюс обычная длина сделки.')
  }

  const saveProxyServers = async () => {
    if (!proxyServer.trim() || !secondProxyServer.trim()) {
      setLocalMessage('Укажите IP или домен для обоих серверов.')
      return
    }
    if (!proxyPassword.trim() || !secondProxyPassword.trim()) {
      setLocalMessage('Укажите SSH-пароль для обоих серверов.')
      return
    }

    setSaving(true)
    setLocalMessage('')
    setChainResult(undefined)
    setChainSetupResult(undefined)
    setChainCheckProgress([])
    setChainSetupProgress([])
    try {
      const api = getTradeToolsApi()
      const initialSettings = settings
      let updated = await api.proxies.save({
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
      const firstProxy = updated.proxies.find((proxy) => !initialSettings?.proxies.some((existing) => existing.id === proxy.id)) ?? updated.proxies.at(-1)
      const beforeSecondSave = updated
      updated = await api.proxies.save({
        name: secondProxyTitle,
        server: secondProxyServer,
        login: secondProxyLogin,
        password: secondProxyPassword || undefined,
        dashboardUrl: secondProxyDashboardUrl,
        paymentDueDay: Number(secondProxyPaymentDueDay) || undefined,
        nextProxyId: '',
        localProxyPort: Number(secondProxyLocalPort) || defaultLocalProxyPort,
        notes: secondProxyNotes
      })
      const secondProxy = updated.proxies.find((proxy) => !beforeSecondSave.proxies.some((existing) => existing.id === proxy.id)) ?? updated.proxies.at(-1)

      if (!firstProxy || !secondProxy) throw new Error('Серверы сохранены, но мастер не смог определить связку')

      const chainedSettings = await api.settings.update({
        proxies: updated.proxies.map((proxy) => {
          if (proxy.id === firstProxy.id) return { ...proxy, nextProxyId: secondProxy.id }
          if (proxy.id === secondProxy.id) return { ...proxy, nextProxyId: '' }
          return proxy
        })
      })
      onSaved(chainedSettings)
      setSelectedProxyId(firstProxy.id)
      setSavedWizardProxyIds([firstProxy.id, secondProxy.id])
      setProxyPassword('')
      setSecondProxyPassword('')
      setLocalMessage(`Сохранено: ${firstProxy.name || firstProxy.server} -> ${secondProxy.name || secondProxy.server}`)
    } catch (error) {
      setLocalMessage(userFacingErrorMessage(error, 'Не удалось сохранить серверы'))
    } finally {
      setSaving(false)
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
    setChainCheckProgress([])
    try {
      const result = await getTradeToolsApi().proxies.configureChain(selectedProxyId)
      setChainResult(result)
      setLocalMessage('SSH-подключение проверено, инструкция готова')
    } catch (error) {
      setLocalMessage(userFacingErrorMessage(error, 'Не удалось проверить связку'))
    } finally {
      setSaving(false)
    }
  }

  const setupProxyChain = async () => {
    if (!selectedProxyId) {
      setLocalMessage('Сначала добавьте или выберите первый сервер маршрута.')
      return
    }

    setSaving(true)
    setLocalMessage('')
    setChainResult(undefined)
    setChainSetupResult(undefined)
    setChainSetupProgress([])
    try {
      const result = await getTradeToolsApi().proxies.setupChain({ proxyId: selectedProxyId })
      setChainSetupResult(result)
      setLocalMessage('Связка настроена, локальный proxy запущен')
    } catch (error) {
      setLocalMessage(userFacingErrorMessage(error, 'Не удалось настроить связку на серверах'))
    } finally {
      setSaving(false)
    }
  }

  const runVideoHealthCheck = async () => {
    setCheckingVideo(true)
    setLocalMessage(recordingMode === 'window' ? 'Проверяем встроенную запись окна...' : 'Проверяем OBS WebSocket и Replay Buffer...')
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
      changeStep(actionIndex === 0 ? 1 : actionIndex === 1 ? 3 : 4)
      return
    }

    if (step.id === 'proxy-welcome') {
      changeStep(actionIndex === 0 ? 1 : actionIndex === 1 ? 2 : 3)
      return
    }

    if (step.id === 'obs-websocket') {
      if (actionIndex === 0) {
        setRecordingMode('window')
        await refreshWindowSources()
        return
      }
      if (actionIndex === 1) {
        setRecordingMode('obs')
        setLocalMessage('Для OBS введите WebSocket данные ниже и нажмите «Сохранить этот шаг».')
        return
      }
      setLocalMessage(recordingMode === 'window'
        ? 'Откройте терминал и нажмите «Сохранить этот шаг». Если окно найдено, TradeTools выберет его автоматически.'
        : 'Введите пароль OBS WebSocket ниже и нажмите «Сохранить этот шаг».')
      return
    }

    if (step.id === 'obs-replay') {
      if (actionIndex === stepActionLabels.length - 1) {
        await runVideoHealthCheck()
      } else {
        setLocalMessage(recordingMode === 'window'
          ? 'Окно терминала должно быть открыто. После сохранения источника нажмите проверку видео.'
          : 'Выполните этот пункт в OBS. После запуска Replay Buffer нажмите проверку видео.')
      }
      return
    }

    if (step.id === 'folders') {
      if (recordingMode === 'obs' && actionIndex === 0) {
        await selectDirectory(replaySourceDir, setReplaySourceDir)
      } else if ((recordingMode === 'obs' && actionIndex === 1) || (recordingMode === 'window' && actionIndex === 0)) {
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

    if (step.id === 'proxy-server') {
      setLocalMessage('Заполните оба сервера ниже и нажмите «Сохранить два сервера и связку».')
      return
    }

    if (step.id === 'proxy-chain') {
      setLocalMessage(savedWizardProxyIds.length >= 2 ? 'Связка уже сохранена. Первый сервер пойдёт через второй.' : 'Сначала сохраните два сервера на предыдущем шаге.')
      return
    }

    if (step.id === 'proxy-check') {
      if (actionIndex === 0) {
        setLocalMessage('Выберите первый сервер маршрута в списке ниже. Обычно это первый из сохранённых в мастере серверов.')
      } else if (actionIndex === stepActionLabels.length - 1) {
        await setupProxyChain()
      } else {
        await checkProxyChain()
      }
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
        return recordingMode === 'window'
          ? 'TradeTools будет писать выбранное окно или экран напрямую, без OBS.'
          : 'TradeTools сможет подключаться к OBS и отправлять команду сохранения replay.'
      case 'obs-replay':
        return recordingMode === 'window'
          ? 'Встроенный рекордер будет держать локальный буфер сегментов и собирать replay сделки.'
          : 'OBS начнет держать последние минуты записи в памяти и отдавать их по команде.'
      case 'folders':
        return recordingMode === 'window'
          ? 'TradeTools будет складывать готовые клипы в выбранную папку и держать локальный буфер до входа.'
          : 'TradeTools будет знать, где найти исходный OBS replay и куда положить готовый клип.'
      case 'test-clip':
        return 'В очереди проверки появится локальный клип с metadata JSON.'
      case 'proxy-welcome':
        return 'Вы пройдёте только прокси-настройки: два сервера, связка, SSH-проверка и запуск локального proxy.'
      case 'proxy-server':
        return 'Оба сервера появятся в хранилище, пароли сохранятся в keychain, первый сервер будет связан со вторым.'
      case 'proxy-chain':
        return 'Маршрут будет сохранён внутри мастера: первый сервер -> второй сервер. Больше узлов можно переставить на странице прокси.'
      case 'proxy-check':
        return 'TradeTools проверит SSH, установит Xray/VLESS на серверах и поднимет локальный HTTP proxy.'
      case 'proxy-done':
        return 'В торговом терминале останется указать HTTP proxy 127.0.0.1 и локальный порт.'
      default:
        return 'Можно закрыть мастер и пользоваться основным экраном.'
    }
  }

  const actionButtons = (
    <div className="space-y-3">
      {stepActionLabels.map((action, index) => (
        <button key={action} type="button" className="flex w-full cursor-pointer gap-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-left text-sm text-zinc-300 transition hover:border-violet-400/40 hover:bg-violet-500/10 hover:text-zinc-100" onClick={() => void runStepAction(index)}>
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-violet-300" />
          <span>{action}</span>
        </button>
      ))}
    </div>
  )

  const folderFields = step.id === 'folders' ? (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2 flex flex-wrap items-center gap-3 text-sm leading-6 text-zinc-400">
        <Button variant="ghost" onClick={applyDefaultClipPreset}><Clock3 size={16} className="mr-2" />Пресет 2с до / 2с после</Button>
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">буфер 60с</span>
      </div>
      <div className="md:col-span-2 border-l-2 border-amber-300/60 pl-3 text-sm leading-6 text-zinc-400">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={applyLongClipPreset}><Clock3 size={16} className="mr-2" />Пресет 10 минут до / 2 минуты после</Button>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">Тяжёлый режим</span>
        </div>
        <p className="mt-2">
          Клип появится только после записи времени после выхода. Для OBS нужен Replay Buffer минимум 12 минут плюс обычная длина сделки; встроенная запись будет держать 10 минут локального буфера и 2 минуты после выхода.
        </p>
      </div>
      {recordingMode === 'obs' && (
        <div className="md:col-span-2">
          <div className="text-xs font-medium text-zinc-500">Папка OBS replay</div>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <input className={`${compactInputClass} min-w-0 flex-1`} value={replaySourceDir} onChange={(event) => setReplaySourceDir(event.target.value)} />
            <Button variant="ghost" onClick={() => void selectDirectory(replaySourceDir, setReplaySourceDir)}><FolderOpen size={16} className="mr-2" />Выбрать</Button>
          </div>
        </div>
      )}
      <div className="md:col-span-2">
        <div className="text-xs font-medium text-zinc-500">Папка клипов</div>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <input className={`${compactInputClass} min-w-0 flex-1`} value={outputDir} onChange={(event) => setOutputDir(event.target.value)} />
          <Button variant="ghost" onClick={() => void selectDirectory(outputDir, setOutputDir)}><FolderOpen size={16} className="mr-2" />Выбрать</Button>
        </div>
      </div>
      <label className="text-xs font-medium text-zinc-500">Секунд до входа<input className={inputClass} value={paddingBefore} onChange={(event) => setPaddingBefore(event.target.value)} inputMode="numeric" /></label>
      <label className="text-xs font-medium text-zinc-500">Секунд после выхода<input className={inputClass} value={paddingAfter} onChange={(event) => setPaddingAfter(event.target.value)} inputMode="numeric" /></label>
      {recordingMode === 'window' && (
        <label className="text-xs font-medium text-zinc-500 md:col-span-2">
          <span>Локальный буфер до входа, сек<FieldHint text={replayBufferSecondsHint} /></span>
          <input className={inputClass} value={replayBufferSeconds} onChange={(event) => setReplayBufferSeconds(event.target.value)} inputMode="numeric" />
        </label>
      )}
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
                {step.id === 'folders' ? folderFields : actionButtons}
                {step.id === 'obs-websocket' && (
                  <div className="mt-5 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        className={`inline-flex min-h-10 items-center rounded-2xl border px-4 text-sm font-semibold transition ${recordingMode === 'window' ? 'border-violet-400/40 bg-violet-500/20 text-violet-100' : 'border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]'}`}
                        onClick={() => {
                          setRecordingMode('window')
                          void refreshWindowSources()
                        }}
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
                    {recordingMode === 'window' ? (
                      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_120px_120px]">
                        <label className="text-xs font-medium text-zinc-500">
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
                              className={`${compactInputClass} min-w-0 flex-1 appearance-none`}
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
                        <label className="text-xs font-medium text-zinc-500">FPS<input className={inputClass} value={frameRate} onChange={(event) => setFrameRate(event.target.value)} inputMode="numeric" /></label>
                        <label className="text-xs font-medium text-zinc-500">
                          <span>Интервал буфера, сек<FieldHint text={segmentSecondsHint} /></span>
                          <input className={inputClass} value={segmentSeconds} onChange={(event) => setSegmentSeconds(event.target.value)} inputMode="numeric" />
                        </label>
                      </div>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-3">
                        <label className="text-xs font-medium text-zinc-500">OBS host<input className={inputClass} value={host} onChange={(event) => setHost(event.target.value)} /></label>
                        <label className="text-xs font-medium text-zinc-500">OBS port<input className={inputClass} value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" /></label>
                        <label className="text-xs font-medium text-zinc-500">OBS пароль<input className={inputClass} value={obsPassword} onChange={(event) => setObsPassword(event.target.value)} type="password" placeholder={settings?.obs.passwordConfigured ? 'Сохранён' : 'Не задан'} /></label>
                      </div>
                    )}
                  </div>
                )}
                {step.id === 'folders' && <div className="mt-5">{actionButtons}</div>}
                {step.id === 'proxy-server' && (
                  <div className="mt-5 grid gap-4 xl:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="mb-3 text-sm font-semibold text-zinc-100">1. Первый сервер</div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-medium text-zinc-500">Название<input className={inputClass} value={proxyTitle} onChange={(event) => setProxyTitle(event.target.value)} placeholder="Edgecenter" /></label>
                        <label className="text-xs font-medium text-zinc-500">IP или домен<input className={inputClass} value={proxyServer} onChange={(event) => setProxyServer(event.target.value)} placeholder="1.2.3.4" /></label>
                        <label className="text-xs font-medium text-zinc-500">SSH-логин<input className={inputClass} value={proxyLogin} onChange={(event) => setProxyLogin(event.target.value)} /></label>
                        <label className="text-xs font-medium text-zinc-500">SSH-пароль<input className={inputClass} value={proxyPassword} onChange={(event) => setProxyPassword(event.target.value)} type="password" /></label>
                        <label className="text-xs font-medium text-zinc-500">Сайт хостинга<input className={inputClass} value={proxyDashboardUrl} onChange={(event) => setProxyDashboardUrl(event.target.value)} placeholder="https://..." /></label>
                        <label className="text-xs font-medium text-zinc-500">День оплаты<input className={inputClass} value={proxyPaymentDueDay} onChange={(event) => setProxyPaymentDueDay(event.target.value)} type="number" min="1" max="31" inputMode="numeric" /></label>
                        <label className="text-xs font-medium text-zinc-500">Локальный порт<input className={inputClass} value={proxyLocalPort} onChange={(event) => setProxyLocalPort(event.target.value)} inputMode="numeric" /></label>
                        <label className="text-xs font-medium text-zinc-500 sm:col-span-2">Заметки<textarea className={`${inputClass} min-h-16 resize-none`} value={proxyNotes} onChange={(event) => setProxyNotes(event.target.value)} /></label>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="mb-3 text-sm font-semibold text-zinc-100">2. Второй сервер</div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-medium text-zinc-500">Название<input className={inputClass} value={secondProxyTitle} onChange={(event) => setSecondProxyTitle(event.target.value)} placeholder="Vultr" /></label>
                        <label className="text-xs font-medium text-zinc-500">IP или домен<input className={inputClass} value={secondProxyServer} onChange={(event) => setSecondProxyServer(event.target.value)} placeholder="5.6.7.8" /></label>
                        <label className="text-xs font-medium text-zinc-500">SSH-логин<input className={inputClass} value={secondProxyLogin} onChange={(event) => setSecondProxyLogin(event.target.value)} /></label>
                        <label className="text-xs font-medium text-zinc-500">SSH-пароль<input className={inputClass} value={secondProxyPassword} onChange={(event) => setSecondProxyPassword(event.target.value)} type="password" /></label>
                        <label className="text-xs font-medium text-zinc-500">Сайт хостинга<input className={inputClass} value={secondProxyDashboardUrl} onChange={(event) => setSecondProxyDashboardUrl(event.target.value)} placeholder="https://..." /></label>
                        <label className="text-xs font-medium text-zinc-500">День оплаты<input className={inputClass} value={secondProxyPaymentDueDay} onChange={(event) => setSecondProxyPaymentDueDay(event.target.value)} type="number" min="1" max="31" inputMode="numeric" /></label>
                        <label className="text-xs font-medium text-zinc-500">Локальный порт<input className={inputClass} value={secondProxyLocalPort} onChange={(event) => setSecondProxyLocalPort(event.target.value)} inputMode="numeric" /></label>
                        <label className="text-xs font-medium text-zinc-500 sm:col-span-2">Заметки<textarea className={`${inputClass} min-h-16 resize-none`} value={secondProxyNotes} onChange={(event) => setSecondProxyNotes(event.target.value)} /></label>
                      </div>
                    </div>
                  </div>
                )}
                {step.id === 'proxy-chain' && (
                  <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-zinc-300">
                    {savedWizardProxyIds.length >= 2 ? (
                      <>
                        <div className="mb-2 flex items-center gap-2 font-semibold text-emerald-100"><Route size={16} />Связка сохранена</div>
                        <div>{proxyName(settings, savedWizardProxyIds[0])} {'->'} {proxyName(settings, savedWizardProxyIds[1])}</div>
                        <div className="mt-2 text-xs text-zinc-500">Первый сервер будет входом цепочки, второй сервер будет выходом. В торговом терминале после настройки указывается только локальный HTTP proxy.</div>
                      </>
                    ) : (
                      <>
                        <div className="mb-2 font-semibold text-amber-100">Два сервера ещё не сохранены</div>
                        <div>Вернитесь на предыдущий шаг, заполните оба сервера и нажмите сохранение. После этого мастер сам задаст порядок связки.</div>
                      </>
                    )}
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
                    <div className="flex flex-wrap gap-2">
                      <Button variant="ghost" onClick={() => void checkProxyChain()} disabled={saving || !selectedProxyId}>{saving ? 'Работаем...' : 'Проверить SSH'}</Button>
                      <Button onClick={() => void setupProxyChain()} disabled={saving || !selectedProxyId}>{saving ? 'Настраиваем...' : 'Настроить и запустить связку'}</Button>
                    </div>
                    {chainCheckProgress.length > 0 && (
                      <div className="max-h-48 overflow-y-auto rounded-2xl border border-sky-400/20 bg-sky-400/10 p-3 text-xs leading-5">
                        <div className="mb-2 font-semibold text-sky-100">Проверка SSH</div>
                        {chainCheckProgress.map((progress, index) => (
                          <div key={`${progress.timestampMs}-${progress.step}-${index}`} className="grid grid-cols-[44px_minmax(0,1fr)] gap-2">
                            <span className={`font-mono ${progressStatusClass(progress.status)}`}>{progressStatusLabel(progress.status)}</span>
                            <span className="min-w-0 break-words text-zinc-300">{progress.proxyName ? `${progress.proxyName}: ` : ''}{progress.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {chainSetupProgress.length > 0 && (
                      <div className="max-h-56 overflow-y-auto rounded-2xl border border-violet-400/20 bg-violet-400/10 p-3 text-xs leading-5">
                        <div className="mb-2 font-semibold text-violet-100">Настройка серверов</div>
                        {chainSetupProgress.map((progress, index) => (
                          <div key={`${progress.timestampMs}-${progress.step}-${index}`} className="grid grid-cols-[44px_minmax(0,1fr)] gap-2">
                            <span className={`font-mono ${progressStatusClass(progress.status)}`}>{progressStatusLabel(progress.status)}</span>
                            <span className="min-w-0 break-words text-zinc-300">{progress.proxyName ? `${progress.proxyName}: ` : ''}{progress.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {chainResult && (
                      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-xs leading-5 text-zinc-200">
                        <div className="mb-2 flex items-center gap-2 font-semibold text-emerald-100"><Route size={15} />{chainResult.route}</div>
                        {chainResult.sshChecks.map((check) => (
                          <div key={`${check.host}:${check.port}`} className="text-zinc-400">{check.host}:{check.port} - {check.message}</div>
                        ))}
                      </div>
                    )}
                    {chainSetupResult && (
                      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm leading-6 text-zinc-200">
                        <div className="font-semibold text-emerald-100">Связка настроена и локальный proxy запущен</div>
                        <div className="mt-2">Терминал: HTTP proxy, host <span className="font-mono text-zinc-100">{chainSetupResult.entryProxy.host}</span>, port <span className="font-mono text-zinc-100">{chainSetupResult.entryProxy.port}</span>. Логин и пароль пустые.</div>
                      </div>
                    )}
                  </div>
                )}
                {step.id === 'test-clip' && <Button className="mt-5" onClick={onCreateTestClip}>Создать тестовый клип</Button>}
                {(step.id === 'obs-websocket' || step.id === 'folders') && <Button className="mt-5" onClick={saveVideoSettings} disabled={saving}>{saving ? 'Сохраняем...' : 'Сохранить этот шаг'}</Button>}
                {step.id === 'proxy-server' && <Button className="mt-5" onClick={saveProxyServers} disabled={saving}><Server size={16} className="mr-2" />{saving ? 'Сохраняем...' : 'Сохранить два сервера и связку'}</Button>}
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
