import { ArrowLeft, ArrowRight, CheckCircle2, CircleHelp, Clock3, FolderOpen, Monitor, RefreshCw, Route, Server, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { WindowCaptureSource } from '../../../main/services/recording/windowRecorderService'
import type { AppSettings } from '../../../main/services/settings/settings'
import type { VideoEncoderOption } from '../../../main/services/video/videoEncoderDevices'
import type { ProxyChainInstructionResult, ProxyChainSetupProgress, ProxyChainSetupResult } from '../../../preload'
import { defaultLocalProxyPort } from '../../../shared/defaults'
import { defaultClipPaddingAfterSeconds, defaultClipPaddingBeforeSeconds, defaultReplayBufferSeconds, longClipAfterExitSeconds, longClipPresetSeconds } from '../../../shared/videoDefaults'
import type { AppPage } from '../../lib/navigation'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'
import { findPreferredTerminalSource } from '../../lib/windowCaptureSources'
import { refreshWindowSourceList } from '../../lib/windowSourceListRefresh'
import { proxySetupWizardSteps, videoSetupWizardSteps } from './setupWizardSteps'
import { Button } from '../ui/Button'

export type SetupWizardProps = {
  mode: Exclude<AppPage, 'support'>
  open: boolean
  settings?: AppSettings
  clipMessage: string
  onClose: () => void
  onSaved: (settings: AppSettings) => void
  onRunHealthCheck: () => Promise<string>
  onCreateTestClip: () => Promise<void>
}

const inputClass = 'mt-1 w-full border border-[#1c2b3a] bg-[#07111c] px-3 py-2 font-mono text-sm text-[#f0f0f0] outline-none transition-colors duration-150 focus:border-[#ff9f30] focus:ring-2 focus:ring-[#ff9f30]/30 focus:ring-offset-2 focus:ring-offset-[#0b1623]'
const compactInputClass = inputClass.replace('mt-1 ', '')
const fieldLabelClass = 'font-mono text-xs font-medium uppercase tracking-[0.08em] text-[#8b9bb4]'
const segmentSecondsHint = 'Размер одного куска записи. Обычно 2с: статус обновляется часто, а файлов не слишком много. Это не общая длина хранения.'
const replayBufferSecondsHint = 'Сколько секунд видео TradeTools держит до входа в сделку. Это должно быть не меньше поля «Секунд до входа».'

const normalizeVideoEncoderValue = (value: string): AppSettings['recording']['videoEncoder'] => {
  if (value === 'cpu' || value === 'gpu' || value === 'nvidia' || value === 'amd' || value === 'intel') return value
  return /^gpu:(nvidia|amd|intel):\d+$/.test(value) ? value as AppSettings['recording']['videoEncoder'] : 'gpu'
}

const FieldHint = ({ text }: { text: string }) => (
  <span className="ml-1 inline-flex align-middle text-[#8b9bb4] transition-colors duration-150 hover:text-[#56b5d5]" title={text}>
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
  if (status === 'info') return 'text-[#ff9f30]'
  return 'text-[#56b5d5]'
}

const userFacingErrorMessage = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error)) return fallback

  return error.message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
}

export const SetupWizard = ({ mode, open, settings, clipMessage, onClose, onSaved, onRunHealthCheck, onCreateTestClip }: SetupWizardProps) => {
  const steps = mode === 'video' ? videoSetupWizardSteps : proxySetupWizardSteps
  const [stepIndex, setStepIndex] = useState(0)
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
  const [windowSources, setWindowSources] = useState<WindowCaptureSource[]>([])
  const [videoEncoderOptions, setVideoEncoderOptions] = useState<VideoEncoderOption[]>([])
  const [loadingSources, setLoadingSources] = useState(false)
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
  const [localProxyType, setLocalProxyType] = useState<AppSettings['proxyRuntime']['localProxyType']>('SOCKS5')
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
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return undefined

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusTimer = window.setTimeout(() => {
      const initialFocus = dialogRef.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]')
      ;(initialFocus ?? dialogRef.current)?.focus()
    }, 0)

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )).filter((element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true')

      if (focusable.length === 0) {
        event.preventDefault()
        dialogRef.current.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleDialogKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleDialogKeyDown)
      previouslyFocused?.focus()
    }
  }, [open])

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
    setLocalProxyType(settings.proxyRuntime.localProxyType)
    setOutputDir(settings.clip.outputDir)
    setPaddingBefore(String(settings.clip.paddingBeforeSeconds))
    setPaddingAfter(String(settings.clip.paddingAfterSeconds))
    setReplayBufferSeconds(String(settings.clip.replayBufferSeconds))
  }, [settings])

  const refreshWindowSources = async () => {
    setLoadingSources(true)
    setLocalMessage('')
    try {
      const sources = await refreshWindowSourceList(
        () => getTradeToolsApi().recording.listWindowSources(true),
        setWindowSources
      )
      setLocalMessage(sources.length > 0 ? 'Список окон обновлён' : 'Окна для записи не найдены')
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : 'Не удалось получить список окон')
    } finally {
      setLoadingSources(false)
    }
  }

  useEffect(() => {
    if (!open || mode !== 'video') return
    void refreshWindowSources()
  }, [mode, open])

  useEffect(() => {
    if (!open || mode !== 'video') return
    void getTradeToolsApi().recording.listVideoEncoders()
      .then((options) => setVideoEncoderOptions(options))
      .catch(() => setVideoEncoderOptions([]))
  }, [mode, open])

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
  const selectedWindowTemporarilyUnavailable = Boolean(
    sourceType === 'window' && windowSourceId && !filteredSources.some((source) => source.id === windowSourceId)
  )
  const stepActionLabels = useMemo(() => {
    if (!step) return []
    if (mode === 'video' && step.id === 'recording-source') {
      return [
        'Открыть окно торгового терминала',
        'Выбрать окно или мониторы для записи',
        'Сохранить источник записи'
      ]
    }
    if (mode === 'video' && step.id === 'recording-buffer') {
      return [
        'Откройте окно торгового терминала',
        'Если окно не выбрано, TradeTools попробует выбрать его автоматически',
        'Нажмите проверку видео'
      ]
    }
    if (mode === 'video' && step.id === 'folders') {
      return [
        'Выбрать папку готовых клипов',
        'Поставить секунды до входа и после выхода'
      ]
    }

    return step.actions
  }, [mode, step])

  if (!open || !step) return null

  const saveVideoSettings = async () => {
    setSaving(true)
    setLocalMessage('')
    try {
      const api = getTradeToolsApi()
      const latestSources = !windowSourceId && !windowSourceName
        ? await api.recording.listWindowSources()
        : windowSources
      if (latestSources !== windowSources) setWindowSources(latestSources)
      const selectedSource = windowSources.find((source) => source.id === windowSourceId)
        ?? latestSources.find((source) => source.id === windowSourceId)
        ?? (sourceType === 'window' && !windowSourceId && !windowSourceName
          ? findPreferredTerminalSource(latestSources)
          : undefined)
      const selectedTarget = selectedSource ? {
        id: selectedSource.id,
        name: selectedSource.name,
        type: selectedSource.type,
        ...(selectedSource.processId ? { processId: selectedSource.processId } : {}),
        ...(selectedSource.displayId ? { displayId: selectedSource.displayId } : {})
      } : undefined
      const nextCaptureTargets = sourceType === 'screen'
        ? captureTargets.filter((target) => target.type === 'screen')
        : selectedTarget ? [selectedTarget] : captureTargets.filter((target) => target.type === 'window')
      const firstCaptureTarget = nextCaptureTargets[0]
      const parsedPaddingBeforeSeconds = Number(paddingBefore)
      const parsedReplayBufferSeconds = Number(replayBufferSeconds)
      const paddingBeforeSeconds = Number.isFinite(parsedPaddingBeforeSeconds) ? parsedPaddingBeforeSeconds : 0
      const replayBufferSecondsValue = Math.max(Number.isFinite(parsedReplayBufferSeconds) ? parsedReplayBufferSeconds : 0, paddingBeforeSeconds)
      const updated = await api.settings.update({
        recording: {
          mode: 'window',
          sourceType,
          windowSourceId: sourceType === 'screen' ? firstCaptureTarget?.id ?? '' : selectedSource?.id ?? windowSourceId,
          windowSourceName: sourceType === 'screen' ? firstCaptureTarget?.name ?? '' : selectedSource?.name ?? windowSourceName,
          captureTargets: nextCaptureTargets,
          saveTargetMode: sourceType === 'screen' ? 'all' : 'selected',
          saveTargetId: sourceType === 'screen' ? firstCaptureTarget?.id ?? '' : selectedSource?.id ?? firstCaptureTarget?.id ?? '',
          videoEncoder,
          resolutionPreset,
          frameRate: Number(frameRate),
          segmentSeconds: Number(segmentSeconds),
          systemAudioEnabled,
          microphoneEnabled
        },
        clip: {
          outputDir,
          paddingBeforeSeconds: Number(paddingBefore),
          paddingAfterSeconds: Number(paddingAfter),
          replayBufferSeconds: replayBufferSecondsValue
        }
      })
      onSaved(updated)
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
    setLocalMessage('Пресет включён: 10 минут до входа и 2 минуты после выхода. Клип появится примерно через 2 минуты после выхода.')
  }

  const saveProxyServers = async () => {
    if (!proxyServer.trim()) {
      setLocalMessage('Укажите IP или домен первого сервера.')
      return
    }
    if (!proxyPassword.trim()) {
      setLocalMessage('Укажите SSH-пароль первого сервера.')
      return
    }
    if (secondProxyServer.trim() && !secondProxyPassword.trim()) {
      setLocalMessage('Для второго сервера укажите SSH-пароль или очистите его поля.')
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
      if (!firstProxy) throw new Error('Сервер сохранён, но мастер не смог его определить')
      let secondProxy: typeof firstProxy | undefined
      if (secondProxyServer.trim()) {
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
        secondProxy = updated.proxies.find((proxy) => !beforeSecondSave.proxies.some((existing) => existing.id === proxy.id)) ?? updated.proxies.at(-1)
      }

      const chainedSettings = await api.settings.update({
        proxies: updated.proxies.map((proxy) => {
          if (proxy.id === firstProxy.id) return { ...proxy, nextProxyId: secondProxy?.id ?? '' }
          if (secondProxy && proxy.id === secondProxy.id) return { ...proxy, nextProxyId: '' }
          return proxy
        })
      })
      onSaved(chainedSettings)
      setSelectedProxyId(firstProxy.id)
      setSavedWizardProxyIds(secondProxy ? [firstProxy.id, secondProxy.id] : [firstProxy.id])
      setProxyPassword('')
      setSecondProxyPassword('')
      setLocalMessage(secondProxy
        ? `Сохранено: ${firstProxy.name || firstProxy.server} -> ${secondProxy.name || secondProxy.server}`
        : `Сохранён сервер: ${firstProxy.name || firstProxy.server}`)
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
      const result = await getTradeToolsApi().proxies.setupChain({ proxyId: selectedProxyId, localProxyType })
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
    setLocalMessage('Проверяем встроенную запись окна или экрана...')
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

    if (step.id === 'recording-source') {
      if (actionIndex === 0) {
        await refreshWindowSources()
        return
      }
      if (actionIndex === 1) {
        setLocalMessage('Выберите окно или мониторы ниже и нажмите «Сохранить этот шаг».')
        return
      }
      setLocalMessage('Откройте терминал и нажмите «Сохранить этот шаг». Если окно найдено, TradeTools выберет его автоматически.')
      return
    }

    if (step.id === 'recording-buffer') {
      if (actionIndex === stepActionLabels.length - 1) {
        await runVideoHealthCheck()
      } else {
        setLocalMessage('Окно терминала или выбранный монитор должен быть доступен. После сохранения источника нажмите проверку видео.')
      }
      return
    }

    if (step.id === 'folders') {
      if (actionIndex === 0) {
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
      setLocalMessage('Заполните первый сервер. Второй можно добавить сразу для цепочки или позже на странице прокси.')
      return
    }

    if (step.id === 'proxy-chain') {
      setLocalMessage(savedWizardProxyIds.length >= 2 ? 'Связка уже сохранена. Первый сервер пойдёт через второй.' : savedWizardProxyIds.length === 1 ? 'Сохранён один сервер. Он будет маршрутом без дополнительного перехода.' : 'Сначала сохраните сервер на предыдущем шаге.')
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
    ? step.id === 'test-clip'
        ? clipMessage
        : ''
    : '')

  const resultText = () => {
    switch (step.id) {
      case 'video-welcome':
        return 'Вы пройдёте только видео-настройки, не смешивая их с прокси.'
      case 'recording-source':
        return 'TradeTools будет писать выбранное окно или экраны напрямую.'
      case 'recording-buffer':
        return 'Встроенный рекордер будет держать локальный буфер сегментов и собирать видео сделки.'
      case 'folders':
        return 'TradeTools будет складывать готовые клипы в выбранную папку и держать локальный буфер до входа.'
      case 'test-clip':
        return 'В очереди проверки появится локальный клип с metadata JSON.'
      case 'proxy-welcome':
        return 'Вы пройдёте прокси-настройки: один или два сервера, маршрут, SSH-проверка и запуск локального proxy.'
      case 'proxy-server':
        return 'Серверы появятся в хранилище, пароли сохранятся в keychain. Второй сервер, если добавлен, станет следующим узлом маршрута.'
      case 'proxy-chain':
        return 'Маршрут будет сохранён внутри мастера. Больше узлов можно добавить и переставить на странице прокси.'
      case 'proxy-check':
        return 'TradeTools проверит SSH, установит Xray/VLESS на серверах и поднимет выбранный локальный SOCKS5 или HTTP proxy.'
      case 'proxy-done':
        return 'В торговом терминале останется указать выбранный SOCKS5 или HTTP proxy 127.0.0.1 и локальный порт.'
      default:
        return 'Можно закрыть мастер и пользоваться основным экраном.'
    }
  }

  const actionButtons = (
    <div className="space-y-3">
      {stepActionLabels.map((action, index) => (
        <button key={action} type="button" className="flex w-full cursor-pointer gap-3 border border-[#1c2b3a] bg-[#07111c] p-3 text-left font-mono text-sm text-[#8b9bb4] transition-colors duration-150 hover:border-[#56b5d5]/40 hover:bg-[#56b5d5]/10 hover:text-[#f0f0f0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f30]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1623]" onClick={() => void runStepAction(index)}>
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#56b5d5]" />
          <span>{action}</span>
        </button>
      ))}
    </div>
  )

  const folderFields = step.id === 'folders' ? (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2 flex flex-wrap items-center gap-3 font-mono text-sm leading-6 text-[#8b9bb4]">
        <Button variant="ghost" onClick={applyDefaultClipPreset}><Clock3 size={16} className="mr-2" />Пресет 2с до / 2с после</Button>
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">буфер 60с</span>
      </div>
      <div className="md:col-span-2 border-l-2 border-[#ff9f30]/60 pl-3 font-mono text-sm leading-6 text-[#8b9bb4]">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={applyLongClipPreset}><Clock3 size={16} className="mr-2" />Пресет 10 минут до / 2 минуты после</Button>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#ff9f30]">Тяжёлый режим</span>
        </div>
        <p className="mt-2">
          Клип появится только после записи времени после выхода. Встроенная запись будет держать 10 минут локального буфера и 2 минуты после выхода.
        </p>
      </div>
      <div className="md:col-span-2">
        <div className={fieldLabelClass}>Папка клипов</div>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <input className={`${compactInputClass} min-w-0 flex-1`} value={outputDir} onChange={(event) => setOutputDir(event.target.value)} />
          <Button variant="ghost" onClick={() => void selectDirectory(outputDir, setOutputDir)}><FolderOpen size={16} className="mr-2" />Выбрать</Button>
        </div>
      </div>
      <label className={fieldLabelClass}>Секунд до входа<input className={inputClass} value={paddingBefore} onChange={(event) => setPaddingBefore(event.target.value)} inputMode="numeric" /></label>
      <label className={fieldLabelClass}>Секунд после выхода<input className={inputClass} value={paddingAfter} onChange={(event) => setPaddingAfter(event.target.value)} inputMode="numeric" /></label>
      <label className={`${fieldLabelClass} md:col-span-2`}>
        <span>Локальный буфер до входа, сек<FieldHint text={replayBufferSecondsHint} /></span>
        <input className={inputClass} value={replayBufferSeconds} onChange={(event) => setReplayBufferSeconds(event.target.value)} inputMode="numeric" />
      </label>
    </div>
  ) : null

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center overflow-hidden bg-[#050b12]/90 p-2 sm:p-4 lg:items-center lg:p-6">
      <div
        ref={dialogRef}
        className="flex h-full max-h-[calc(100dvh-16px)] w-full max-w-6xl overflow-hidden border border-[#56b5d5]/30 bg-[#0b1623] font-mono shadow-[0_24px_90px_rgba(0,0,0,0.65)] sm:max-h-[calc(100dvh-32px)] lg:max-h-[calc(100dvh-48px)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-wizard-title"
        aria-describedby="setup-wizard-description"
        tabIndex={-1}
      >
        <aside className="hidden w-72 shrink-0 border-r border-[#1c2b3a] bg-[#07111c] p-5 lg:block">
          <div className="text-sm font-semibold uppercase tracking-[0.08em] text-[#f0f0f0]">{mode === 'video' ? 'Настройка видео' : 'Настройка прокси'}</div>
          <div className="mt-2 h-2 border border-[#1c2b3a] bg-[#0b1623]">
            <div className="h-full bg-[#ff9f30]" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-5 space-y-2">
            {steps.map((item, index) => (
              <button
                key={item.id}
                className={`flex w-full cursor-pointer items-center gap-3 border px-3 py-2 text-left text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f30]/40 ${index === stepIndex ? 'border-[#56b5d5]/50 bg-[#56b5d5]/10 text-cyan-100' : 'border-transparent text-[#8b9bb4] hover:border-[#1c2b3a] hover:text-[#f0f0f0]'}`}
                onClick={() => changeStep(index)}
              >
                <span className={`flex h-6 w-6 items-center justify-center border text-xs ${index < stepIndex ? 'border-emerald-400 bg-emerald-400 text-[#07111c]' : index === stepIndex ? 'border-[#ff9f30] bg-[#ff9f30] text-[#07111c]' : 'border-[#1c2b3a] bg-[#0b1623] text-[#8b9bb4]'}`}>{index < stepIndex ? '✓' : index + 1}</span>
                <span>{item.title}</span>
              </button>
            ))}
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-[#1c2b3a] p-4 sm:p-6">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.24em] text-[#56b5d5]">Шаг {stepIndex + 1} из {steps.length}</div>
              <h2 id="setup-wizard-title" className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#f0f0f0] sm:text-3xl">{step.title}</h2>
              <p id="setup-wizard-description" className="mt-2 max-w-2xl text-sm leading-6 text-[#8b9bb4]">{step.goal}</p>
            </div>
            <button data-dialog-initial-focus className="cursor-pointer border border-[#1c2b3a] bg-[#07111c] p-2 text-[#8b9bb4] transition-colors duration-150 hover:border-[#56b5d5]/40 hover:text-[#f0f0f0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f30]/40" onClick={onClose} aria-label="Закрыть пошаговую настройку">
              <X size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_240px]">
              <section className="min-w-0 border border-[#1c2b3a] bg-[#07111c] p-4 sm:p-5">
                <div className="mb-4 border border-[#56b5d5]/30 bg-[#56b5d5]/10 p-3 text-sm leading-5 text-[#8b9bb4] xl:hidden">
                  <span className="font-semibold text-cyan-100">Что получится: </span>{resultText()}
                </div>
                {step.id === 'folders' ? folderFields : actionButtons}
                {step.id === 'recording-source' && (
                  <div className="mt-5 space-y-4">
                    <div className="inline-flex items-center border border-[#56b5d5]/50 bg-[#56b5d5]/10 px-4 py-2 text-sm font-semibold text-cyan-100">
                      <Monitor size={16} className="mr-2" />Встроенная запись
                    </div>
                    <div className="space-y-4">
                        <fieldset data-testid="wizard-recording-source" className="min-w-0">
                          <legend className={fieldLabelClass}>Источник записи</legend>
                          <div className="mt-1 flex min-w-0 flex-wrap items-stretch gap-2">
                            <div className="flex shrink-0 border border-[#1c2b3a] bg-[#0b1623] p-1">
                              <button
                                className={`border px-3 py-2 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f30]/40 ${sourceType === 'window' ? 'border-[#56b5d5]/50 bg-[#56b5d5]/15 text-cyan-100' : 'border-transparent text-[#8b9bb4] hover:text-[#f0f0f0]'}`}
                                onClick={() => {
                                  setSourceType('window')
                                  setWindowSourceId('')
                                  setWindowSourceName('')
                                }}
                                type="button"
                                aria-pressed={sourceType === 'window'}
                              >
                                Окно
                              </button>
                              <button
                                className={`border px-3 py-2 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f30]/40 ${sourceType === 'screen' ? 'border-[#56b5d5]/50 bg-[#56b5d5]/15 text-cyan-100' : 'border-transparent text-[#8b9bb4] hover:text-[#f0f0f0]'}`}
                                onClick={() => {
                                  setSourceType('screen')
                                  setWindowSourceId('')
                                  setWindowSourceName('')
                                }}
                                type="button"
                                aria-pressed={sourceType === 'screen'}
                              >
                                Экран
                              </button>
                            </div>
                            {sourceType === 'screen' ? (
                              <select
                                className={`${compactInputClass} min-w-[180px] flex-[1_1_240px] appearance-none`}
                                value={captureTargets.filter((target) => target.type === 'screen').map((target) => target.id)}
                                onChange={(event) => {
                                  const selected = Array.from(event.currentTarget.selectedOptions)
                                    .map((option) => windowSources.find((source) => source.id === option.value))
                                    .filter((source): source is WindowCaptureSource => Boolean(source))
                                    .map((source) => ({ id: source.id, name: source.name, type: source.type, ...(source.displayId ? { displayId: source.displayId } : {}) }))
                                  setCaptureTargets(selected)
                                  setWindowSourceId(selected[0]?.id ?? '')
                                  setWindowSourceName(selected[0]?.name ?? '')
                                }}
                                multiple
                                size={Math.min(Math.max(filteredSources.length, 2), 4)}
                                aria-label="Экраны для записи"
                              >
                                {filteredSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
                              </select>
                            ) : (
                              <select
                                className={`${compactInputClass} min-w-[180px] flex-[1_1_240px] appearance-none`}
                                value={windowSourceId}
                                onChange={(event) => {
                                  const source = windowSources.find((candidate) => candidate.id === event.target.value)
                                  setWindowSourceId(event.target.value)
                                  setWindowSourceName(source?.name ?? '')
                                }}
                                aria-label="Окно для записи"
                              >
                                <option value="">Выберите окно</option>
                                {selectedWindowTemporarilyUnavailable && (
                                  <option value={windowSourceId}>{windowSourceName || 'Сохранённое окно'} (временно недоступно)</option>
                                )}
                                {filteredSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
                              </select>
                            )}
                            <Button className="shrink-0" variant="ghost" onClick={() => void refreshWindowSources()} disabled={loadingSources}>
                              <RefreshCw size={16} className="mr-2" />{loadingSources ? 'Обновляем...' : 'Обновить'}
                            </Button>
                          </div>
                        </fieldset>
                        <div data-testid="wizard-recording-details" className="grid min-w-0 gap-3 sm:grid-cols-2">
                        <label className={`block min-w-0 ${fieldLabelClass}`}>
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
                        <label className={`block min-w-0 ${fieldLabelClass}`}>
                          Кодирование
                          <select className={`${inputClass} appearance-none`} value={videoEncoder} onChange={(event) => setVideoEncoder(normalizeVideoEncoderValue(event.target.value))}>
                            {(videoEncoderOptions.length > 0 ? videoEncoderOptions : [{ id: videoEncoder, label: videoEncoder === 'cpu' ? 'CPU' : 'Авто GPU' }]).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                          </select>
                        </label>
                        <label className={`block min-w-0 ${fieldLabelClass}`}>FPS<input className={inputClass} value={frameRate} onChange={(event) => setFrameRate(event.target.value)} inputMode="numeric" /></label>
                        <label className={`block min-w-0 ${fieldLabelClass}`}>
                          <span>Интервал буфера, сек<FieldHint text={segmentSecondsHint} /></span>
                          <input className={inputClass} value={segmentSeconds} onChange={(event) => setSegmentSeconds(event.target.value)} inputMode="numeric" />
                        </label>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-[#8b9bb4]">
                          <label className="flex items-center gap-2"><input className="h-4 w-4 accent-[#ff9f30]" checked={systemAudioEnabled} onChange={(event) => setSystemAudioEnabled(event.target.checked)} type="checkbox" />Звук с ПК</label>
                          <label className="flex items-center gap-2"><input className="h-4 w-4 accent-[#ff9f30]" checked={microphoneEnabled} onChange={(event) => setMicrophoneEnabled(event.target.checked)} type="checkbox" />Микрофон</label>
                        </div>
                    </div>
                  </div>
                )}
                {step.id === 'folders' && <div className="mt-5">{actionButtons}</div>}
                {step.id === 'proxy-server' && (
                  <div className="mt-5 grid gap-4 xl:grid-cols-2">
                    <div className="border border-[#1c2b3a] bg-[#0b1623] p-4">
                      <div className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-[#f0f0f0]">1. Первый сервер</div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className={fieldLabelClass}>Название<input className={inputClass} value={proxyTitle} onChange={(event) => setProxyTitle(event.target.value)} placeholder="Edgecenter" /></label>
                        <label className={fieldLabelClass}>IP или домен<input className={inputClass} value={proxyServer} onChange={(event) => setProxyServer(event.target.value)} placeholder="1.2.3.4" /></label>
                        <label className={fieldLabelClass}>SSH-логин<input className={inputClass} value={proxyLogin} onChange={(event) => setProxyLogin(event.target.value)} /></label>
                        <label className={fieldLabelClass}>SSH-пароль<input className={inputClass} value={proxyPassword} onChange={(event) => setProxyPassword(event.target.value)} type="password" /></label>
                        <label className={fieldLabelClass}>Сайт хостинга<input className={inputClass} value={proxyDashboardUrl} onChange={(event) => setProxyDashboardUrl(event.target.value)} placeholder="https://..." /></label>
                        <label className={fieldLabelClass}>День оплаты<input className={inputClass} value={proxyPaymentDueDay} onChange={(event) => setProxyPaymentDueDay(event.target.value)} type="number" min="1" max="31" inputMode="numeric" /></label>
                        <label className={fieldLabelClass}>Локальный порт<input className={inputClass} value={proxyLocalPort} onChange={(event) => setProxyLocalPort(event.target.value)} inputMode="numeric" /></label>
                        <label className={`${fieldLabelClass} sm:col-span-2`}>Заметки<textarea className={`${inputClass} min-h-16 resize-none`} value={proxyNotes} onChange={(event) => setProxyNotes(event.target.value)} /></label>
                      </div>
                    </div>
                    <div className="border border-[#1c2b3a] bg-[#0b1623] p-4">
                      <div className="mb-1 text-sm font-semibold uppercase tracking-[0.08em] text-[#f0f0f0]">2. Второй сервер</div>
                      <div className="mb-3 text-xs text-[#8b9bb4]">Необязательно. Нужен только для цепочки из двух серверов.</div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className={fieldLabelClass}>Название<input className={inputClass} value={secondProxyTitle} onChange={(event) => setSecondProxyTitle(event.target.value)} placeholder="Vultr" /></label>
                        <label className={fieldLabelClass}>IP или домен<input className={inputClass} value={secondProxyServer} onChange={(event) => setSecondProxyServer(event.target.value)} placeholder="5.6.7.8" /></label>
                        <label className={fieldLabelClass}>SSH-логин<input className={inputClass} value={secondProxyLogin} onChange={(event) => setSecondProxyLogin(event.target.value)} /></label>
                        <label className={fieldLabelClass}>SSH-пароль<input className={inputClass} value={secondProxyPassword} onChange={(event) => setSecondProxyPassword(event.target.value)} type="password" /></label>
                        <label className={fieldLabelClass}>Сайт хостинга<input className={inputClass} value={secondProxyDashboardUrl} onChange={(event) => setSecondProxyDashboardUrl(event.target.value)} placeholder="https://..." /></label>
                        <label className={fieldLabelClass}>День оплаты<input className={inputClass} value={secondProxyPaymentDueDay} onChange={(event) => setSecondProxyPaymentDueDay(event.target.value)} type="number" min="1" max="31" inputMode="numeric" /></label>
                        <label className={fieldLabelClass}>Локальный порт<input className={inputClass} value={secondProxyLocalPort} onChange={(event) => setSecondProxyLocalPort(event.target.value)} inputMode="numeric" /></label>
                        <label className={`${fieldLabelClass} sm:col-span-2`}>Заметки<textarea className={`${inputClass} min-h-16 resize-none`} value={secondProxyNotes} onChange={(event) => setSecondProxyNotes(event.target.value)} /></label>
                      </div>
                    </div>
                  </div>
                )}
                {step.id === 'proxy-chain' && (
                  <div className="mt-5 border border-[#1c2b3a] bg-[#0b1623] p-4 text-sm leading-6 text-[#f0f0f0]">
                    {savedWizardProxyIds.length >= 2 ? (
                      <>
                        <div className="mb-2 flex items-center gap-2 font-semibold text-emerald-100"><Route size={16} />Связка сохранена</div>
                        <div>{proxyName(settings, savedWizardProxyIds[0])} {'->'} {proxyName(settings, savedWizardProxyIds[1])}</div>
                        <div className="mt-2 text-xs text-[#8b9bb4]">Первый сервер будет входом цепочки, второй сервер будет выходом. В торговом терминале после настройки указывается выбранный локальный SOCKS5 или HTTP proxy.</div>
                      </>
                    ) : savedWizardProxyIds.length === 1 ? (
                      <>
                        <div className="mb-2 flex items-center gap-2 font-semibold text-emerald-100"><Route size={16} />Один сервер сохранён</div>
                        <div>{proxyName(settings, savedWizardProxyIds[0])}</div>
                        <div className="mt-2 text-xs text-[#8b9bb4]">Этот сервер будет входом и выходом маршрута. Второй узел можно добавить позже на странице прокси.</div>
                      </>
                    ) : (
                      <>
                        <div className="mb-2 font-semibold text-orange-100">Сервер ещё не сохранён</div>
                        <div>Вернитесь на предыдущий шаг, заполните первый сервер и нажмите сохранение.</div>
                      </>
                    )}
                  </div>
                )}
                {step.id === 'proxy-check' && (
                  <div className="mt-5 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                     <label className={`block ${fieldLabelClass}`}>Первый сервер маршрута
                       <select className={`${inputClass} appearance-none`} value={selectedProxyId} onChange={(event) => setSelectedProxyId(event.target.value)}>
                         <option value="">Сервер не выбран</option>
                         {settings?.proxies.map((proxy) => <option key={proxy.id} value={proxy.id}>{proxy.name || proxy.server}</option>)}
                       </select>
                     </label>
                     <label className={`block ${fieldLabelClass}`}>Тип подключения терминала
                       <select className={`${inputClass} appearance-none`} value={localProxyType} onChange={(event) => setLocalProxyType(event.target.value === 'HTTP' ? 'HTTP' : 'SOCKS5')}>
                         <option value="SOCKS5">SOCKS5</option>
                         <option value="HTTP">HTTP</option>
                       </select>
                     </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="ghost" onClick={() => void checkProxyChain()} disabled={saving || !selectedProxyId}>{saving ? 'Работаем...' : 'Проверить SSH'}</Button>
                      <Button onClick={() => void setupProxyChain()} disabled={saving || !selectedProxyId}>{saving ? 'Настраиваем...' : 'Настроить и запустить связку'}</Button>
                    </div>
                    {chainCheckProgress.length > 0 && (
                      <div className="max-h-48 overflow-y-auto border border-[#56b5d5]/30 bg-[#56b5d5]/10 p-3 text-xs leading-5">
                        <div className="mb-2 font-semibold text-cyan-100">Проверка SSH</div>
                        {chainCheckProgress.map((progress, index) => (
                          <div key={`${progress.timestampMs}-${progress.step}-${index}`} className="grid grid-cols-[44px_minmax(0,1fr)] gap-2">
                            <span className={`font-mono ${progressStatusClass(progress.status)}`}>{progressStatusLabel(progress.status)}</span>
                            <span className="min-w-0 break-words text-[#f0f0f0]">{progress.proxyName ? `${progress.proxyName}: ` : ''}{progress.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {chainSetupProgress.length > 0 && (
                      <div className="max-h-56 overflow-y-auto border border-[#56b5d5]/30 bg-[#56b5d5]/10 p-3 text-xs leading-5">
                        <div className="mb-2 font-semibold text-cyan-100">Настройка серверов</div>
                        {chainSetupProgress.map((progress, index) => (
                          <div key={`${progress.timestampMs}-${progress.step}-${index}`} className="grid grid-cols-[44px_minmax(0,1fr)] gap-2">
                            <span className={`font-mono ${progressStatusClass(progress.status)}`}>{progressStatusLabel(progress.status)}</span>
                            <span className="min-w-0 break-words text-[#f0f0f0]">{progress.proxyName ? `${progress.proxyName}: ` : ''}{progress.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {chainResult && (
                      <div className="border border-emerald-400/30 bg-emerald-400/10 p-3 text-xs leading-5 text-[#f0f0f0]">
                        <div className="mb-2 flex items-center gap-2 font-semibold text-emerald-100"><Route size={15} />{chainResult.route}</div>
                        {chainResult.sshChecks.map((check) => (
                          <div key={`${check.host}:${check.port}`} className="text-[#8b9bb4]">{check.host}:{check.port} - {check.message}</div>
                        ))}
                      </div>
                    )}
                    {chainSetupResult && (
                      <div className="border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm leading-6 text-[#f0f0f0]">
                        <div className="font-semibold text-emerald-100">Связка настроена и локальный proxy запущен</div>
                        <div className="mt-2">Терминал: {chainSetupResult.entryProxy.type} proxy, host <span className="font-mono text-[#f0f0f0]">{chainSetupResult.entryProxy.host}</span>, port <span className="font-mono text-[#f0f0f0]">{chainSetupResult.entryProxy.port}</span>. Логин и пароль пустые.</div>
                      </div>
                    )}
                  </div>
                )}
                {step.id === 'test-clip' && <Button className="mt-5" onClick={onCreateTestClip}>Создать тестовый клип</Button>}
                {(step.id === 'recording-source' || step.id === 'folders') && <Button className="mt-5" onClick={saveVideoSettings} disabled={saving}>{saving ? 'Сохраняем...' : 'Сохранить этот шаг'}</Button>}
                {step.id === 'proxy-server' && <Button className="mt-5" onClick={saveProxyServers} disabled={saving}><Server size={16} className="mr-2" />{saving ? 'Сохраняем...' : 'Сохранить серверы и маршрут'}</Button>}
              </section>
              <aside className="hidden border border-[#56b5d5]/30 bg-[#56b5d5]/10 p-4 xl:block">
                <div className="text-sm font-semibold uppercase tracking-[0.08em] text-cyan-100">Что получится после шага</div>
                <p className="mt-3 text-sm leading-6 text-[#f0f0f0]">{resultText()}</p>
                {mode === 'proxy' && settings?.proxies.length ? (
                  <div className="mt-4 border border-[#1c2b3a] bg-[#07111c] p-3 text-xs leading-5 text-[#8b9bb4]">
                    <div className="font-semibold text-[#f0f0f0]">Сейчас сохранено</div>
                    {settings.proxies.slice(0, 4).map((proxy) => (
                      <div key={proxy.id}>{proxy.name || proxy.server}{proxy.nextProxyId ? ` -> ${proxyName(settings, proxy.nextProxyId)}` : ''}</div>
                    ))}
                  </div>
                ) : null}
              </aside>
            </div>
          </div>
          {statusMessage && (
            <div className="max-h-24 overflow-auto border-t border-[#56b5d5]/30 bg-[#56b5d5]/10 px-4 py-3 text-sm leading-5 text-cyan-100 sm:px-6" role="status">
              {statusMessage}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#1c2b3a] p-4 sm:p-6">
            <Button variant="ghost" onClick={previous} disabled={stepIndex === 0}><ArrowLeft size={16} className="mr-2" />Назад</Button>
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              {step.id === 'recording-buffer' && <Button onClick={() => void runVideoHealthCheck()} disabled={checkingVideo}>{checkingVideo ? 'Проверяем...' : 'Проверить видео'}</Button>}
              {stepIndex === steps.length - 1 ? <Button onClick={onClose}>Закрыть мастер</Button> : <Button onClick={next}>Дальше<ArrowRight size={16} className="ml-2" /></Button>}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
