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

type FixedFrameRateStream = {
  stream: MediaStream
  stop: () => void
}

type RecordingStream = {
  stream: MediaStream
  stop: () => void
}

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

const isSavedWindowSourceMissing = (settings: AppSettings, source: WindowCaptureSource | undefined): boolean => (
  settings.recording.sourceType === 'window' &&
  Boolean(settings.recording.windowSourceId || settings.recording.windowSourceName) &&
  !source
)

const buildDesktopCaptureConstraints = (sourceId: string, frameRate: number): MediaStreamConstraints => ({
  audio: false,
  video: {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      minFrameRate: frameRate,
      maxFrameRate: frameRate,
      maxWidth: 3840,
      maxHeight: 2160
    },
    cursor: 'never'
  } as unknown as MediaTrackConstraints
})

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

const clampFrameRate = (frameRate: number): number => Math.max(10, Math.min(60, Math.trunc(frameRate)))

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

const createFixedFrameRateStream = async (
  sourceStream: MediaStream,
  frameRate: number,
  onLikelyBlackFrame?: () => void
): Promise<FixedFrameRateStream> => {
  const [track] = sourceStream.getVideoTracks()
  if (!track) throw new Error('Источник записи не вернул видеодорожку')

  const trackSettings = track.getSettings()
  const targetFrameRate = clampFrameRate(frameRate)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = sourceStream
  await video.play()
  await waitForVideoMetadata(video)

  const width = Math.max(1, Math.trunc(video.videoWidth || trackSettings.width || 1920))
  const height = Math.max(1, Math.trunc(video.videoHeight || trackSettings.height || 1080))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Не удалось подготовить canvas для записи')

  const sampleCanvas = document.createElement('canvas')
  sampleCanvas.width = 32
  sampleCanvas.height = 18
  const sampleContext = sampleCanvas.getContext('2d', { alpha: false, willReadFrequently: true })
  let lastSampleAtMs = 0
  let blackFrameStreak = 0
  let blackFrameReported = false

  const inspectFrame = () => {
    if (!sampleContext || blackFrameReported || !onLikelyBlackFrame) return

    const nowMs = Date.now()
    if (nowMs - lastSampleAtMs < 1_000) return
    lastSampleAtMs = nowMs

    sampleContext.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height)
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

  const drawFrame = () => {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    context.drawImage(video, 0, 0, width, height)
    inspectFrame()
  }
  drawFrame()

  const timer = window.setInterval(drawFrame, Math.max(16, Math.round(1000 / targetFrameRate)))
  const stream = canvas.captureStream(targetFrameRate)

  return {
    stream,
    stop: () => {
      window.clearInterval(timer)
      stream.getTracks().forEach((canvasTrack) => canvasTrack.stop())
      video.pause()
      video.srcObject = null
    }
  }
}

export const WindowRecorderController = ({ settings, enabled = true, recordingEnsureKey = 0, onStatusChange, onSettingsChange }: WindowRecorderControllerProps) => {
  useEffect(() => {
    if (!settings) return

    let disposed = false
    let stream: MediaStream | undefined
    let systemAudioStream: MediaStream | undefined
    let microphoneStream: MediaStream | undefined
    let fixedFrameRateStream: FixedFrameRateStream | undefined
    let recordingStream: RecordingStream | undefined
    let recorder: MediaRecorder | undefined
    let sessionTimer: number | undefined
    let sourceRetryTimer: number | undefined
    let statusPollTimer: number | undefined

    const cleanup = () => {
      disposed = true
      if (sessionTimer !== undefined) window.clearTimeout(sessionTimer)
      if (sourceRetryTimer !== undefined) window.clearTimeout(sourceRetryTimer)
      if (statusPollTimer !== undefined) window.clearInterval(statusPollTimer)
      if (recorder?.state === 'recording') recorder.stop()
      fixedFrameRateStream?.stop()
      recordingStream?.stop()
      stream?.getTracks().forEach((track) => track.stop())
      systemAudioStream?.getTracks().forEach((track) => track.stop())
      microphoneStream?.getTracks().forEach((track) => track.stop())
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
      }, 2_000)
    }

    const start = async () => {
      const api = getTradeToolsApi()
      if (settings.recording.mode !== 'window') {
        onStatusChange(await api.recording.getStatus())
        return
      }

      let sources: WindowCaptureSource[] | undefined
      let source: WindowCaptureSource | undefined
      if (settings.recording.sourceType === 'window') {
        sources = await api.recording.listWindowSources()
        source = resolveSource(sources, settings)
        if (isSavedWindowSourceMissing(settings, source)) {
          onStatusChange(createLocalStatus(settings, `Окно ${settings.recording.windowSourceName} не найдено. Откройте торговый терминал, TradeTools продолжит запись автоматически.`))
          scheduleSourceRetry(start)
          return
        }
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
        }, 2_000)
        return
      }

      onStatusChange(createLocalStatus(settings, optimizedStatus.message || 'Запускаем совместимую запись окна...'))
      sources = sources ?? await api.recording.listWindowSources()
      source = source ?? resolveSource(sources, settings)
      if (!source && settings.recording.sourceType === 'screen') {
        const screenSource = sources.find((candidate) => candidate.type === 'screen')
        if (screenSource) {
          onStatusChange(createLocalStatus(settings, `Автоматически выбрали экран: ${screenSource.name}`))
          const updated = await api.settings.update({
            recording: {
              ...settings.recording,
              windowSourceId: screenSource.id,
              windowSourceName: screenSource.name
            }
          })
          if (!disposed) onSettingsChange?.(updated)
          return
        }
      }
      if (!source && !settings.recording.windowSourceId && !settings.recording.windowSourceName && settings.recording.sourceType === 'window') {
        source = findPreferredTerminalSource(sources)
        if (source) {
          onStatusChange(createLocalStatus(settings, `Автоматически выбрали окно терминала: ${source.name}`))
          const updated = await api.settings.update({
            recording: {
              ...settings.recording,
              sourceType: source.type,
              windowSourceId: source.id,
              windowSourceName: source.name
            }
          })
          if (!disposed) onSettingsChange?.(updated)
          return
        }
      }
      if (!source) {
        onStatusChange(createLocalStatus(settings, settings.recording.sourceType === 'screen'
          ? 'Экран для записи не найден. Обновите список источников.'
          : 'Откройте торговый терминал. TradeTools сам выберет подходящее окно и начнёт запись.'))
        scheduleSourceRetry(start)
        return
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia(
        buildDesktopCaptureConstraints(source.id, settings.recording.frameRate)
      )
      try {
        systemAudioStream = settings.recording.systemAudioEnabled
          ? await captureSystemAudioStream()
          : undefined
        microphoneStream = settings.recording.microphoneEnabled
          ? await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
          : undefined
      } catch (error) {
        mediaStream.getTracks().forEach((track) => track.stop())
        throw error
      }
      if (disposed) {
        mediaStream.getTracks().forEach((track) => track.stop())
        systemAudioStream?.getTracks().forEach((track) => track.stop())
        microphoneStream?.getTracks().forEach((track) => track.stop())
        return
      }

      stream = mediaStream
      try {
        fixedFrameRateStream = await createFixedFrameRateStream(mediaStream, settings.recording.frameRate, source.type === 'window'
          ? () => {
              const screenSource = sources.find((candidate) => candidate.type === 'screen')
              if (!screenSource || disposed) return

              onStatusChange(createLocalStatus(settings, 'Окно Vataga отдаёт чёрный кадр. Переключаемся на запись экрана.'))
              void api.settings.update({
                recording: {
                  ...settings.recording,
                  sourceType: 'screen',
                  windowSourceId: screenSource.id,
                  windowSourceName: screenSource.name
                }
              }).then((updated) => {
                if (!disposed) onSettingsChange?.(updated)
              }).catch((error) => {
                onStatusChange(createLocalStatus(settings, error instanceof Error ? error.message : 'Не удалось переключиться на запись экрана'))
              })
            }
          : undefined)
      } catch (error) {
        mediaStream.getTracks().forEach((track) => track.stop())
        systemAudioStream?.getTracks().forEach((track) => track.stop())
        microphoneStream?.getTracks().forEach((track) => track.stop())
        stream = undefined
        throw error
      }
      if (disposed) {
        fixedFrameRateStream.stop()
        mediaStream.getTracks().forEach((track) => track.stop())
        systemAudioStream?.getTracks().forEach((track) => track.stop())
        microphoneStream?.getTracks().forEach((track) => track.stop())
        return
      }

      recordingStream = createRecordingStream(fixedFrameRateStream.stream, [systemAudioStream, microphoneStream])
      const mimeType = chooseMimeType(hasAudioTracks(recordingStream.stream))
      const chunkDurationMs = Math.max(1, settings.recording.segmentSeconds) * 1000

      const startRecordingSession = () => {
        if (disposed || !fixedFrameRateStream || !recordingStream) return

        const sessionId = `${source.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const chunkStartedAtMs = Date.now()
        recorder = new MediaRecorder(recordingStream.stream, {
          ...(mimeType ? { mimeType } : {}),
          videoBitsPerSecond: 6_000_000,
          audioBitsPerSecond: 192_000
        })
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
          if (sessionTimer !== undefined) {
            window.clearTimeout(sessionTimer)
            sessionTimer = undefined
          }
          if (!disposed) startRecordingSession()
        }
        recorder.start()
        sessionTimer = window.setTimeout(() => {
          if (recorder?.state === 'recording') recorder.stop()
        }, chunkDurationMs)
      }

      startRecordingSession()
    }

    void start().catch(handleStartError)

    return cleanup
  }, [
    settings?.recording.mode,
    settings?.recording.sourceType,
    settings?.recording.windowSourceId,
    settings?.recording.windowSourceName,
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
