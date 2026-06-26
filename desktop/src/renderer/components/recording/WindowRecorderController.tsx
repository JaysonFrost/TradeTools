import { useEffect } from 'react'
import type { AppSettings } from '../../../main/services/settings/settings'
import type { WindowCaptureSource, WindowRecorderStatus } from '../../../main/services/recording/windowRecorderService'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'
import { findPreferredTerminalSource } from '../../lib/windowCaptureSources'

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
  stop: () => void
}

type BrowserRecorderSession = {
  recorder?: MediaRecorder
  sessionTimer?: number
  stream?: MediaStream
  systemAudioStream?: MediaStream
  microphoneStream?: MediaStream
  browserVideoStream?: BrowserVideoStream
  recordingStream?: RecordingStream
}

const browserCaptureMaxFrameRate = 24
const browserVideoBitrate = 2_500_000
const browserAudioBitrate = 128_000
const sourceRetryDelayMs = 15_000
const nativeStatusPollMs = 5_000

const chooseMimeType = (hasAudio: boolean): string => {
  const candidates = hasAudio
    ? [
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm'
      ]
    : [
        'video/webm;codecs=vp8',
        'video/webm;codecs=vp9',
        'video/webm'
      ]

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
}

const resolveSource = (sources: WindowCaptureSource[], settings: AppSettings): WindowCaptureSource | undefined => (
  sources.find((source) => source.type === settings.recording.sourceType && source.id === settings.recording.windowSourceId) ??
  sources.find((source) => source.type === settings.recording.sourceType && source.name === settings.recording.windowSourceName)
)

const sourceMatchesTarget = (source: WindowCaptureSource, target: AppSettings['recording']['captureTargets'][number]): boolean => (
  source.type === target.type && (
    source.id === target.id ||
    source.name === target.name ||
    (source.type === 'screen' && Boolean(source.displayId) && source.displayId === target.displayId)
  )
)

const targetNeedsSync = (source: WindowCaptureSource, target: AppSettings['recording']['captureTargets'][number]): boolean => (
  target.id !== source.id ||
  target.name !== source.name ||
  target.displayId !== source.displayId
)

const resolveRecordingTargets = (sources: WindowCaptureSource[], settings: AppSettings): WindowCaptureSource[] => {
  const configuredTargets = settings.recording.captureTargets
    .map((target) => sources.find((source) => sourceMatchesTarget(source, target)))
    .filter((source): source is WindowCaptureSource => source !== undefined)

  if (configuredTargets.length > 0) return configuredTargets

  const selectedSource = resolveSource(sources, settings)
  if (selectedSource) return [selectedSource]
  return []
}

const isSavedWindowSourceMissing = (settings: AppSettings, source: WindowCaptureSource | undefined): boolean => (
  settings.recording.sourceType === 'window' &&
  Boolean(settings.recording.windowSourceId || settings.recording.windowSourceName) &&
  !source
)

const browserCaptureFrameRate = (frameRate: number): number => Math.max(10, Math.min(browserCaptureMaxFrameRate, Math.trunc(frameRate)))
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
  audioStreams: Array<MediaStream | undefined>
): RecordingStream => {
  const audioTracks = audioStreams.flatMap((audioStream) => audioStream?.getAudioTracks() ?? [])
  if (audioTracks.length <= 1) {
    return {
      stream: new MediaStream([
        ...videoStream.getVideoTracks(),
        ...audioTracks
      ]),
      stop: () => undefined
    }
  }

  const AudioContextConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextConstructor) {
    return {
      stream: new MediaStream([
        ...videoStream.getVideoTracks(),
        ...audioTracks
      ]),
      stop: () => undefined
    }
  }

  const audioContext = new AudioContextConstructor()
  const destination = audioContext.createMediaStreamDestination()
  const sourceNodes = audioStreams
    .map((audioStream) => {
      const tracks = audioStream?.getAudioTracks() ?? []
      if (tracks.length === 0) return undefined
      const source = audioContext.createMediaStreamSource(new MediaStream(tracks))
      source.connect(destination)
      return source
    })
    .filter((source): source is MediaStreamAudioSourceNode => source !== undefined)

  void audioContext.resume().catch(() => undefined)

  return {
    stream: new MediaStream([
      ...videoStream.getVideoTracks(),
      ...destination.stream.getAudioTracks()
    ]),
    stop: () => {
      sourceNodes.forEach((source) => source.disconnect())
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
  useEffect(() => {
    if (!settings) return

    let disposed = false
    const browserRecorders: BrowserRecorderSession[] = []
    let sourceRetryTimer: number | undefined
    let statusPollTimer: number | undefined

    const stopBrowserRecorder = (session: BrowserRecorderSession) => {
      if (session.sessionTimer !== undefined) window.clearTimeout(session.sessionTimer)
      if (session.recorder?.state === 'recording') session.recorder.stop()
      session.browserVideoStream?.stop()
      session.recordingStream?.stop()
      session.stream?.getTracks().forEach((track) => track.stop())
      session.systemAudioStream?.getTracks().forEach((track) => track.stop())
      session.microphoneStream?.getTracks().forEach((track) => track.stop())
    }

    const cleanup = () => {
      disposed = true
      if (sourceRetryTimer !== undefined) window.clearTimeout(sourceRetryTimer)
      if (statusPollTimer !== undefined) window.clearInterval(statusPollTimer)
      browserRecorders.forEach(stopBrowserRecorder)
      void getTradeToolsApi().recording.stop().catch(() => undefined)
    }

    const handleStartError = (error: unknown) => {
      onStatusChange(createLocalStatus(settings, error instanceof Error ? error.message : 'Не удалось запустить встроенную запись окна'))
    }

    if (enabled === false) {
      void getTradeToolsApi().recording.stop()
        .then(() => {
          if (!disposed) onStatusChange(createLocalStatus(settings, 'Фоновая запись остановлена'))
        })
        .catch(handleStartError)
      return cleanup
    }

    const scheduleSourceRetry = (start: () => Promise<void>) => {
      if (disposed || sourceRetryTimer !== undefined) return

      sourceRetryTimer = window.setTimeout(() => {
        sourceRetryTimer = undefined
        if (!disposed) void start().catch(handleStartError)
      }, sourceRetryDelayMs)
    }

    const startBrowserRecorder = async (
      api: ReturnType<typeof getTradeToolsApi>,
      source: WindowCaptureSource
    ) => {
      const session: BrowserRecorderSession = {}
      browserRecorders.push(session)

      const mediaStream = await navigator.mediaDevices.getUserMedia(
        buildDesktopCaptureConstraints(source.id, settings.recording.frameRate, settings.recording.resolutionPreset)
      )
      session.stream = mediaStream
      try {
        session.systemAudioStream = settings.recording.systemAudioEnabled
          ? await captureSystemAudioStream()
          : undefined
        session.microphoneStream = settings.recording.microphoneEnabled
          ? await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
          : undefined
      } catch (error) {
        stopBrowserRecorder(session)
        throw error
      }
      if (disposed) {
        stopBrowserRecorder(session)
        return
      }

      try {
        session.browserVideoStream = await createBrowserVideoStream(mediaStream, source.type === 'window'
          ? () => {
              if (!disposed) onStatusChange(createLocalStatus(settings, 'Окно записи отдаёт чёрный кадр. Обновите источник записи в настройках.'))
            }
          : undefined)
      } catch (error) {
        stopBrowserRecorder(session)
        throw error
      }
      if (disposed || !session.browserVideoStream) {
        stopBrowserRecorder(session)
        return
      }

      session.recordingStream = createRecordingStream(session.browserVideoStream.stream, [session.systemAudioStream, session.microphoneStream])
      const mimeType = chooseMimeType(hasAudioTracks(session.recordingStream.stream))
      const chunkDurationMs = Math.max(1, settings.recording.segmentSeconds) * 1000

      const startRecordingSession = () => {
        if (disposed || !session.browserVideoStream || !session.recordingStream) return

        const sessionId = `${source.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const chunkStartedAtMs = Date.now()
        const recorder = new MediaRecorder(session.recordingStream.stream, {
          ...(mimeType ? { mimeType } : {}),
          videoBitsPerSecond: browserVideoBitrate,
          audioBitsPerSecond: browserAudioBitrate
        })
        session.recorder = recorder
        recorder.ondataavailable = (event) => {
          if (event.data.size <= 0) return

          const endedAtMs = Date.now()
          const startedAtMs = chunkStartedAtMs

          void (async () => {
            if (disposed) return

            const status = await api.recording.appendSegment({
              sourceId: source.id,
              sourceName: source.name,
              sessionId,
              sequence: 0,
              startedAtMs,
              endedAtMs,
              mimeType: event.data.type || mimeType || 'video/webm',
              data: await event.data.arrayBuffer()
            })
            onStatusChange(status)
          })().catch((error) => {
            onStatusChange(createLocalStatus(settings, error instanceof Error ? error.message : 'Не удалось сохранить часть записи'))
          })
        }
        recorder.onerror = () => {
          onStatusChange(createLocalStatus(settings, 'Встроенная запись окна остановилась с ошибкой'))
        }
        recorder.onstop = () => {
          if (session.sessionTimer !== undefined) {
            window.clearTimeout(session.sessionTimer)
            session.sessionTimer = undefined
          }
          if (!disposed) startRecordingSession()
        }
        recorder.start()
        session.sessionTimer = window.setTimeout(() => {
          if (recorder.state === 'recording') recorder.stop()
        }, chunkDurationMs)
      }

      startRecordingSession()
    }

    const start = async () => {
      const api = getTradeToolsApi()
      if (settings.recording.mode !== 'window') {
        onStatusChange(await api.recording.getStatus())
        return
      }

      const sources = await api.recording.listWindowSources()
      let targets = resolveRecordingTargets(sources, settings)
      if (settings.recording.sourceType === 'screen' && settings.recording.captureTargets.length === 0) {
        onStatusChange(createLocalStatus(settings, 'Выберите хотя бы один монитор в настройках записи.'))
        return
      }

      let source = targets[0] ?? resolveSource(sources, settings)
      if (isSavedWindowSourceMissing(settings, source)) {
        onStatusChange(createLocalStatus(settings, `Окно ${settings.recording.windowSourceName} не найдено. Откройте торговый терминал, TradeTools продолжит запись автоматически.`))
        scheduleSourceRetry(start)
        return
      }

      const screenTargetsNeedSync = settings.recording.sourceType === 'screen' && targets.length > 0 && (
        settings.recording.captureTargets.some((target) => {
          if (target.type !== 'screen') return false
          const source = targets.find((source) => sourceMatchesTarget(source, target))
          return !target.displayId || (source ? targetNeedsSync(source, target) : false)
        })
      )
      if (screenTargetsNeedSync) {
        const firstScreen = targets[0]
        onStatusChange(createLocalStatus(settings, `Обновляем данные монитора: ${firstScreen.name}`))
        const updated = await api.settings.update({
          recording: {
            ...settings.recording,
            windowSourceId: firstScreen.id,
            windowSourceName: firstScreen.name,
            captureTargets: targets.map((target) => ({
              id: target.id,
              name: target.name,
              type: target.type,
              ...(target.displayId ? { displayId: target.displayId } : {})
            })),
            saveTargetMode: 'all',
            saveTargetId: firstScreen.id
          }
        })
        if (!disposed) onSettingsChange?.(updated)
        return
      }

      if (targets.length === 0 && !settings.recording.windowSourceId && !settings.recording.windowSourceName && settings.recording.sourceType === 'window') {
        const preferredSource = findPreferredTerminalSource(sources)
        if (preferredSource) {
          onStatusChange(createLocalStatus(settings, `Автоматически выбрали окно терминала: ${preferredSource.name}`))
          const updated = await api.settings.update({
            recording: {
              ...settings.recording,
              sourceType: preferredSource.type,
              windowSourceId: preferredSource.id,
              windowSourceName: preferredSource.name,
              captureTargets: [{
                id: preferredSource.id,
                name: preferredSource.name,
                type: preferredSource.type,
                ...(preferredSource.displayId ? { displayId: preferredSource.displayId } : {})
              }],
              saveTargetMode: 'selected',
              saveTargetId: preferredSource.id
            }
          })
          if (!disposed) onSettingsChange?.(updated)
          return
        }
      }

      targets = resolveRecordingTargets(sources, settings)
      source = targets[0] ?? source
      if (targets.length === 0) {
        onStatusChange(createLocalStatus(settings, settings.recording.sourceType === 'screen'
          ? 'Экран для записи не найден. Обновите список источников.'
          : 'Откройте торговый терминал. TradeTools сам выберет подходящее окно и начнёт запись.'))
        scheduleSourceRetry(start)
        return
      }

      onStatusChange(createLocalStatus(settings, 'Запускаем оптимизированную ffmpeg-запись...'))
      const optimizedStatus = await api.recording.start()
      onStatusChange(optimizedStatus)
      if (!optimizedStatus.fallbackRequired) {
        statusPollTimer = window.setInterval(() => {
          void api.recording.getStatus().then((status) => {
            onStatusChange(status)
            if (status.fallbackRequired && !disposed) {
              if (statusPollTimer !== undefined) {
                window.clearInterval(statusPollTimer)
                statusPollTimer = undefined
              }
              void start().catch(handleStartError)
            }
          }).catch(handleStartError)
        }, nativeStatusPollMs)
        return
      }

      if (targets.length > 1) {
        onStatusChange(createLocalStatus(settings, `Запускаем запись ${targets.length} источников...`, true))
        await Promise.all(targets.map((target) => startBrowserRecorder(api, target)))
        if (!disposed) onStatusChange(createLocalStatus(settings, `Встроенная запись активна: ${targets.map((target) => target.name).join(', ')}`, true))
        return
      }

      onStatusChange(createLocalStatus(settings, optimizedStatus.message || 'Запускаем совместимую запись окна...'))
      if (!source) {
        scheduleSourceRetry(start)
        return
      }

      await startBrowserRecorder(api, source)
    }

    void start().catch(handleStartError)

    return cleanup
  }, [
    settings?.recording.mode,
    settings?.recording.sourceType,
    settings?.recording.windowSourceId,
    settings?.recording.windowSourceName,
    settings?.recording.captureTargets.map((target) => `${target.id}:${target.name}:${target.type}:${target.displayId ?? ''}`).join('|'),
    settings?.recording.saveTargetMode,
    settings?.recording.saveTargetId,
    settings?.recording.resolutionPreset,
    settings?.recording.frameRate,
    settings?.recording.segmentSeconds,
    settings?.recording.systemAudioEnabled,
    settings?.recording.microphoneEnabled,
    enabled,
    recordingEnsureKey,
    onStatusChange,
    onSettingsChange
  ])

  return null
}
