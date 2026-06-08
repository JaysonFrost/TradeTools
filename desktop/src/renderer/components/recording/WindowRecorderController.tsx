import { useEffect } from 'react'
import type { AppSettings } from '../../../main/services/settings/settings'
import type { WindowCaptureSource, WindowRecorderStatus } from '../../../main/services/recording/windowRecorderService'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'

export type WindowRecorderControllerProps = {
  settings?: AppSettings
  onStatusChange: (status: WindowRecorderStatus) => void
}

const chooseMimeType = (): string => {
  const candidates = [
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

const buildDesktopCaptureConstraints = (sourceId: string, frameRate: number): MediaStreamConstraints => ({
  audio: false,
  video: {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      maxFrameRate: frameRate,
      maxWidth: 3840,
      maxHeight: 2160
    }
  } as unknown as MediaTrackConstraints
})

const createLocalStatus = (settings: AppSettings, message: string, active = false): WindowRecorderStatus => ({
  enabled: settings.recording.mode === 'window',
  active,
  mode: settings.recording.mode,
  sourceId: settings.recording.windowSourceId,
  sourceName: settings.recording.windowSourceName,
  segmentCount: 0,
  bufferedSeconds: 0,
  lastSegmentAtMs: 0,
  message
})

export const WindowRecorderController = ({ settings, onStatusChange }: WindowRecorderControllerProps) => {
  useEffect(() => {
    if (!settings) return

    let disposed = false
    let stream: MediaStream | undefined
    let recorder: MediaRecorder | undefined
    let sessionTimer: number | undefined

    const cleanup = () => {
      disposed = true
      if (sessionTimer !== undefined) window.clearTimeout(sessionTimer)
      if (recorder?.state === 'recording') recorder.stop()
      stream?.getTracks().forEach((track) => track.stop())
    }

    const start = async () => {
      const api = getTradeToolsApi()
      if (settings.recording.mode !== 'window') {
        onStatusChange(await api.recording.getStatus())
        return
      }
      if (!settings.recording.windowSourceId && !settings.recording.windowSourceName) {
        onStatusChange(createLocalStatus(settings, settings.recording.sourceType === 'screen' ? 'Выберите экран для встроенной записи' : 'Выберите окно терминала для встроенной записи'))
        return
      }

      onStatusChange(createLocalStatus(settings, 'Запускаем встроенную запись окна...'))
      const sources = await api.recording.listWindowSources()
      const source = resolveSource(sources, settings)
      if (!source) {
        onStatusChange(createLocalStatus(settings, settings.recording.sourceType === 'screen'
          ? 'Выбранный экран не найден. Обновите список источников.'
          : 'Выбранное окно не найдено. Откройте терминал и обновите список окон.'))
        return
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia(
        buildDesktopCaptureConstraints(source.id, settings.recording.frameRate)
      )
      if (disposed) {
        mediaStream.getTracks().forEach((track) => track.stop())
        return
      }

      stream = mediaStream
      const mimeType = chooseMimeType()
      const chunkDurationMs = Math.max(1, settings.recording.segmentSeconds) * 1000
      const sessionDurationMs = Math.max(60_000, Math.min(300_000, settings.clip.replayBufferSeconds * 1000))

      const startRecordingSession = () => {
        if (disposed || !stream) return

        const sessionId = `${source.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`
        let sequence = 0
        let chunkStartedAtMs = Date.now()
        recorder = new MediaRecorder(stream, {
          ...(mimeType ? { mimeType } : {}),
          videoBitsPerSecond: 6_000_000
        })
        recorder.ondataavailable = (event) => {
          if (event.data.size <= 0) return

          const endedAtMs = Date.now()
          const startedAtMs = chunkStartedAtMs
          chunkStartedAtMs = endedAtMs
          const currentSequence = sequence
          sequence += 1

          void (async () => {
            if (disposed) return

            const status = await api.recording.appendSegment({
              sourceId: source.id,
              sourceName: source.name,
              sessionId,
              sequence: currentSequence,
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
        recorder.start(chunkDurationMs)
        sessionTimer = window.setTimeout(() => {
          if (recorder?.state === 'recording') recorder.stop()
        }, sessionDurationMs)
      }

      startRecordingSession()
    }

    void start().catch((error) => {
      onStatusChange(createLocalStatus(settings, error instanceof Error ? error.message : 'Не удалось запустить встроенную запись окна'))
    })

    return cleanup
  }, [
    settings?.recording.mode,
    settings?.recording.sourceType,
    settings?.recording.windowSourceId,
    settings?.recording.windowSourceName,
    settings?.recording.frameRate,
    settings?.recording.segmentSeconds,
    onStatusChange
  ])

  return null
}
