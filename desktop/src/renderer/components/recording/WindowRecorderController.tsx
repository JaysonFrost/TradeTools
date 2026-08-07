import { useEffect, useRef } from 'react'
import type { AppSettings } from '../../../main/services/settings/settings'
import { recordingSourceRevision } from '../../../shared/recordingSourceRevision'
import type { WindowCaptureSource, WindowRecorderStatus } from '../../../main/services/recording/windowRecorderService'
import { terminalTitleMatchesTicker } from '../../../main/services/recording/terminalWindowSelection'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'
import { startOptionalAudioCaptures, type OptionalAudioKind } from '../../lib/asyncAudioCapture'
import { findAutoRecordedTerminalSources } from '../../lib/windowCaptureSources'

export type WindowRecorderControllerProps = {
  settings?: AppSettings
  enabled?: boolean
  recordingEnsureKey?: number
  onStatusChange: (status: WindowRecorderStatus) => void
  onSettingsChange?: (settings: AppSettings) => void
}

type BrowserVideoStream = {
  stream: MediaStream
  stop: () => void
}

type RecordingStream = {
  stream: MediaStream
  connectAudioStream?: (stream: MediaStream) => void
  stop: () => void
}

type BrowserRecorderSession = {
  source: WindowCaptureSource
  captureEpochId: string
  recorder?: MediaRecorder
  appendQueue?: Promise<void>
  sessionTimer?: number
  muteTimer?: number
  stream?: MediaStream
  systemAudioStream?: MediaStream
  microphoneStream?: MediaStream
  browserVideoStream?: BrowserVideoStream
  recordingStream?: RecordingStream
  optionalAudioCaptureStarted?: boolean
  stopping: boolean
  dead: boolean
}

export const browserVideoBitrate = (preset: AppSettings['recording']['resolutionPreset'], frameRate: number): number => {
  if (preset === '1080p') return 12_000_000
  if (preset !== 'native') return 24_000_000

  const nativeFrameRate = Math.max(10, Math.min(60, Number.isFinite(frameRate) ? frameRate : 30))
  return 60_000_000 + Math.round(Math.max(0, nativeFrameRate - 30) * 1_000_000)
}
const browserAudioBitrate = 128_000
const browserRecordingSessionDurationMs = 60_000
const mutedTrackReconcileDelayMs = 2_000
const sourceDiscoveryIntervalMs = 5_000
const sourceRetryDelayMs = 15_000
const nativeStatusPollMs = 5_000

const chooseMimeType = (hasAudio: boolean): string => {
  const candidates = hasAudio
    ? [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm'
      ]
    : [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
      ]

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
}

export const browserVideoTrackIsUsable = (track: Pick<MediaStreamTrack, 'readyState' | 'muted'>): boolean => (
  track.readyState === 'live' && !track.muted
)

export const shouldPersistBrowserRecorderChunk = (size: number): boolean => size > 0

const resolveSource = (sources: WindowCaptureSource[], settings: AppSettings): WindowCaptureSource | undefined => (
  sources.find((source) => source.type === settings.recording.sourceType && source.id === settings.recording.windowSourceId) ??
  sources.find((source) => source.type === settings.recording.sourceType && source.name === settings.recording.windowSourceName)
)

const sourceMatchesTarget = (source: WindowCaptureSource, target: AppSettings['recording']['captureTargets'][number]): boolean => {
  if (source.type !== target.type) return false
  if (source.id === target.id || source.name === target.name) return true
  if (source.type === 'screen' && Boolean(source.displayId) && source.displayId === target.displayId) return true

  return Boolean(
    source.processId &&
    source.processId === target.processId &&
    target.symbol &&
    terminalTitleMatchesTicker(source.name, target.symbol)
  )
}

const targetNeedsSync = (source: WindowCaptureSource, target: AppSettings['recording']['captureTargets'][number]): boolean => (
  target.id !== source.id ||
  target.name !== source.name ||
  target.displayId !== source.displayId
)

export const resolveRecordingTargets = (sources: WindowCaptureSource[], settings: AppSettings): WindowCaptureSource[] => {
  const configuredTargets = settings.recording.captureTargets
    .map((target) => sources.find((source) => sourceMatchesTarget(source, target)))
    .filter((source): source is WindowCaptureSource => source !== undefined)

  const selectedSource = resolveSource(sources, settings)
  if (settings.recording.sourceType === 'window') {
    if (selectedSource) return [selectedSource]
    if (settings.recording.windowSourceId || settings.recording.windowSourceName) return []
    if (configuredTargets.length > 0) return configuredTargets
    return findAutoRecordedTerminalSources(sources)
  }

  const candidates = [...configuredTargets, ...(selectedSource ? [selectedSource] : [])]
  const sourceIds = new Set<string>()
  const uniqueTargets = candidates.filter((source) => {
    if (sourceIds.has(source.id)) return false
    sourceIds.add(source.id)
    return true
  })

  return uniqueTargets
}

const isSavedWindowSourceMissing = (settings: AppSettings, source: WindowCaptureSource | undefined): boolean => (
  settings.recording.sourceType === 'window' &&
  Boolean(settings.recording.windowSourceId || settings.recording.windowSourceName) &&
  !source
)

export const hasConfiguredRecordingSource = (settings: AppSettings): boolean => Boolean(
  settings.recording.windowSourceId ||
  settings.recording.windowSourceName ||
  settings.recording.captureTargets.length > 0
)

export const sourceMatchesConfiguredRecording = (
  source: WindowCaptureSource,
  settings: AppSettings
): boolean => {
  if (source.type !== settings.recording.sourceType) return false
  if (source.type === 'screen') {
    return settings.recording.captureTargets.some((target) => sourceMatchesTarget(source, target))
  }
  if (settings.recording.windowSourceId || settings.recording.windowSourceName) {
    return source.id === settings.recording.windowSourceId ||
      Boolean(settings.recording.windowSourceName) && source.name === settings.recording.windowSourceName
  }

  return settings.recording.captureTargets.some((target) => sourceMatchesTarget(source, target))
}

export const browserCaptureFrameRate = (frameRate: number): number => (
  Math.max(10, Math.min(60, Number.isFinite(frameRate) ? frameRate : 30))
)
const browserCaptureResolution = (preset: AppSettings['recording']['resolutionPreset']): Partial<Record<'maxWidth' | 'maxHeight', number>> => {
  if (preset === 'native') return {}
  if (preset === '1080p') return { maxWidth: 1920, maxHeight: 1080 }
  return { maxWidth: 2560, maxHeight: 1440 }
}

const buildDesktopCaptureConstraints = (
  sourceId: string,
  frameRate: number,
  resolutionPreset: AppSettings['recording']['resolutionPreset']
): MediaStreamConstraints => {
  const captureFrameRate = browserCaptureFrameRate(frameRate)
  const resolution = browserCaptureResolution(resolutionPreset)
  return {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        minFrameRate: captureFrameRate,
        maxFrameRate: captureFrameRate,
        ...resolution
      },
      cursor: 'never'
    } as unknown as MediaTrackConstraints
  }
}

const captureSystemAudioStream = async (): Promise<MediaStream> => {
  const systemStream = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: {
      width: 4,
      height: 4,
      frameRate: 1
    }
  })

  systemStream.getVideoTracks().forEach((track) => {
    track.stop()
    systemStream.removeTrack(track)
  })
  return systemStream
}

const createRecordingStream = (
  videoStream: MediaStream,
  includeAudio: boolean
): RecordingStream => {
  const videoTracks = videoStream.getVideoTracks()
  if (!includeAudio) {
    return {
      stream: new MediaStream(videoTracks),
      stop: () => undefined
    }
  }

  const AudioContextConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextConstructor) {
    return {
      stream: new MediaStream(videoTracks),
      connectAudioStream: () => {
        throw new Error('Web Audio недоступен, аудиодорожка не подключена')
      },
      stop: () => undefined
    }
  }

  const audioContext = new AudioContextConstructor()
  const destination = audioContext.createMediaStreamDestination()
  const sourceNodes = new Set<MediaStreamAudioSourceNode>()
  let stopped = false

  void audioContext.resume().catch(() => undefined)

  return {
    stream: new MediaStream([
      ...videoTracks,
      ...destination.stream.getAudioTracks()
    ]),
    connectAudioStream: (audioStream) => {
      if (stopped) throw new Error('Сессия записи уже остановлена')
      const tracks = audioStream.getAudioTracks()
      if (tracks.length === 0) throw new Error('Источник звука не вернул аудиодорожку')
      const source = audioContext.createMediaStreamSource(new MediaStream(tracks))
      source.connect(destination)
      sourceNodes.add(source)
    },
    stop: () => {
      if (stopped) return
      stopped = true
      sourceNodes.forEach((source) => source.disconnect())
      sourceNodes.clear()
      destination.stream.getTracks().forEach((track) => track.stop())
      void audioContext.close().catch(() => undefined)
    }
  }
}

const hasAudioTracks = (stream?: MediaStream): boolean => (stream?.getAudioTracks().length ?? 0) > 0

const createLocalStatus = (settings: AppSettings, message: string, active = false): WindowRecorderStatus => ({
  enabled: settings.recording.mode === 'window',
  active,
  mode: settings.recording.mode,
  backend: 'browser',
  sourceId: settings.recording.windowSourceId,
  sourceName: settings.recording.windowSourceName,
  segmentCount: 0,
  bufferedSeconds: 0,
  lastSegmentAtMs: 0,
  message
})

export const mergeBrowserRecorderStatus = (
  status: WindowRecorderStatus,
  activeSources: Array<Pick<WindowCaptureSource, 'id' | 'name'>>,
  message: string
): WindowRecorderStatus => {
  const primarySource = activeSources[0]
  return {
    ...status,
    active: status.active || activeSources.length > 0,
    ...(primarySource ? { sourceId: primarySource.id, sourceName: primarySource.name } : {}),
    message
  }
}

const waitForVideoMetadata = async (video: HTMLVideoElement): Promise<void> => {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0 && video.videoHeight > 0) return

  await new Promise<void>((resolve) => {
    const finish = () => {
      video.removeEventListener('loadedmetadata', finish)
      video.removeEventListener('loadeddata', finish)
      resolve()
    }
    video.addEventListener('loadedmetadata', finish, { once: true })
    video.addEventListener('loadeddata', finish, { once: true })
    window.setTimeout(finish, 1_000)
  })
}

const createBrowserVideoStream = async (
  sourceStream: MediaStream,
  onLikelyBlackFrame?: () => void
): Promise<BrowserVideoStream> => {
  const [track] = sourceStream.getVideoTracks()
  if (!track) throw new Error('Источник записи не вернул видеодорожку')
  if (!onLikelyBlackFrame) {
    return {
      stream: sourceStream,
      stop: () => undefined
    }
  }

  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = sourceStream
  await video.play()
  await waitForVideoMetadata(video)

  const sampleCanvas = document.createElement('canvas')
  sampleCanvas.width = 32
  sampleCanvas.height = 18
  const sampleContext = sampleCanvas.getContext('2d', { alpha: false, willReadFrequently: true })
  let blackFrameStreak = 0
  let blackFrameReported = false

  const inspectFrame = () => {
    if (!sampleContext || blackFrameReported || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return

    sampleContext.drawImage(video, 0, 0, sampleCanvas.width, sampleCanvas.height)
    const pixels = sampleContext.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data
    let visiblePixels = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if ((pixels[index] ?? 0) > 12 || (pixels[index + 1] ?? 0) > 12 || (pixels[index + 2] ?? 0) > 12) visiblePixels += 1
    }

    blackFrameStreak = visiblePixels <= 2 ? blackFrameStreak + 1 : 0
    if (blackFrameStreak >= 4) {
      blackFrameReported = true
      onLikelyBlackFrame()
    }
  }

  inspectFrame()
  const sampleFrameTimer = window.setInterval(inspectFrame, 1_000)

  return {
    stream: sourceStream,
    stop: () => {
      window.clearInterval(sampleFrameTimer)
      video.pause()
      video.srcObject = null
    }
  }
}

export const WindowRecorderController = ({ settings, enabled = true, recordingEnsureKey = 0, onStatusChange, onSettingsChange }: WindowRecorderControllerProps) => {
  const settingsRef = useRef(settings)
  const onStatusChangeRef = useRef(onStatusChange)
  const onSettingsChangeRef = useRef(onSettingsChange)
  const requestReconcileRef = useRef<(() => void) | undefined>(undefined)
  settingsRef.current = settings
  onStatusChangeRef.current = onStatusChange
  onSettingsChangeRef.current = onSettingsChange

  useEffect(() => {
    const initialSettings = settingsRef.current
    if (!initialSettings) return

    let disposed = false
    let backend: 'starting' | 'native' | 'browser' = 'starting'
    const browserRecorders = new Map<string, BrowserRecorderSession>()
    let sourceRetryTimer: number | undefined
    let sourceDiscoveryTimer: number | undefined
    let statusPollTimer: number | undefined
    let reconcileRunning = false
    let reconcileRequested = false

    const reportStatus = (status: WindowRecorderStatus) => {
      if (!disposed) onStatusChangeRef.current(status)
    }

    const reportError = (error: unknown) => {
      const currentSettings = settingsRef.current ?? initialSettings
      reportStatus(createLocalStatus(currentSettings, error instanceof Error ? error.message : 'Не удалось запустить встроенную запись окна'))
    }

    const streamIsLive = (session: BrowserRecorderSession): boolean => (
      !session.dead && (session.stream?.getVideoTracks().some(browserVideoTrackIsUsable) ?? false)
    )

    const stopBrowserRecorder = (session: BrowserRecorderSession) => {
      if (session.stopping) return
      session.stopping = true
      void getTradeToolsApi().recording.browserStopped({
        sourceId: session.source.id,
        captureEpochId: session.captureEpochId
      }).catch(() => undefined)
      if (session.sessionTimer !== undefined) window.clearTimeout(session.sessionTimer)
      if (session.muteTimer !== undefined) window.clearTimeout(session.muteTimer)
      const [videoTrack] = session.stream?.getVideoTracks() ?? []
      if (videoTrack) {
        videoTrack.onended = null
        videoTrack.onmute = null
        videoTrack.onunmute = null
      }
      if (session.recorder && session.recorder.state !== 'inactive') {
        try {
          session.recorder.stop()
        } catch {
          // The recorder may finish between the state check and stop().
        }
      }
      session.browserVideoStream?.stop()
      session.recordingStream?.stop()
      session.stream?.getTracks().forEach((track) => track.stop())
      session.systemAudioStream?.getTracks().forEach((track) => track.stop())
      session.microphoneStream?.getTracks().forEach((track) => track.stop())
    }

    const cleanup = () => {
      disposed = true
      requestReconcileRef.current = undefined
      if (sourceRetryTimer !== undefined) window.clearTimeout(sourceRetryTimer)
      if (sourceDiscoveryTimer !== undefined) window.clearInterval(sourceDiscoveryTimer)
      if (statusPollTimer !== undefined) window.clearInterval(statusPollTimer)
      browserRecorders.forEach(stopBrowserRecorder)
      browserRecorders.clear()
      void getTradeToolsApi().recording.stop().catch(() => undefined)
    }

    if (enabled === false) {
      void getTradeToolsApi().recording.stop()
        .then(() => reportStatus(createLocalStatus(initialSettings, 'Фоновая запись остановлена')))
        .catch(reportError)
      return cleanup
    }

    let requestReconcile = () => undefined

    const markSessionDead = (session: BrowserRecorderSession) => {
      if (disposed || session.dead) return
      session.dead = true
      if (browserRecorders.get(session.source.id) === session) browserRecorders.delete(session.source.id)
      stopBrowserRecorder(session)
      requestReconcile()
    }

    const startBrowserRecorder = async (
      api: ReturnType<typeof getTradeToolsApi>,
      source: WindowCaptureSource
    ) => {
      const existing = browserRecorders.get(source.id)
      if (existing && streamIsLive(existing)) return
      if (existing) stopBrowserRecorder(existing)

      const currentSettings = settingsRef.current ?? initialSettings
      const session: BrowserRecorderSession = {
        source,
        captureEpochId: `${source.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        stopping: false,
        dead: false
      }
      browserRecorders.set(source.id, session)

      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia(
          buildDesktopCaptureConstraints(source.id, currentSettings.recording.frameRate, currentSettings.recording.resolutionPreset)
        )
        session.stream = mediaStream

        if (disposed || browserRecorders.get(source.id) !== session) {
          stopBrowserRecorder(session)
          return
        }

        const [videoTrack] = mediaStream.getVideoTracks()
        if (!videoTrack) throw new Error('Источник записи не вернул видеодорожку')
        videoTrack.onended = () => markSessionDead(session)
        videoTrack.onmute = () => {
          if (session.muteTimer !== undefined) window.clearTimeout(session.muteTimer)
          session.muteTimer = window.setTimeout(() => {
            session.muteTimer = undefined
            if (!browserVideoTrackIsUsable(videoTrack)) markSessionDead(session)
          }, mutedTrackReconcileDelayMs)
        }
        videoTrack.onunmute = () => {
          if (session.muteTimer !== undefined) window.clearTimeout(session.muteTimer)
          session.muteTimer = undefined
        }

        session.browserVideoStream = await createBrowserVideoStream(mediaStream, source.type === 'window'
          ? () => {
              const latestSettings = settingsRef.current ?? initialSettings
              reportStatus(createLocalStatus(latestSettings, 'Окно записи отдаёт чёрный кадр. Обновите источник записи в настройках.'))
            }
          : undefined)
        if (disposed || browserRecorders.get(source.id) !== session || !session.browserVideoStream) {
          stopBrowserRecorder(session)
          return
        }

        const optionalAudioEnabled = currentSettings.recording.systemAudioEnabled || currentSettings.recording.microphoneEnabled
        session.recordingStream = createRecordingStream(session.browserVideoStream.stream, optionalAudioEnabled)
        const mimeType = chooseMimeType(hasAudioTracks(session.recordingStream.stream))
        const chunkDurationMs = Math.max(1, currentSettings.recording.segmentSeconds) * 1000

        const startRecordingSession = () => {
          if (
            disposed ||
            session.stopping ||
            session.dead ||
            browserRecorders.get(source.id) !== session ||
            !streamIsLive(session) ||
            !session.recordingStream
          ) return

          const sessionId = `${source.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`
          let chunkStartedAtMs = 0
          let sequence = 0
          const recorder = new MediaRecorder(session.recordingStream.stream, {
            ...(mimeType ? { mimeType } : {}),
            videoBitsPerSecond: browserVideoBitrate(currentSettings.recording.resolutionPreset, currentSettings.recording.frameRate),
            audioBitsPerSecond: browserAudioBitrate
          })
          session.recorder = recorder
          recorder.ondataavailable = (event) => {
            if (!shouldPersistBrowserRecorderChunk(event.data.size)) return

            const endedAtMs = Date.now()
            const startedAtMs = chunkStartedAtMs
            const chunkSequence = sequence
            chunkStartedAtMs = endedAtMs
            sequence += 1

            session.appendQueue = (session.appendQueue ?? Promise.resolve())
              .then(async () => {
                const status = await api.recording.appendSegment({
                  sourceId: source.id,
                  sourceName: source.name,
                  processId: source.processId,
                  sessionId,
                  sequence: chunkSequence,
                  startedAtMs,
                  endedAtMs,
                  mimeType: event.data.type || mimeType || 'video/webm',
                  data: await event.data.arrayBuffer()
                })
                reportStatus(status)
              })
              .catch((error) => {
                const latestSettings = settingsRef.current ?? initialSettings
                reportStatus(createLocalStatus(latestSettings, error instanceof Error ? error.message : 'Не удалось сохранить часть записи'))
              })
          }
          recorder.onerror = () => {
            const latestSettings = settingsRef.current ?? initialSettings
            reportStatus(createLocalStatus(latestSettings, 'Встроенная запись окна остановилась с ошибкой'))
            markSessionDead(session)
          }
          recorder.onstop = () => {
            if (session.sessionTimer !== undefined) {
              window.clearTimeout(session.sessionTimer)
              session.sessionTimer = undefined
            }
            session.recorder = undefined
            if (!session.stopping && !session.dead && streamIsLive(session)) startRecordingSession()
          }
          chunkStartedAtMs = Date.now()
          recorder.start(chunkDurationMs)
          if (optionalAudioEnabled && !session.optionalAudioCaptureStarted) {
            session.optionalAudioCaptureStarted = true
            const connectAudioStream = (kind: OptionalAudioKind, stream: MediaStream) => {
              if (!session.recordingStream?.connectAudioStream) throw new Error('Аудиомикшер записи недоступен')
              session.recordingStream.connectAudioStream(stream)
              if (kind === 'system') session.systemAudioStream = stream
              else session.microphoneStream = stream
            }
            startOptionalAudioCaptures({
              isActive: () => (
                !disposed &&
                !session.stopping &&
                !session.dead &&
                browserRecorders.get(source.id) === session
              ),
              stopStream: (stream) => stream.getTracks().forEach((track) => track.stop()),
              onError: (kind, error) => {
                const latestSettings = settingsRef.current ?? initialSettings
                const sourceLabel = kind === 'system' ? 'звук с ПК' : 'микрофон'
                const details = error instanceof Error ? `: ${error.message}` : ''
                const message = `Встроенная запись видео активна, но не удалось подключить ${sourceLabel}${details}`
                reportStatus(createLocalStatus(latestSettings, message, true))
              },
              tasks: [
                {
                  kind: 'system',
                  enabled: currentSettings.recording.systemAudioEnabled,
                  acquire: captureSystemAudioStream,
                  connect: (stream) => connectAudioStream('system', stream)
                },
                {
                  kind: 'microphone',
                  enabled: currentSettings.recording.microphoneEnabled,
                  acquire: () => navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
                  connect: (stream) => connectAudioStream('microphone', stream)
                }
              ]
            })
          }
          void api.recording.browserStarted({
            sourceId: source.id,
            sourceName: source.name,
            processId: source.processId,
            captureEpochId: session.captureEpochId,
            startedAtMs: chunkStartedAtMs
          }).catch(() => {
            const latestSettings = settingsRef.current ?? initialSettings
            reportStatus(createLocalStatus(latestSettings, 'Запись окна началась, но не удалось подтвердить готовность автоклипов'))
          })
          session.sessionTimer = window.setTimeout(() => {
            if (recorder.state === 'recording') recorder.stop()
          }, browserRecordingSessionDurationMs)
        }

        startRecordingSession()
      } catch (error) {
        if (browserRecorders.get(source.id) === session) browserRecorders.delete(source.id)
        stopBrowserRecorder(session)
        throw error
      }
    }

    const scheduleSourceRetry = () => {
      if (disposed || sourceRetryTimer !== undefined) return
      sourceRetryTimer = window.setTimeout(() => {
        sourceRetryTimer = undefined
        requestReconcile()
      }, sourceRetryDelayMs)
    }

    const ensureSourceDiscovery = () => {
      if (sourceDiscoveryTimer !== undefined) return
      sourceDiscoveryTimer = window.setInterval(requestReconcile, sourceDiscoveryIntervalMs)
    }

    const ensureNativeStatusPolling = (api: ReturnType<typeof getTradeToolsApi>) => {
      if (statusPollTimer !== undefined) return
      statusPollTimer = window.setInterval(() => {
        void api.recording.getStatus().then((status) => {
          reportStatus(status)
          if (status.fallbackRequired && !disposed) {
            backend = 'browser'
            if (statusPollTimer !== undefined) window.clearInterval(statusPollTimer)
            statusPollTimer = undefined
            requestReconcile()
          }
        }).catch(reportError)
      }, nativeStatusPollMs)
    }

    const prepareTargets = async (
      api: ReturnType<typeof getTradeToolsApi>,
      sources: WindowCaptureSource[]
    ): Promise<{ currentSettings: AppSettings, targets: WindowCaptureSource[] }> => {
      let currentSettings = settingsRef.current ?? initialSettings
      let targets = resolveRecordingTargets(sources, currentSettings)
      if (currentSettings.recording.sourceType === 'screen' && currentSettings.recording.captureTargets.length === 0) {
        reportStatus(createLocalStatus(currentSettings, 'Выберите хотя бы один монитор в настройках записи.'))
        return { currentSettings, targets: [] }
      }

      const source = targets[0] ?? resolveSource(sources, currentSettings)
      if (targets.length === 0 && isSavedWindowSourceMissing(currentSettings, source)) {
        return { currentSettings, targets: [] }
      }

      const screenTargetsNeedSync = currentSettings.recording.sourceType === 'screen' && targets.length > 0 && (
        currentSettings.recording.captureTargets.some((target) => {
          if (target.type !== 'screen') return false
          const resolvedTarget = targets.find((candidate) => sourceMatchesTarget(candidate, target))
          return !target.displayId || (resolvedTarget ? targetNeedsSync(resolvedTarget, target) : false)
        })
      )
      if (screenTargetsNeedSync) {
        const firstScreen = targets[0]
        reportStatus(createLocalStatus(currentSettings, `Обновляем данные монитора: ${firstScreen.name}`))
        const updated = await api.settings.update({
          expectedRecordingSourceRevision: recordingSourceRevision(currentSettings.recording),
          recording: {
            windowSourceId: firstScreen.id,
            windowSourceName: firstScreen.name,
            captureTargets: targets.map((target) => ({
              id: target.id,
              name: target.name,
              type: target.type,
              ...(target.processId ? { processId: target.processId } : {}),
              ...(target.displayId ? { displayId: target.displayId } : {})
            })),
            saveTargetMode: 'all',
            saveTargetId: firstScreen.id
          }
        })
        currentSettings = updated
        settingsRef.current = updated
        onSettingsChangeRef.current?.(updated)
        targets = resolveRecordingTargets(sources, updated)
      }

      return { currentSettings, targets }
    }

    const reconcile = async () => {
      const api = getTradeToolsApi()
      const currentSettings = settingsRef.current ?? initialSettings
      if (currentSettings.recording.mode !== 'window') {
        reportStatus(await api.recording.getStatus())
        return
      }

      const sources = await api.recording.listWindowSources()
      const prepared = await prepareTargets(api, sources)
      const targets = prepared.targets
      if (prepared.currentSettings.recording.sourceType === 'window') ensureSourceDiscovery()
      if (hasConfiguredRecordingSource(prepared.currentSettings)) {
        browserRecorders.forEach((session, sourceId) => {
          if (sourceMatchesConfiguredRecording(session.source, prepared.currentSettings)) return
          browserRecorders.delete(sourceId)
          stopBrowserRecorder(session)
        })
      }
      if (targets.length === 0) {
        const activeSources = [...browserRecorders.values()]
          .filter(streamIsLive)
          .map((session) => session.source)
        const status = await api.recording.getStatus()
        const hasSavedWindow = prepared.currentSettings.recording.sourceType === 'window' && hasConfiguredRecordingSource(prepared.currentSettings)
        const savedWindowLabel = prepared.currentSettings.recording.windowSourceName ||
          prepared.currentSettings.recording.windowSourceId ||
          prepared.currentSettings.recording.captureTargets[0]?.name ||
          prepared.currentSettings.recording.captureTargets[0]?.id ||
          'выбранное окно'
        const message = prepared.currentSettings.recording.sourceType === 'screen'
          ? 'Экран для записи не найден. Обновите список источников.'
          : hasSavedWindow
            ? `Окно ${savedWindowLabel} не найдено. Откройте выбранное окно, TradeTools продолжит запись автоматически.`
            : 'Откройте торговый терминал. TradeTools сам выберет подходящее окно и начнёт запись.'
        reportStatus(mergeBrowserRecorderStatus(status, activeSources, message))
        scheduleSourceRetry()
        return
      }

      if (sourceRetryTimer !== undefined) {
        window.clearTimeout(sourceRetryTimer)
        sourceRetryTimer = undefined
      }

      if (backend !== 'browser') {
        reportStatus(createLocalStatus(prepared.currentSettings, 'Запускаем оптимизированную ffmpeg-запись...'))
        const optimizedStatus = await api.recording.start()
        reportStatus(optimizedStatus)
        const requiresBrowserTargetReconciliation = prepared.currentSettings.recording.sourceType === 'window'
        if (!optimizedStatus.fallbackRequired && !requiresBrowserTargetReconciliation) {
          backend = 'native'
          ensureNativeStatusPolling(api)
          return
        }
        backend = 'browser'
        if (statusPollTimer !== undefined) window.clearInterval(statusPollTimer)
        statusPollTimer = undefined
      }

      const desiredSourceIds = new Set(targets.map((target) => target.id))
      browserRecorders.forEach((session, sourceId) => {
        if (!desiredSourceIds.has(sourceId) || !streamIsLive(session)) {
          browserRecorders.delete(sourceId)
          stopBrowserRecorder(session)
        }
      })

      const targetsToStart = targets.filter((target) => !browserRecorders.has(target.id))
      if (targetsToStart.length > 0 && targets.length > 1) {
        reportStatus(createLocalStatus(prepared.currentSettings, `Запускаем запись ${targets.length} источников...`, true))
      }
      for (const target of targetsToStart) {
        try {
          await startBrowserRecorder(api, target)
        } catch (error) {
          reportError(error)
        }
      }

      const activeSources = targets.filter((target) => browserRecorders.has(target.id))
      if (activeSources.length > 0) {
        const status = await api.recording.getStatus()
        reportStatus(mergeBrowserRecorderStatus(
          status,
          activeSources,
          `Встроенная запись активна: ${activeSources.map((target) => target.name).join(', ')}`
        ))
      } else {
        scheduleSourceRetry()
      }
    }

    requestReconcile = () => {
      if (disposed) return
      reconcileRequested = true
      if (reconcileRunning) return
      reconcileRunning = true
      void (async () => {
        try {
          while (reconcileRequested && !disposed) {
            reconcileRequested = false
            await reconcile()
          }
        } finally {
          reconcileRunning = false
        }
      })().catch(reportError)
    }
    requestReconcileRef.current = requestReconcile
    requestReconcile()

    return cleanup
  }, [
    settings?.recording.mode,
    settings?.recording.sourceType,
    settings?.recording.resolutionPreset,
    settings?.recording.frameRate,
    settings?.recording.segmentSeconds,
    settings?.recording.systemAudioEnabled,
    settings?.recording.microphoneEnabled,
    enabled
  ])

  const captureTargetRevision = settings?.recording.captureTargets
    .map((target) => `${target.id}:${target.name}:${target.type}:${target.processId ?? ''}:${target.displayId ?? ''}`)
    .join('|') ?? ''
  useEffect(() => {
    requestReconcileRef.current?.()
  }, [
    recordingEnsureKey,
    settings?.recording.windowSourceId,
    settings?.recording.windowSourceName,
    captureTargetRevision
  ])

  return null
}
