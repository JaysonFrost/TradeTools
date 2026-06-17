import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join } from 'node:path'
import type { AppSettings, CaptureTargetRef } from '../settings/settings'
import type { ClosedTrade } from '../trades/simulatedTradePipeline'
import { toSafeClipFileBaseName } from '../video/clipPaths'
import { buildH264VideoArgs } from '../video/ffmpegCommand'
import { createMissingMediaToolError, isMissingMediaToolError, resolveMediaToolPath } from '../video/mediaBinaries'

export type WindowCaptureSource = {
  id: string
  name: string
  displayId: string
  type: AppSettings['recording']['sourceType']
}

export type ScreenCaptureBounds = {
  displayId: string
  x: number
  y: number
  width: number
  height: number
}

export type WindowRecordingSegmentInput = {
  sourceId: string
  sourceName: string
  sessionId?: string
  sequence?: number
  startedAtMs: number
  endedAtMs: number
  mimeType: string
  data: ArrayBuffer
}

export type WindowRecorderStatus = {
  enabled: boolean
  active: boolean
  backend: 'ffmpeg' | 'browser'
  fallbackRequired?: boolean
  mode: AppSettings['recording']['mode']
  sourceId: string
  sourceName: string
  segmentCount: number
  bufferedSeconds: number
  lastSegmentAtMs: number
  message: string
  sources?: Array<{
    sourceId: string
    sourceName: string
    segmentCount: number
    bufferedSeconds: number
    lastSegmentAtMs: number
  }>
}

export type WindowReplaySaveInput = {
  settings: AppSettings
  trade: ClosedTrade
  captureTarget?: CaptureTargetRef
  signal?: AbortSignal
}

export type WindowReplaySaveResult = {
  ok: boolean
  message: string
  requestedAtMs: number
  replayPath?: string
  readyClip?: boolean
}

export type FreeRecordingStatus = {
  active: boolean
  paused: boolean
  startedAtMs: number
  currentIntervalStartedAtMs: number
  recordedSeconds: number
  segmentCount: number
  outputPath?: string
  message: string
}

export type FreeRecordingFinishResult = {
  ok: true
  videoPath: string
  fileName: string
  startedAtMs: number
  endedAtMs: number
  durationSeconds: number
}

export type WindowRecorderService = {
  appendSegment: (input: WindowRecordingSegmentInput, settings: AppSettings) => Promise<WindowRecorderStatus>
  finishFreeRecording: (settings: AppSettings) => Promise<FreeRecordingFinishResult>
  getFreeRecordingStatus: (settings: AppSettings) => Promise<FreeRecordingStatus>
  getStatus: (settings: AppSettings) => Promise<WindowRecorderStatus>
  pauseFreeRecording: (settings: AppSettings) => Promise<FreeRecordingStatus>
  protectSince: (timeMs?: number) => void
  resumeFreeRecording: (settings: AppSettings) => Promise<FreeRecordingStatus>
  saveReplayBuffer: (input: WindowReplaySaveInput) => Promise<WindowReplaySaveResult>
  start: (settings: AppSettings) => Promise<WindowRecorderStatus>
  startFreeRecording: (settings: AppSettings) => Promise<FreeRecordingStatus>
  stop: () => Promise<void>
}

type StoredSegment = {
  id: string
  backend: WindowRecorderStatus['backend']
  sourceId: string
  sourceName: string
  sessionId: string
  sequence: number
  startedAtMs: number
  endedAtMs: number
  path: string
  sizeBytes: number
}

type ReplaySessionFile = {
  path: string
  startedAtMs: number
  endedAtMs: number
  cleanup?: boolean
}

type ReplayWriteResult = {
  sessionFiles: ReplaySessionFile[]
  readyClip: boolean
}

export type ReplayWindowSegment = {
  startedAtMs: number
  endedAtMs: number
}

export type AvailableReplayWindow<T extends ReplayWindowSegment> = {
  segments: T[]
  replayStartMs: number
  replayEndMs: number
}

type ReplayExportResult = {
  replayPath: string
  readyClip: boolean
}

type WindowRecorderServiceInput = {
  appDataDir: string
  isWindowSourceAvailable?: (source: { sourceId: string, sourceName: string }) => Promise<boolean>
  getDisplayBounds?: () => ScreenCaptureBounds[]
}

type NativeRecorderState = {
  process: ChildProcess
  sessionId: string
  settingsKey: string
  sourceId: string
  sourceName: string
  startedAtMs: number
  listPath: string
  outputPattern: string
  stderr: string
  stopping: boolean
}

type NativeRecorderTarget = {
  sourceId: string
  sourceName: string
  inputName: string
  bounds?: ScreenCaptureBounds
}

type FreeRecordingInterval = {
  startMs: number
  endMs?: number
}

type FreeRecordingState = {
  startedAtMs: number
  intervals: FreeRecordingInterval[]
}

const pollIntervalMs = 250
const exportToleranceMs = 1_500
const segmentStaleAfterMs = 8_000
const nativeRecorderStartupGraceMs = 900

const sleep = (durationMs: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, durationMs))

const sanitizeSegmentTime = (value: unknown): number => {
  const time = Number(value)
  return Number.isFinite(time) && time > 0 ? Math.trunc(time) : 0
}

const toFileTimestamp = (timeMs: number): string => new Date(timeMs).toISOString().replace(/[:.]/g, '-')
const formatRoundedSeconds = (seconds: number): string => `${Math.max(0, Math.ceil(seconds))}с`
const formatFfmpegSeconds = (seconds: number): string => Math.max(0, seconds).toFixed(3)
const padDatePart = (value: number): string => String(value).padStart(2, '0')
const formatFilePeriodTimestamp = (timeMs: number): string => {
  const date = new Date(timeMs)
  return `${padDatePart(date.getDate())}.${padDatePart(date.getMonth() + 1)}.${date.getFullYear()} ${padDatePart(date.getHours())}-${padDatePart(date.getMinutes())}-${padDatePart(date.getSeconds())}`
}

const escapeConcatPath = (path: string): string => path.replace(/\\/g, '/').replace(/'/g, "'\\''")
const isNativeRecordingSupported = (): boolean => process.platform === 'win32'
const isGdigrabRecorderEnabled = (): boolean => process.env.TRADETOOLS_ENABLE_GDIGRAB === '1'
const normalizeFfmpegLog = (value: string): string => value.replace(/\s+/g, ' ').trim().slice(-800)
const isMissingNativeWindowError = (value: string): boolean => /Can't find window|Error opening input file title=/i.test(value)
const formatFrameRate = (value: number): string => String(Math.max(10, Math.min(60, Math.trunc(value))))
const browserAudioEnabled = (settings: AppSettings): boolean => settings.recording.systemAudioEnabled || settings.recording.microphoneEnabled
const getErrorCode = (error: unknown): string => (
  typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
)

const distanceToReplayWindow = (segment: ReplayWindowSegment, replayStartMs: number, replayEndMs: number): number => {
  if (segment.endedAtMs < replayStartMs) return replayStartMs - segment.endedAtMs
  if (segment.startedAtMs > replayEndMs) return segment.startedAtMs - replayEndMs
  return 0
}

export const selectAvailableReplayWindow = <T extends ReplayWindowSegment>(
  sourceSegments: T[],
  replayStartMs: number,
  replayEndMs: number
): AvailableReplayWindow<T> | undefined => {
  const overlapping = sourceSegments.filter((segment) => (
    segment.endedAtMs >= replayStartMs - exportToleranceMs &&
    segment.startedAtMs <= replayEndMs + exportToleranceMs
  ))
  const first = overlapping[0]
  const last = overlapping.at(-1)
  if (first && last) {
    const clippedStartMs = Math.max(replayStartMs, first.startedAtMs)
    const clippedEndMs = Math.min(replayEndMs, last.endedAtMs)
    if (clippedEndMs > clippedStartMs) {
      return {
        segments: overlapping,
        replayStartMs: clippedStartMs,
        replayEndMs: clippedEndMs
      }
    }
  }

  const nearest = sourceSegments.reduce<T | undefined>((best, segment) => {
    if (!best) return segment
    const bestDistance = distanceToReplayWindow(best, replayStartMs, replayEndMs)
    const segmentDistance = distanceToReplayWindow(segment, replayStartMs, replayEndMs)
    return segmentDistance < bestDistance ? segment : best
  }, undefined)
  if (!nearest || nearest.endedAtMs <= nearest.startedAtMs) return undefined

  return {
    segments: [nearest],
    replayStartMs: nearest.startedAtMs,
    replayEndMs: nearest.endedAtMs
  }
}

const createAbortError = (): Error => new Error('Сохранение клипа отменено')

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw createAbortError()
}

const runFfmpeg = async (args: string[], signal?: AbortSignal): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    throwIfAborted(signal)
    const child = spawn(resolveMediaToolPath('ffmpeg'), args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let settled = false
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => {
      child.kill('SIGTERM')
      settle(() => reject(createAbortError()))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      settle(() => reject(isMissingMediaToolError(error) ? createMissingMediaToolError('ffmpeg') : error))
    })
    child.on('exit', (code) => {
      if (code === 0) {
        settle(resolve)
        return
      }

      settle(() => reject(new Error(`ffmpeg exited with code ${code ?? 'unknown'}: ${stderr.trim()}`)))
    })
  })
}

export const createWindowRecorderService = ({ appDataDir, isWindowSourceAvailable, getDisplayBounds }: WindowRecorderServiceInput): WindowRecorderService => {
  const segmentsDir = join(appDataDir, 'window-recording', 'segments')
  const replaysDir = join(appDataDir, 'window-recording', 'replays')
  const segments: StoredSegment[] = []
  let protectedSinceMs = 0
  let freeRecording: FreeRecordingState | undefined
  let nativeRecorders: NativeRecorderState[] = []
  let nativeLastError = ''
  let nativeMissingSource: { settingsKey: string, message: string } | undefined

  const nativeSettingsKey = (settings: AppSettings, target?: NativeRecorderTarget): string => [
    settings.recording.sourceType,
    settings.recording.windowSourceId,
    settings.recording.windowSourceName,
    settings.recording.frameRate,
    settings.recording.segmentSeconds,
    String(settings.recording.systemAudioEnabled),
    String(settings.recording.microphoneEnabled),
    target?.sourceId ?? '',
    target?.sourceName ?? '',
    target?.bounds ? `${target.bounds.x}:${target.bounds.y}:${target.bounds.width}:${target.bounds.height}` : ''
  ].join('|')

  const nativeSourceName = (settings: AppSettings): string => (
    settings.recording.windowSourceName ||
    (settings.recording.sourceType === 'screen' ? 'Экран' : '')
  )

  const evenCaptureSize = (value: number): number => {
    const size = Math.max(2, Math.trunc(value))
    return size % 2 === 0 ? size : size - 1
  }

  const nativeWindowTarget = (settings: AppSettings): NativeRecorderTarget => ({
    sourceId: settings.recording.windowSourceId || 'window',
    sourceName: nativeSourceName(settings),
    inputName: `title=${settings.recording.windowSourceName}`
  })

  const nativeScreenTargets = (settings: AppSettings): NativeRecorderTarget[] => {
    const displays = new Map((getDisplayBounds?.() ?? []).map((display) => [display.displayId, display]))
    return settings.recording.captureTargets
      .filter((target) => target.type === 'screen' && target.id.startsWith('screen:') && target.displayId)
      .flatMap((target) => {
        const bounds = displays.get(target.displayId ?? '')
        return bounds
          ? [{
              sourceId: target.id,
              sourceName: target.name,
              inputName: 'desktop',
              bounds
            }]
          : []
      })
  }

  const clearNativeMissingSource = () => {
    nativeMissingSource = undefined
  }

  const markNativeMissingSource = (input: { settingsKey: string, sourceName: string }): string => {
    const message = `Окно ${input.sourceName} не найдено. Откройте торговый терминал, TradeTools продолжит запись автоматически.`
    nativeLastError = ''
    nativeMissingSource = {
      settingsKey: input.settingsKey,
      message
    }
    return message
  }

  const savedWindowSourceMissingStatus = async (settings: AppSettings): Promise<WindowRecorderStatus | undefined> => {
    if (
      settings.recording.sourceType !== 'window' ||
      !settings.recording.windowSourceName ||
      !isWindowSourceAvailable
    ) {
      return undefined
    }

    const available = await isWindowSourceAvailable({
      sourceId: settings.recording.windowSourceId,
      sourceName: settings.recording.windowSourceName
    })
    if (available) {
      clearNativeMissingSource()
      return undefined
    }

    await stopNativeRecorder()
    const message = markNativeMissingSource({
      settingsKey: nativeSettingsKey(settings),
      sourceName: settings.recording.windowSourceName
    })
    return buildStatus(settings, {
      backend: 'browser',
      fallbackRequired: true,
      message
    })
  }

  const buildNativeRecorderArgs = (settings: AppSettings, outputPattern: string, listPath: string, target: NativeRecorderTarget): string[] => {
    const frameRate = formatFrameRate(settings.recording.frameRate)
    const segmentSeconds = String(Math.max(1, Math.trunc(settings.recording.segmentSeconds)))
    const boundsArgs = target.bounds
      ? [
          '-offset_x',
          String(Math.trunc(target.bounds.x)),
          '-offset_y',
          String(Math.trunc(target.bounds.y)),
          '-video_size',
          `${evenCaptureSize(target.bounds.width)}x${evenCaptureSize(target.bounds.height)}`
        ]
      : []

    return [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-nostdin',
      '-f',
      'gdigrab',
      '-framerate',
      frameRate,
      '-draw_mouse',
      '0',
      ...boundsArgs,
      '-i',
      target.inputName,
      '-map',
      '0:v:0',
      '-an',
      ...buildH264VideoArgs({ platform: process.platform, purpose: 'recording' }),
      '-r',
      frameRate,
      '-fps_mode',
      'cfr',
      '-f',
      'segment',
      '-segment_time',
      segmentSeconds,
      '-reset_timestamps',
      '1',
      '-segment_format',
      'mp4',
      '-segment_list',
      listPath,
      '-segment_list_type',
      'csv',
      outputPattern
    ]
  }

  const stopNativeRecorder = async () => {
    clearNativeMissingSource()
    const currentRecorders = nativeRecorders
    nativeRecorders = []
    if (currentRecorders.length === 0) return

    await Promise.all(currentRecorders.map(async (current) => {
      current.stopping = true
      if (current.process.exitCode !== null || current.process.killed) return

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          current.process.kill('SIGKILL')
          resolve()
        }, 1_500)
        current.process.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
        current.process.kill('SIGTERM')
      })
    }))
  }

  const scanNativeSegments = async () => {
    const currentRecorders = nativeRecorders
    if (currentRecorders.length === 0) return

    for (const current of currentRecorders) {
      const listText = await readFile(current.listPath, 'utf8').catch(() => '')
      if (!listText.trim()) continue

      const knownIds = new Set(segments.map((segment) => segment.id))
      const lines = listText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

      for (const [index, line] of lines.entries()) {
        const [rawPath, rawStart, rawEnd] = line.split(',')
        if (!rawPath || !rawStart || !rawEnd) continue

        const startSeconds = Number(rawStart)
        const endSeconds = Number(rawEnd)
        if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) continue

        const segmentPath = isAbsolute(rawPath) ? rawPath : join(segmentsDir, rawPath)
        const fileStat = await stat(segmentPath).catch(() => undefined)
        if (!fileStat?.isFile() || fileStat.size <= 0) continue

        const id = `${current.sessionId}-${index}`
        if (knownIds.has(id)) continue

        segments.push({
          id,
          backend: 'ffmpeg',
          sourceId: current.sourceId,
          sourceName: current.sourceName,
          sessionId: current.sessionId,
          sequence: index,
          startedAtMs: current.startedAtMs + Math.round(startSeconds * 1000),
          endedAtMs: current.startedAtMs + Math.round(endSeconds * 1000),
          path: segmentPath,
          sizeBytes: fileStat.size
        })
        knownIds.add(id)
      }
    }
  }

  const startNativeRecorders = async (
    settings: AppSettings,
    targets: NativeRecorderTarget[],
    startedMessage: string
  ): Promise<WindowRecorderStatus> => {
    const settingsKeys = targets.map((target) => nativeSettingsKey(settings, target))
    const activeRecorders = nativeRecorders.filter((recorder) => recorder.process.exitCode === null)
    if (
      activeRecorders.length === targets.length &&
      settingsKeys.every((key) => activeRecorders.some((recorder) => recorder.settingsKey === key))
    ) {
      await scanNativeSegments()
      return buildStatus(settings, { backend: 'ffmpeg' })
    }

    await stopNativeRecorder()
    await mkdir(segmentsDir, { recursive: true })
    nativeLastError = ''
    clearNativeMissingSource()

    const startedRecorders = targets.map((target) => {
      const sessionId = `ffmpeg-${Date.now()}-${randomUUID()}`
      const listPath = join(segmentsDir, `${sessionId}.csv`)
      const outputPattern = join(segmentsDir, `${sessionId}-%06d.mp4`)
      const processStartedAtMs = Date.now()
      const child = spawn(resolveMediaToolPath('ffmpeg'), buildNativeRecorderArgs(settings, outputPattern, listPath, target), {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true
      })
      const state: NativeRecorderState = {
        process: child,
        sessionId,
        settingsKey: nativeSettingsKey(settings, target),
        sourceId: target.sourceId,
        sourceName: target.sourceName,
        startedAtMs: processStartedAtMs,
        listPath,
        outputPattern,
        stderr: '',
        stopping: false
      }

      child.stderr.on('data', (chunk) => {
        state.stderr = normalizeFfmpegLog(`${state.stderr}${String(chunk)}`)
      })
      child.on('error', (error) => {
        nativeLastError = isMissingMediaToolError(error) ? createMissingMediaToolError('ffmpeg').message : error.message
        clearNativeMissingSource()
        nativeRecorders = nativeRecorders.filter((recorder) => recorder !== state)
      })
      child.on('exit', (code, signal) => {
        if (state.stopping) {
          clearNativeMissingSource()
        } else {
          const stderr = normalizeFfmpegLog(state.stderr)
          if (isMissingNativeWindowError(stderr) && state.sourceName) {
            markNativeMissingSource({
              settingsKey: state.settingsKey,
              sourceName: state.sourceName
            })
          } else {
            nativeLastError = stderr || `ffmpeg остановился: ${code ?? signal ?? 'unknown'}`
            clearNativeMissingSource()
          }
        }
        nativeRecorders = nativeRecorders.filter((recorder) => recorder !== state)
      })

      return state
    })

    nativeRecorders = startedRecorders
    await sleep(nativeRecorderStartupGraceMs)

    const runningRecorders = nativeRecorders.filter((recorder) => recorder.process.exitCode === null)
    if (runningRecorders.length !== targets.length) {
      const missingMessage = settingsKeys.some((key) => nativeMissingSource?.settingsKey === key)
        ? nativeMissingSource?.message
        : undefined
      await stopNativeRecorder()
      if (missingMessage) {
        return buildStatus(settings, {
          backend: 'browser',
          fallbackRequired: true,
          message: missingMessage
        })
      }

      return buildStatus(settings, {
        backend: 'browser',
        fallbackRequired: true,
        message: nativeLastError
          ? `ffmpeg-рекордер не запустился: ${nativeLastError}. Используем совместимый рекордер Chromium.`
          : 'ffmpeg-рекордер не запустился. Используем совместимый рекордер Chromium.'
      })
    }

    return buildStatus(settings, {
      backend: 'ffmpeg',
      message: startedMessage
    })
  }

  const startNativeRecorder = async (settings: AppSettings): Promise<WindowRecorderStatus> => {
    if (settings.recording.mode !== 'window') {
      await stopNativeRecorder()
      return buildStatus(settings)
    }

    const missingWindowStatus = await savedWindowSourceMissingStatus(settings)
    if (missingWindowStatus) return missingWindowStatus

    if (!isNativeRecordingSupported()) {
      return buildStatus(settings, {
        backend: 'browser',
        fallbackRequired: true,
        message: 'Оптимизированная ffmpeg-запись пока доступна на Windows. Используем совместимый рекордер Chromium.'
      })
    }

    if (browserAudioEnabled(settings)) {
      await stopNativeRecorder()
      return buildStatus(settings, {
        backend: 'browser',
        fallbackRequired: true,
        message: 'Звук встроен в видео через Chromium: системный звук и микрофон идут в тот же клип.'
      })
    }

    if (settings.recording.sourceType === 'screen') {
      const targets = nativeScreenTargets(settings)
      if (targets.length === 0) {
        await stopNativeRecorder()
        return buildStatus(settings, {
          backend: 'browser',
          fallbackRequired: true,
          message: 'Не удалось определить координаты выбранных мониторов. Обновите список источников в настройках записи.'
        })
      }

      return startNativeRecorders(settings, targets, `Оптимизированная запись экранов запущена: ${targets.map((target) => target.sourceName).join(', ')}`)
    }

    if (settings.recording.sourceType === 'window' && !settings.recording.windowSourceName) {
      return buildStatus(settings, {
        backend: 'browser',
        fallbackRequired: true,
        message: 'Откройте торговый терминал, TradeTools выберет окно и начнёт запись'
      })
    }

    if (!isGdigrabRecorderEnabled()) {
      await stopNativeRecorder()
      return buildStatus(settings, {
        backend: 'browser',
        fallbackRequired: true,
        message: 'Фоновый GDI-захват отключён: он может мигать курсором Windows. Пишем через встроенный Chromium-рекордер без курсора.'
      })
    }

    return startNativeRecorders(settings, [nativeWindowTarget(settings)], 'Оптимизированная ffmpeg-запись запущена, ждём первые сегменты')
  }

  const pruneDiskFiles = async (keepPaths: Set<string>) => {
    const entries = await readdir(segmentsDir, { withFileTypes: true }).catch(() => [])
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile()) return
      const filePath = join(segmentsDir, entry.name)
      const extension = extname(entry.name).toLowerCase()
      if (!['.webm', '.mp4', '.csv'].includes(extension)) return
      if (keepPaths.has(filePath)) return
      if (nativeRecorders.some((recorder) => recorder.listPath === filePath)) return

      if (nativeRecorders.some((recorder) => entry.name.startsWith(`${recorder.sessionId}-`))) {
        const fileStat = await stat(filePath).catch(() => undefined)
        if (fileStat && Date.now() - fileStat.mtimeMs < segmentStaleAfterMs) return
      }

      await rm(filePath, { force: true }).catch(() => undefined)
    }))
  }

  const pruneSegments = async (settings: AppSettings, nowMs = Date.now()) => {
    await scanNativeSegments()
    const maxAgeMs = (settings.clip.replayBufferSeconds + settings.clip.paddingBeforeSeconds + settings.clip.paddingAfterSeconds + 30) * 1000
    const replayCutoffMs = nowMs - maxAgeMs
    const protectedCutoffs = [protectedSinceMs, freeRecording?.startedAtMs ?? 0].filter((value) => value > 0)
    const protectedCutoffMs = protectedCutoffs.length > 0 ? Math.min(...protectedCutoffs) : 0
    const cutoffMs = protectedCutoffMs > 0 ? Math.min(replayCutoffMs, protectedCutoffMs) : replayCutoffMs
    const sessionLastEndedAt = new Map<string, number>()

    for (const segment of segments) {
      sessionLastEndedAt.set(segment.sessionId, Math.max(sessionLastEndedAt.get(segment.sessionId) ?? 0, segment.endedAtMs))
    }

    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index]
      if (!segment || (sessionLastEndedAt.get(segment.sessionId) ?? segment.endedAtMs) >= cutoffMs) continue

      segments.splice(index, 1)
      await rm(segment.path, { force: true }).catch(() => undefined)
    }

    const keepPaths = new Set(segments.map((segment) => segment.path))
    await pruneDiskFiles(keepPaths)
  }

  const primaryCaptureTarget = (settings: AppSettings): CaptureTargetRef | undefined => (
    settings.recording.captureTargets.find((target) => target.id === settings.recording.saveTargetId) ??
    settings.recording.captureTargets[0] ??
    (settings.recording.windowSourceId ? {
      id: settings.recording.windowSourceId,
      name: settings.recording.windowSourceName,
      type: settings.recording.sourceType
    } : undefined)
  )

  const targetMatchesSegment = (segment: StoredSegment, captureTarget: CaptureTargetRef): boolean => (
    segment.sourceId === captureTarget.id ||
    (Boolean(captureTarget.name) && segment.sourceName === captureTarget.name)
  )

  const relevantSegments = (settings: AppSettings, captureTarget?: CaptureTargetRef): StoredSegment[] => {
    const target = captureTarget ?? primaryCaptureTarget(settings)
    const sourceId = settings.recording.windowSourceId
    const sourceName = settings.recording.windowSourceName
    return segments
      .filter((segment) => target
        ? targetMatchesSegment(segment, target)
        : (sourceId ? segment.sourceId === sourceId || segment.sourceName === sourceName : segment.sourceName === sourceName))
      .sort((a, b) => a.startedAtMs - b.startedAtMs)
  }

  const buildSourceStatuses = (settings: AppSettings) => settings.recording.captureTargets.map((target) => {
    const sourceSegments = relevantSegments(settings, target)
    const first = sourceSegments[0]
    const last = sourceSegments.at(-1)
    const rawBufferedSeconds = first && last ? Math.max(0, (last.endedAtMs - first.startedAtMs) / 1000) : 0

    return {
      sourceId: target.id,
      sourceName: target.name,
      segmentCount: sourceSegments.length,
      bufferedSeconds: Math.min(settings.clip.replayBufferSeconds, rawBufferedSeconds),
      lastSegmentAtMs: last?.endedAtMs ?? 0
    }
  })

  const buildStatus = async (
    settings: AppSettings,
    override: Partial<Pick<WindowRecorderStatus, 'backend' | 'fallbackRequired' | 'message'>> = {}
  ): Promise<WindowRecorderStatus> => {
    await pruneSegments(settings)
    const sourceSegments = relevantSegments(settings)
    const first = sourceSegments[0]
    const last = sourceSegments.at(-1)
    const rawBufferedSeconds = first && last ? Math.max(0, (last.endedAtMs - first.startedAtMs) / 1000) : 0
    const bufferedSeconds = Math.min(settings.clip.replayBufferSeconds, rawBufferedSeconds)
    const hasNativeRecorder = nativeRecorders.length > 0
    const active = Boolean(hasNativeRecorder && override.backend !== 'browser') || Boolean(last && Date.now() - last.endedAtMs < segmentStaleAfterMs)
    const backend = override.backend ?? (hasNativeRecorder ? 'ffmpeg' : 'browser')
    const bufferTargetSeconds = Math.max(1, Math.round(settings.clip.replayBufferSeconds))
    const bufferMessage = `накоплено ${Math.round(bufferedSeconds)}с из ${bufferTargetSeconds}с`
    const defaultMessage = settings.recording.mode !== 'window'
      ? 'Встроенная запись окна выключена'
      : !settings.recording.windowSourceId && settings.recording.sourceType === 'window'
        ? 'Откройте торговый терминал, TradeTools выберет окно и начнёт запись'
        : backend === 'ffmpeg' && hasNativeRecorder
          ? bufferedSeconds > 0
            ? `Оптимизированная ffmpeg-запись активна, ${bufferMessage}`
            : 'Оптимизированная ffmpeg-запись активна, ждём первые сегменты'
          : nativeLastError
            ? `ffmpeg-рекордер остановился: ${nativeLastError}`
            : active
              ? `Встроенная запись активна, ${bufferMessage}`
              : 'Ждём сегменты от встроенного рекордера'

    return {
      enabled: settings.recording.mode === 'window',
      active,
      backend,
      ...(override.fallbackRequired || (settings.recording.mode === 'window' && !hasNativeRecorder && Boolean(nativeLastError)) ? { fallbackRequired: true } : {}),
      mode: settings.recording.mode,
      sourceId: settings.recording.windowSourceId,
      sourceName: settings.recording.windowSourceName,
      segmentCount: sourceSegments.length,
      bufferedSeconds,
      lastSegmentAtMs: last?.endedAtMs ?? 0,
      message: override.message ?? defaultMessage,
      sources: buildSourceStatuses(settings)
    }
  }

  const waitForSegmentsUntil = async (settings: AppSettings, targetEndMs: number, timeoutMs: number, captureTarget?: CaptureTargetRef): Promise<StoredSegment[]> => {
    const deadlineMs = Date.now() + timeoutMs
    while (Date.now() <= deadlineMs) {
      await pruneSegments(settings)
      const sourceSegments = relevantSegments(settings, captureTarget)
      if (sourceSegments.some((segment) => segment.endedAtMs >= targetEndMs - exportToleranceMs)) {
        return sourceSegments
      }
      await sleep(pollIntervalMs)
    }

    return relevantSegments(settings, captureTarget)
  }

  const assertSegmentFile = async (segment: StoredSegment): Promise<void> => {
    try {
      await stat(segment.path)
    } catch (error) {
      if (getErrorCode(error) === 'ENOENT') {
        throw new Error('Часть буфера встроенной записи уже очищена. Подождите пару секунд, чтобы накопились новые сегменты, и повторите тест.')
      }
      throw error
    }
  }

  const buildSessionFiles = async (neededSegments: StoredSegment[], _replayId: string): Promise<ReplaySessionFile[]> => {
    await Promise.all(neededSegments.map(assertSegmentFile))
    return neededSegments.map((segment) => ({
      path: segment.path,
      startedAtMs: segment.startedAtMs,
      endedAtMs: segment.endedAtMs
    }))
  }

  const browserReplayEncodeArgs = (settings: AppSettings, outputPath: string): string[] => {
    const audioArgs = browserAudioEnabled(settings)
      ? ['-map', '0:a?', '-c:a', 'aac', '-b:a', '160k']
      : ['-an']

    return [
      '-map',
      '0:v:0',
      ...audioArgs,
      ...buildH264VideoArgs({ platform: process.platform, purpose: 'export' }),
      '-r',
      String(settings.recording.frameRate),
      '-fps_mode',
      'cfr',
      '-avoid_negative_ts',
      'make_zero',
      '-movflags',
      '+faststart',
      outputPath
    ]
  }

  const trimBrowserReplayFile = async (
    sessionFiles: ReplaySessionFile[],
    listPath: string,
    replayPath: string,
    settings: AppSettings,
    replayStartMs: number,
    replayEndMs: number,
    signal?: AbortSignal
  ): Promise<void> => {
    const firstSession = sessionFiles[0]
    if (!firstSession) throw new Error('Нет сегментов встроенной записи для сборки клипа')

    const startSeconds = Math.max(0, (replayStartMs - firstSession.startedAtMs) / 1000)
    const durationSeconds = Math.max(0.001, (replayEndMs - replayStartMs) / 1000)

    if (sessionFiles.length === 1) {
      await runFfmpeg([
        '-y',
        '-fflags',
        '+genpts',
        '-ss',
        formatFfmpegSeconds(startSeconds),
        '-t',
        formatFfmpegSeconds(durationSeconds),
        '-i',
        firstSession.path,
        ...browserReplayEncodeArgs(settings, replayPath)
      ], signal)
      return
    }

    const concatList = sessionFiles
      .map((sessionFile) => `file '${escapeConcatPath(sessionFile.path)}'`)
      .join('\n')
    await writeFile(listPath, `${concatList}\n`, 'utf8')
    await runFfmpeg([
      '-y',
      '-fflags',
      '+genpts',
      '-ss',
      formatFfmpegSeconds(startSeconds),
      '-t',
      formatFfmpegSeconds(durationSeconds),
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      ...browserReplayEncodeArgs(settings, replayPath)
    ], signal)
  }

  const concatNativeReplayFile = async (neededSegments: StoredSegment[], listPath: string, replayPath: string, settings: AppSettings, signal?: AbortSignal): Promise<void> => {
    const concatList = neededSegments
      .map((segment) => `file '${escapeConcatPath(segment.path)}'`)
      .join('\n')
    await writeFile(listPath, `${concatList}\n`, 'utf8')

    try {
      await runFfmpeg([
        '-y',
        '-fflags',
        '+genpts',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listPath,
        '-map',
        '0:v:0',
        '-an',
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        '-movflags',
        '+faststart',
        replayPath
      ], signal)
      return
    } catch {
      await runFfmpeg([
        '-y',
        '-fflags',
        '+genpts',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listPath,
        '-map',
        '0:v:0',
        '-an',
        ...buildH264VideoArgs({ platform: process.platform, purpose: 'export' }),
        '-r',
        String(settings.recording.frameRate),
        '-fps_mode',
        'cfr',
        '-avoid_negative_ts',
        'make_zero',
        '-movflags',
        '+faststart',
        replayPath
      ], signal)
    }
  }

  const writeReplayFromSegments = async (
    neededSegments: StoredSegment[],
    replayPath: string,
    settings: AppSettings,
    replayId: string,
    listPath: string,
    replayStartMs: number,
    replayEndMs: number,
    signal?: AbortSignal
  ): Promise<ReplayWriteResult> => {
    const allNativeSegments = neededSegments.every((segment) => segment.backend === 'ffmpeg')
    const allBrowserSegments = neededSegments.every((segment) => segment.backend === 'browser')
    let sessionFiles: ReplaySessionFile[] = []

    if (allNativeSegments) {
      await concatNativeReplayFile(neededSegments, listPath, replayPath, settings, signal)
      return { sessionFiles, readyClip: true }
    }

    if (allBrowserSegments) {
      sessionFiles = await buildSessionFiles(neededSegments, replayId)
      await trimBrowserReplayFile(sessionFiles, listPath, replayPath, settings, replayStartMs, replayEndMs, signal)
      return { sessionFiles, readyClip: true }
    }

    throw new Error('Во время записи переключился backend записи. Дождитесь новой записи после перезапуска рекордера.')
  }

  const exportReplay = async (settings: AppSettings, trade: ClosedTrade, captureTarget?: CaptureTargetRef, signal?: AbortSignal): Promise<ReplayExportResult> => {
    const replayEndMs = trade.exitTimeMs + settings.clip.paddingAfterSeconds * 1000
    const replayStartMs = trade.entryTimeMs - settings.clip.paddingBeforeSeconds * 1000
    const timeoutMs = Math.max(5_000, settings.clip.paddingAfterSeconds * 1000 + settings.recording.segmentSeconds * 2_000 + 2_000)
    const sourceSegments = await waitForSegmentsUntil(settings, replayEndMs, timeoutMs, captureTarget)
    throwIfAborted(signal)
    const firstSourceSegment = sourceSegments[0]
    const lastSourceSegment = sourceSegments.at(-1)
    const bufferedSeconds = firstSourceSegment && lastSourceSegment
      ? (lastSourceSegment.endedAtMs - firstSourceSegment.startedAtMs) / 1000
      : 0
    const requiredSeconds = (replayEndMs - replayStartMs) / 1000
    const availableReplay = selectAvailableReplayWindow(sourceSegments, replayStartMs, replayEndMs)

    if (!availableReplay) {
      throw new Error(`Встроенный рекордер ещё не накопил видео для этой сделки. Накоплено ${formatRoundedSeconds(bufferedSeconds)}, нужно примерно ${formatRoundedSeconds(requiredSeconds)}. Оставьте окно терминала открытым.`)
    }

    const neededSegments = availableReplay.segments
    const exportReplayStartMs = availableReplay.replayStartMs
    const exportReplayEndMs = availableReplay.replayEndMs

    await mkdir(replaysDir, { recursive: true })
    const replayId = randomUUID()
    const listPath = join(replaysDir, `${toFileTimestamp(Date.now())}-${replayId}.txt`)
    const replayPath = join(replaysDir, `${toFileTimestamp(exportReplayEndMs)}-${replayId}.mp4`)
    let sessionFiles: ReplaySessionFile[] = []

    try {
      const writeResult = await writeReplayFromSegments(neededSegments, replayPath, settings, replayId, listPath, exportReplayStartMs, exportReplayEndMs, signal)
      sessionFiles = writeResult.sessionFiles
      const savedAt = new Date(exportReplayEndMs)
      await utimes(replayPath, savedAt, savedAt)
      return {
        replayPath,
        readyClip: writeResult.readyClip
      }
    } finally {
      await rm(listPath, { force: true }).catch(() => undefined)
      await Promise.all(sessionFiles.filter((file) => file.cleanup).map((file) => rm(file.path, { force: true }).catch(() => undefined)))
    }
  }

  const getFreeRecordingRecordedMs = (recording: FreeRecordingState, nowMs = Date.now()): number => {
    return recording.intervals.reduce((sum, interval) => (
      sum + Math.max(0, (interval.endMs ?? nowMs) - interval.startMs)
    ), 0)
  }

  const isFreeRecordingPaused = (recording: FreeRecordingState | undefined): boolean => {
    const lastInterval = recording?.intervals.at(-1)
    return Boolean(recording && lastInterval && lastInterval.endMs !== undefined)
  }

  const buildFreeRecordingStatus = async (settings: AppSettings, message?: string): Promise<FreeRecordingStatus> => {
    await pruneSegments(settings)
    if (!freeRecording) {
      return {
        active: false,
        paused: false,
        startedAtMs: 0,
        currentIntervalStartedAtMs: 0,
        recordedSeconds: 0,
        segmentCount: 0,
        message: message ?? 'Свободная запись не запущена'
      }
    }

    const recording = freeRecording
    const paused = isFreeRecordingPaused(recording)
    const currentInterval = recording.intervals.at(-1)
    const recordedSeconds = Math.round(getFreeRecordingRecordedMs(recording) / 1000)
    const intervalSegments = relevantSegments(settings).filter((segment) => (
      recording.intervals.some((interval) => (
        segment.endedAtMs >= interval.startMs - exportToleranceMs &&
        segment.startedAtMs <= (interval.endMs ?? Date.now()) + exportToleranceMs
      ))
    ))

    return {
      active: true,
      paused,
      startedAtMs: recording.startedAtMs,
      currentIntervalStartedAtMs: paused ? 0 : currentInterval?.startMs ?? 0,
      recordedSeconds,
      segmentCount: intervalSegments.length,
      message: message ?? (paused
        ? `Свободная запись на паузе, записано ${recordedSeconds}с`
        : `Свободная запись идёт, записано ${recordedSeconds}с`)
    }
  }

  const buildFreeRecordingPath = async (settings: AppSettings, startedAtMs: number, endedAtMs: number): Promise<string> => {
    const startDate = new Date(startedAtMs)
    const dayFolder = join(
      settings.clip.outputDir,
      `${startDate.getFullYear()}-${padDatePart(startDate.getMonth() + 1)}-${padDatePart(startDate.getDate())}`
    )
    await mkdir(dayFolder, { recursive: true })

    const title = `Запись стаканов ${formatFilePeriodTimestamp(startedAtMs)} - ${formatFilePeriodTimestamp(endedAtMs)}`
    return join(dayFolder, `${toSafeClipFileBaseName(title)}.mp4`)
  }

  const finishFreeRecording = async (settings: AppSettings): Promise<FreeRecordingFinishResult> => {
    const recording = freeRecording
    if (!recording) throw new Error('Свободная запись не запущена')

    const endedAtMs = Date.now()
    const lastInterval = recording.intervals.at(-1)
    if (lastInterval && lastInterval.endMs === undefined) lastInterval.endMs = endedAtMs

    const intervals = recording.intervals.filter((interval) => (interval.endMs ?? endedAtMs) - interval.startMs > 250)
    const durationSeconds = Math.round(getFreeRecordingRecordedMs({ ...recording, intervals }, endedAtMs) / 1000)
    if (intervals.length === 0 || durationSeconds <= 0) throw new Error('Свободная запись слишком короткая: нет сохранённых сегментов')

    const targetEndMs = Math.max(...intervals.map((interval) => interval.endMs ?? endedAtMs))
    const timeoutMs = Math.max(5_000, settings.recording.segmentSeconds * 2_000 + 2_000)
    const sourceSegments = await waitForSegmentsUntil(settings, targetEndMs, timeoutMs)
    const neededSegments = sourceSegments.filter((segment) => intervals.some((interval) => (
      segment.endedAtMs >= interval.startMs - exportToleranceMs &&
      segment.startedAtMs <= (interval.endMs ?? endedAtMs) + exportToleranceMs
    )))

    if (neededSegments.length === 0) throw new Error('Свободная запись ещё не накопила видео. Подождите пару секунд и попробуйте закончить снова.')

    await mkdir(replaysDir, { recursive: true })
    const replayId = randomUUID()
    const listPath = join(replaysDir, `${toFileTimestamp(Date.now())}-${replayId}.txt`)
    const replayPath = await buildFreeRecordingPath(settings, recording.startedAtMs, endedAtMs)
    let sessionFiles: ReplaySessionFile[] = []

    try {
      await rm(replayPath, { force: true }).catch(() => undefined)
      const writeResult = await writeReplayFromSegments(neededSegments, replayPath, settings, replayId, listPath, recording.startedAtMs, endedAtMs)
      sessionFiles = writeResult.sessionFiles
      const savedAt = new Date(endedAtMs)
      await utimes(replayPath, savedAt, savedAt)
      freeRecording = undefined

      return {
        ok: true,
        videoPath: replayPath,
        fileName: basename(replayPath),
        startedAtMs: recording.startedAtMs,
        endedAtMs,
        durationSeconds
      }
    } finally {
      await rm(listPath, { force: true }).catch(() => undefined)
      await Promise.all(sessionFiles.filter((file) => file.cleanup).map((file) => rm(file.path, { force: true }).catch(() => undefined)))
    }
  }

  const getWindowRecorderStatus = async (settings: AppSettings): Promise<WindowRecorderStatus> => {
    if (settings.recording.mode === 'window' && nativeMissingSource?.settingsKey === nativeSettingsKey(settings)) {
      return buildStatus(settings, {
        backend: 'browser',
        fallbackRequired: true,
        message: nativeMissingSource.message
      })
    }

    return buildStatus(settings)
  }

  return {
    protectSince(timeMs) {
      const parsed = Number(timeMs)
      protectedSinceMs = Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0
    },
    finishFreeRecording,
    getFreeRecordingStatus: buildFreeRecordingStatus,
    async appendSegment(input, settings) {
      if (settings.recording.mode !== 'window') return buildStatus(settings)

      const startedAtMs = sanitizeSegmentTime(input.startedAtMs)
      const endedAtMs = sanitizeSegmentTime(input.endedAtMs)
      const sequence = Number(input.sequence)
      const data = Buffer.from(input.data)
      if (!input.sourceId || !input.sourceName || !startedAtMs || endedAtMs <= startedAtMs || data.length === 0) {
        throw new Error('Некорректный сегмент встроенной записи')
      }

      await mkdir(segmentsDir, { recursive: true })
      const id = randomUUID()
      const sessionId = typeof input.sessionId === 'string' && input.sessionId.trim() ? input.sessionId.trim() : id
      const path = join(segmentsDir, `${toFileTimestamp(startedAtMs)}-${toFileTimestamp(endedAtMs)}__${id}.webm`)
      await writeFile(path, data)
      const fileStat = await stat(path)

      segments.push({
        id,
        backend: 'browser',
        sourceId: input.sourceId,
        sourceName: input.sourceName,
        sessionId,
        sequence: Number.isFinite(sequence) && sequence >= 0 ? Math.trunc(sequence) : 0,
        startedAtMs,
        endedAtMs,
        path,
        sizeBytes: fileStat.size
      })
      clearNativeMissingSource()
      await pruneSegments(settings, endedAtMs)
      return buildStatus(settings)
    },
    getStatus: getWindowRecorderStatus,
    async pauseFreeRecording(settings) {
      if (!freeRecording) return buildFreeRecordingStatus(settings, 'Свободная запись не запущена')

      const lastInterval = freeRecording.intervals.at(-1)
      if (lastInterval && lastInterval.endMs === undefined) lastInterval.endMs = Date.now()
      return buildFreeRecordingStatus(settings)
    },
    start: startNativeRecorder,
    async resumeFreeRecording(settings) {
      if (!freeRecording) return buildFreeRecordingStatus(settings, 'Свободная запись не запущена')
      if (!isFreeRecordingPaused(freeRecording)) return buildFreeRecordingStatus(settings)

      freeRecording.intervals.push({ startMs: Date.now() })
      return buildFreeRecordingStatus(settings)
    },
    async startFreeRecording(settings) {
      if (settings.recording.mode !== 'window') {
        throw new Error('Свободная запись доступна во встроенной записи окна или экрана')
      }
      if (freeRecording) return buildFreeRecordingStatus(settings)

      await startNativeRecorder(settings)
      const startedAtMs = Date.now()
      freeRecording = {
        startedAtMs,
        intervals: [{ startMs: startedAtMs }]
      }
      return buildFreeRecordingStatus(settings, 'Свободная запись началась')
    },
    stop: stopNativeRecorder,
    async saveReplayBuffer({ settings, trade, captureTarget, signal }) {
      const requestedAtMs = Date.now()
      if (settings.recording.mode !== 'window') {
        return {
          ok: false,
          requestedAtMs,
          message: 'Встроенная запись окна выключена'
        }
      }

      const previousProtectedSinceMs = protectedSinceMs
      protectedSinceMs = Math.max(1, Math.min(
        previousProtectedSinceMs > 0 ? previousProtectedSinceMs : Number.MAX_SAFE_INTEGER,
        settings.clip.paddingBeforeSeconds > 0
          ? trade.entryTimeMs - settings.clip.paddingBeforeSeconds * 1000
          : trade.entryTimeMs
      ))

      try {
        const replay = await exportReplay(settings, trade, captureTarget, signal)
        return {
          ok: true,
          requestedAtMs,
          replayPath: replay.replayPath,
          readyClip: replay.readyClip,
          message: `Встроенный replay сохранён: ${basename(replay.replayPath)}`
        }
      } catch (error) {
        return {
          ok: false,
          requestedAtMs,
          message: error instanceof Error ? error.message : 'Не удалось сохранить встроенный replay'
        }
      } finally {
        protectedSinceMs = previousProtectedSinceMs
      }
    }
  }
}
