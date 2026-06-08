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
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ]

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
}

const resolveSource = (sources: WindowCaptureSource[], settings: AppSettings): WindowCaptureSource | undefined => (
  sources.find((source) => source.id === settings.recording.windowSourceId) ??
  sources.find((source) => source.name === settings.recording.windowSourceName)
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
    let segmentTimer: number | undefined

    const cleanup = () => {
      disposed = true
      if (segmentTimer !== undefined) window.clearTimeout(segmentTimer)
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
        onStatusChange(createLocalStatus(settings, 'Выберите окно терминала для встроенной записи'))
        return
      }

      onStatusChange(createLocalStatus(settings, 'Запускаем встроенную запись окна...'))
      const sources = await api.recording.listWindowSources()
      const source = resolveSource(sources, settings)
      if (!source) {
        onStatusChange(createLocalStatus(settings, 'Выбранное окно не найдено. Откройте терминал и обновите список окон.'))
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
      const segmentDurationMs = Math.max(1, settings.recording.segmentSeconds) * 1000

      const startSegment = () => {
        if (disposed || !stream) return

        const chunks: Blob[] = []
        const startedAtMs = Date.now()
        recorder = new MediaRecorder(stream, {
          ...(mimeType ? { mimeType } : {}),
          videoBitsPerSecond: 4_000_000
        })
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data)
        }
        recorder.onerror = () => {
          onStatusChange(createLocalStatus(settings, 'Встроенная запись окна остановилась с ошибкой'))
        }
        recorder.onstop = () => {
          const endedAtMs = Date.now()
          const blob = new Blob(chunks, { type: mimeType || 'video/webm' })

          void (async () => {
            if (!disposed && blob.size > 0) {
              const status = await api.recording.appendSegment({
                sourceId: source.id,
                sourceName: source.name,
                startedAtMs,
                endedAtMs,
                mimeType: blob.type,
                data: await blob.arrayBuffer()
              })
              onStatusChange(status)
            }
          })().catch((error) => {
            onStatusChange(createLocalStatus(settings, error instanceof Error ? error.message : 'Не удалось сохранить сегмент записи'))
          }).finally(() => {
            if (!disposed) startSegment()
          })
        }
        recorder.start()
        segmentTimer = window.setTimeout(() => {
          if (recorder?.state === 'recording') recorder.stop()
        }, segmentDurationMs)
      }

      startSegment()
    }

    void start().catch((error) => {
      onStatusChange(createLocalStatus(settings, error instanceof Error ? error.message : 'Не удалось запустить встроенную запись окна'))
    })

    return cleanup
  }, [
    settings?.recording.mode,
    settings?.recording.windowSourceId,
    settings?.recording.windowSourceName,
    settings?.recording.frameRate,
    settings?.recording.segmentSeconds,
    onStatusChange
  ])

  return null
}
