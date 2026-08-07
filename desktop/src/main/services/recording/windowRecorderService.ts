import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { appendFile, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { AppSettings, CaptureTargetRef } from '../settings/settings'
import { terminalTitleMatchesTicker } from './terminalWindowSelection'
import type { ClosedTrade } from '../trades/simulatedTradePipeline'
import { toSafeClipFileBaseName } from '../video/clipPaths'
import { buildH264VideoArgs, calculateFfmpegRenderThreads } from '../video/ffmpegCommand'
import { createMissingMediaToolError, isMissingMediaToolError, resolveMediaToolPath } from '../video/mediaBinaries'

export type WindowCaptureSource = {
  id: string
  name: string
  displayId: string
  type: AppSettings['recording']['sourceType']
  processId?: number
  bounds?: {
    x: number
    y: number
    width: number
    height: number
  }
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
  processId?: number
  sessionId?: string
  sequence?: number
  startedAtMs: number
  endedAtMs: number
  mimeType: string
  data: ArrayBuffer
}

export type WindowRecordingStartedInput = {
  sourceId: string
  sourceName: string
  processId?: number
  captureEpochId: string
  startedAtMs: number
}

export type WindowRecordingStoppedInput = {
  sourceId: string
  captureEpochId: string
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

type WindowRecorderMetrics = Pick<WindowRecorderStatus, 'segmentCount' | 'bufferedSeconds' | 'lastSegmentAtMs'>

const replayFileCreationGraceMs = 60_000

export const shouldPruneReplayFile = (
  fileStat: { mtimeMs: number, ctimeMs: number, birthtimeMs: number },
  cutoffMs: number,
  nowMs = Date.now()
): boolean => (
  fileStat.mtimeMs < cutoffMs &&
  nowMs - Math.max(fileStat.ctimeMs, fileStat.birthtimeMs) >= replayFileCreationGraceMs
)

export const aggregateWindowRecorderSourceStatuses = (
  sources: NonNullable<WindowRecorderStatus['sources']>,
  fallback: WindowRecorderMetrics
): WindowRecorderMetrics => {
  if (sources.length === 0) return fallback

  return {
    segmentCount: sources.reduce((sum, source) => sum + source.segmentCount, 0),
    bufferedSeconds: Math.min(...sources.map((source) => source.bufferedSeconds)),
    lastSegmentAtMs: Math.max(...sources.map((source) => source.lastSegmentAtMs))
  }
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

export type VideoCacheClearResult = {
  ok: true
  cachePath: string
  legacyCacheRemoved: boolean
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
  clearCache: (settings: AppSettings) => Promise<VideoCacheClearResult>
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
  processId?: number
  sessionId: string
  sequence: number
  startedAtMs: number
  endedAtMs: number
  path: string
  sizeBytes: number
  retainedForSession?: boolean
}

export type ReplaySessionFile = {
  path: string
  startedAtMs: number
  endedAtMs: number
  firstVideoPacketSeconds?: number
  videoDurationSeconds?: number
  maxVideoPacketGapSeconds?: number
  hasAudio?: boolean
  cleanup?: boolean
}

export type BrowserSessionVideoPacketMetadata = {
  firstVideoPacketSeconds: number
  videoDurationSeconds: number
  maxVideoPacketGapSeconds: number
}

export type BrowserSessionMediaMetadata = BrowserSessionVideoPacketMetadata & {
  hasAudio: boolean
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

export type BrowserSessionChunk = {
  backend: WindowRecorderStatus['backend']
  sessionId: string
  sequence: number
}

type ReplayExportResult = {
  replayPath: string
  readyClip: boolean
}

type WindowRecorderServiceInput = {
  appDataDir: string
  isWindowSourceAvailable?: (source: { sourceId: string, sourceName: string }) => Promise<boolean>
  getDisplayBounds?: () => ScreenCaptureBounds[]
  probeBrowserSessionMedia?: (path: string) => Promise<BrowserSessionMediaMetadata>
  runFfmpeg?: (args: string[], signal?: AbortSignal) => Promise<void>
}

type NativeRecorderState = {
  process: ChildProcess
  sessionId: string
  settingsKey: string
  sourceId: string
  sourceName: string
  processId?: number
  startedAtMs: number
  segmentsDir: string
  listPath: string
  outputPattern: string
  stderr: string
  stopping: boolean
}

export type NativeRecorderTarget = {
  sourceId: string
  sourceName: string
  processId?: number
  inputBackend: 'ddagrab'
  inputName: string
  outputIndex?: number
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
export const browserSessionVideoDurationToleranceSeconds = 2
const nativeSegmentFileFreshnessMs = 8_000
const nativeRecorderStartupGraceMs = 900

const browserSegmentStaleAfterMs = (settings: AppSettings): number => (
  Math.max(8_000, settings.recording.segmentSeconds * 2_000 + 5_000)
)

const sleep = (durationMs: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, durationMs))

const sanitizeSegmentTime = (value: unknown): number => {
  const time = Number(value)
  return Number.isFinite(time) && time > 0 ? Math.trunc(time) : 0
}

const sanitizeProcessId = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
)

const toFileTimestamp = (timeMs: number): string => new Date(timeMs).toISOString().replace(/[:.]/g, '-')
const formatRoundedSeconds = (seconds: number): string => `${Math.max(0, Math.ceil(seconds))}с`
const formatFfmpegSeconds = (seconds: number): string => Math.max(0, seconds).toFixed(3)
const padDatePart = (value: number): string => String(value).padStart(2, '0')
const formatFilePeriodTimestamp = (timeMs: number): string => {
  const date = new Date(timeMs)
  return `${padDatePart(date.getDate())}.${padDatePart(date.getMonth() + 1)}.${date.getFullYear()} ${padDatePart(date.getHours())}-${padDatePart(date.getMinutes())}-${padDatePart(date.getSeconds())}`
}

const escapeConcatPath = (path: string): string => path.replace(/\\/g, '/').replace(/'/g, "'\\''")

export const buildReplayConcatManifest = (sessionFiles: ReplaySessionFile[]): string => {
  const lines = ['ffconcat version 1.0']
  for (const sessionFile of sessionFiles) {
    const durationSeconds = (sessionFile.endedAtMs - sessionFile.startedAtMs) / 1000
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error('Сессия встроенной записи имеет некорректную длительность')
    }

    lines.push(`file '${escapeConcatPath(sessionFile.path)}'`)
    lines.push(`duration ${formatFfmpegSeconds(durationSeconds)}`)
  }
  return `${lines.join('\n')}\n`
}

export const shouldConcatBrowserAudio = (
  sessionFiles: Array<Pick<ReplaySessionFile, 'hasAudio'>>,
  requested: boolean
): boolean => (
  requested && sessionFiles.length > 0
)

export type BrowserSessionTimelineSlice = {
  inputIndex: number
  sourceStartSeconds: number
  contentDurationSeconds: number
  gapAfterSeconds: number
  outputDurationSeconds: number
}

export type BrowserSessionTimelinePlan = {
  timelineStartMs: number
  timelineEndMs: number
  durationSeconds: number
  slices: BrowserSessionTimelineSlice[]
}

export const planBrowserSessionTimeline = (
  sessionFiles: Array<Pick<ReplaySessionFile, 'startedAtMs' | 'endedAtMs'>>
): BrowserSessionTimelinePlan => {
  if (sessionFiles.length === 0) throw new Error('Нет browser-сессий для объединения')

  const ordered = sessionFiles.map((sessionFile, inputIndex) => {
    if (
      !Number.isSafeInteger(sessionFile.startedAtMs) ||
      !Number.isSafeInteger(sessionFile.endedAtMs) ||
      sessionFile.endedAtMs <= sessionFile.startedAtMs
    ) {
      throw new Error('Сессия встроенной записи имеет некорректную длительность')
    }
    return { ...sessionFile, inputIndex }
  }).sort((left, right) => (
    left.startedAtMs - right.startedAtMs ||
    right.endedAtMs - left.endedAtMs ||
    left.inputIndex - right.inputIndex
  ))

  const timelineStartMs = ordered[0]!.startedAtMs
  let coveredUntilMs = timelineStartMs
  const slices: Array<{
    inputIndex: number
    sourceStartMs: number
    contentDurationMs: number
    gapAfterMs: number
  }> = []

  for (const sessionFile of ordered) {
    const contributionStartMs = Math.max(sessionFile.startedAtMs, coveredUntilMs)
    if (sessionFile.endedAtMs <= contributionStartMs) continue

    const gapBeforeMs = Math.max(0, sessionFile.startedAtMs - coveredUntilMs)
    if (gapBeforeMs > 0) {
      const previous = slices.at(-1)
      if (!previous) throw new Error('Некорректный gap перед первой browser-сессией')
      previous.gapAfterMs += gapBeforeMs
    }

    slices.push({
      inputIndex: sessionFile.inputIndex,
      sourceStartMs: contributionStartMs - sessionFile.startedAtMs,
      contentDurationMs: sessionFile.endedAtMs - contributionStartMs,
      gapAfterMs: 0
    })
    coveredUntilMs = sessionFile.endedAtMs
  }

  const timelineDurationMs = coveredUntilMs - timelineStartMs
  const plannedDurationMs = slices.reduce((sum, slice) => (
    sum + slice.contentDurationMs + slice.gapAfterMs
  ), 0)
  if (slices.length === 0 || plannedDurationMs !== timelineDurationMs) {
    throw new Error('Не удалось сохранить wall-clock timeline browser-сессий')
  }

  return {
    timelineStartMs,
    timelineEndMs: coveredUntilMs,
    durationSeconds: timelineDurationMs / 1000,
    slices: slices.map((slice) => ({
      inputIndex: slice.inputIndex,
      sourceStartSeconds: slice.sourceStartMs / 1000,
      contentDurationSeconds: slice.contentDurationMs / 1000,
      gapAfterSeconds: slice.gapAfterMs / 1000,
      outputDurationSeconds: (slice.contentDurationMs + slice.gapAfterMs) / 1000
    }))
  }
}

export const parseBrowserSessionVideoPacketMetadata = (value: string): BrowserSessionVideoPacketMetadata | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object' || !('packets' in parsed) || !Array.isArray(parsed.packets)) return undefined

  const packetIntervals: Array<{ startSeconds: number, endSeconds: number }> = []
  for (const packet of parsed.packets) {
    if (!packet || typeof packet !== 'object') continue
    const ptsSeconds = Number('pts_time' in packet ? packet.pts_time : Number.NaN)
    if (!Number.isFinite(ptsSeconds)) continue
    const rawDurationSeconds = Number('duration_time' in packet ? packet.duration_time : 0)
    const durationSeconds = Number.isFinite(rawDurationSeconds) && rawDurationSeconds > 0 ? rawDurationSeconds : 0
    packetIntervals.push({ startSeconds: ptsSeconds, endSeconds: ptsSeconds + durationSeconds })
  }
  packetIntervals.sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds)
  const firstPacket = packetIntervals[0]
  if (!firstPacket) return undefined

  let coveredUntilSeconds = firstPacket.endSeconds
  let maxVideoPacketGapSeconds = 0
  for (const packet of packetIntervals.slice(1)) {
    maxVideoPacketGapSeconds = Math.max(maxVideoPacketGapSeconds, packet.startSeconds - coveredUntilSeconds)
    coveredUntilSeconds = Math.max(coveredUntilSeconds, packet.endSeconds)
  }

  return Number.isFinite(coveredUntilSeconds) && coveredUntilSeconds > 0
    ? {
        firstVideoPacketSeconds: firstPacket.startSeconds,
        videoDurationSeconds: coveredUntilSeconds,
        maxVideoPacketGapSeconds
      }
    : undefined
}

export const assertBrowserSessionVideoCoverage = (
  sessionFiles: Array<Pick<ReplaySessionFile, 'firstVideoPacketSeconds' | 'videoDurationSeconds' | 'maxVideoPacketGapSeconds'>>,
  timeline: BrowserSessionTimelinePlan
): void => {
  for (const slice of timeline.slices) {
    const sessionFile = sessionFiles[slice.inputIndex]
    const firstVideoPacketSeconds = sessionFile?.firstVideoPacketSeconds
    const videoDurationSeconds = sessionFile?.videoDurationSeconds
    const maxVideoPacketGapSeconds = sessionFile?.maxVideoPacketGapSeconds
    const requiredSourceEndSeconds = slice.sourceStartSeconds + slice.contentDurationSeconds
    if (
      !Number.isFinite(firstVideoPacketSeconds) ||
      !Number.isFinite(videoDurationSeconds) ||
      (videoDurationSeconds ?? 0) <= 0 ||
      !Number.isFinite(maxVideoPacketGapSeconds) ||
      (maxVideoPacketGapSeconds ?? 0) < 0
    ) {
      throw new Error('Не удалось определить фактическую длительность видео browser-сессии')
    }
    if (firstVideoPacketSeconds! > browserSessionVideoDurationToleranceSeconds) {
      throw new Error(
        'Встроенный рекордер потерял начало видео browser-сессии: ' +
        `первый кадр появился через ${formatFfmpegSeconds(firstVideoPacketSeconds!)}с`
      )
    }
    if (maxVideoPacketGapSeconds! > browserSessionVideoDurationToleranceSeconds) {
      throw new Error(
        'Встроенный рекордер потерял часть видео внутри browser-сессии: ' +
        `разрыв ${formatFfmpegSeconds(maxVideoPacketGapSeconds!)}с`
      )
    }
    if (requiredSourceEndSeconds - videoDurationSeconds! > browserSessionVideoDurationToleranceSeconds) {
      throw new Error(
        'Встроенный рекордер потерял часть видео browser-сессии: ' +
        `доступно ${formatFfmpegSeconds(videoDurationSeconds!)}с, нужно ${formatFfmpegSeconds(requiredSourceEndSeconds)}с`
      )
    }
  }
}

export type BrowserSessionConcatFilterInput = {
  sessionFiles: ReplaySessionFile[]
  startSeconds: number
  durationSeconds: number
  hasAudio: boolean
}

export const buildBrowserSessionConcatFilter = ({
  sessionFiles,
  startSeconds,
  durationSeconds,
  hasAudio
}: BrowserSessionConcatFilterInput): string => {
  if (sessionFiles.length < 2) {
    throw new Error('Для объединения browser-сессий нужны минимум две записи')
  }
  if (!Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Некорректный интервал объединения browser-сессий')
  }

  const timeline = planBrowserSessionTimeline(sessionFiles)
  assertBrowserSessionVideoCoverage(sessionFiles, timeline)
  const filters: string[] = []
  const concatInputs: string[] = []
  for (const [sliceIndex, slice] of timeline.slices.entries()) {
    const sourceEndSeconds = slice.sourceStartSeconds + slice.contentDurationSeconds
    const gapPadding = slice.gapAfterSeconds > 0
      ? `tpad=stop_mode=clone:stop_duration=${formatFfmpegSeconds(slice.gapAfterSeconds)},`
      : ''
    filters.push(
      `[${slice.inputIndex}:v:0]setpts=PTS-STARTPTS,` +
      `tpad=stop_mode=clone:stop_duration=${formatFfmpegSeconds(browserSessionVideoDurationToleranceSeconds)},` +
      `trim=start=${formatFfmpegSeconds(slice.sourceStartSeconds)}:duration=${formatFfmpegSeconds(slice.contentDurationSeconds)},` +
      'setpts=PTS-STARTPTS,' +
      gapPadding +
      `trim=duration=${formatFfmpegSeconds(slice.outputDurationSeconds)},setpts=PTS-STARTPTS[v${sliceIndex}]`
    )
    concatInputs.push(`[v${sliceIndex}]`)
    if (hasAudio) {
      if (sessionFiles[slice.inputIndex]?.hasAudio === true) {
        filters.push(
          `[${slice.inputIndex}:a:0]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS,` +
          `apad=pad_dur=${formatFfmpegSeconds(sourceEndSeconds)},` +
          `atrim=start=${formatFfmpegSeconds(slice.sourceStartSeconds)}:duration=${formatFfmpegSeconds(slice.contentDurationSeconds)},` +
          'asetpts=PTS-STARTPTS,' +
          `apad=pad_dur=${formatFfmpegSeconds(slice.outputDurationSeconds)},` +
          `atrim=duration=${formatFfmpegSeconds(slice.outputDurationSeconds)},asetpts=PTS-STARTPTS[a${sliceIndex}]`
        )
      } else {
        filters.push(
          'anullsrc=r=48000:cl=stereo,' +
          `atrim=duration=${formatFfmpegSeconds(slice.outputDurationSeconds)},` +
          `asetpts=PTS-STARTPTS[a${sliceIndex}]`
        )
      }
      concatInputs.push(`[a${sliceIndex}]`)
    }
  }

  filters.push(`${concatInputs.join('')}concat=n=${timeline.slices.length}:v=1:a=${hasAudio ? 1 : 0}[vcat]${hasAudio ? '[acat]' : ''}`)
  filters.push(`[vcat]trim=start=${formatFfmpegSeconds(startSeconds)}:duration=${formatFfmpegSeconds(durationSeconds)},setpts=PTS-STARTPTS[vout]`)
  if (hasAudio) {
    filters.push(`[acat]atrim=start=${formatFfmpegSeconds(startSeconds)}:duration=${formatFfmpegSeconds(durationSeconds)},asetpts=PTS-STARTPTS[aout]`)
  }
  return filters.join(';')
}
const isNativeRecordingSupported = (): boolean => process.platform === 'win32'
const normalizeFfmpegLog = (value: string): string => value.replace(/\s+/g, ' ').trim().slice(-800)
const isMissingNativeWindowError = (value: string): boolean => /Can't find window|Error opening input file title=/i.test(value)
const formatFrameRate = (value: number): string => {
  const frameRate = Math.max(10, Math.min(60, Number.isFinite(value) ? value : 10))
  return frameRate.toFixed(3).replace(/\.?0+$/, '')
}
const nativeRecordingFrameRate = (settings: AppSettings): string => formatFrameRate(settings.recording.frameRate)

const nativeRecordingVideoFilter = (settings: AppSettings): string[] => {
  if (settings.recording.resolutionPreset === 'native') return []
  if (settings.recording.resolutionPreset === '1080p') {
    return ['-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos']
  }

  return ['-vf', 'scale=2560:1440:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos']
}

const buildNativeRecorderInputArgs = (frameRate: string, target: NativeRecorderTarget): string[] => [
  '-f',
  'lavfi',
  '-i',
  `ddagrab=output_idx=${target.outputIndex ?? 0}:framerate=${frameRate}:draw_mouse=0,hwdownload,format=bgra`
]

export const buildNativeRecorderArgs = (
  settings: AppSettings,
  outputPattern: string,
  listPath: string,
  target: NativeRecorderTarget,
  platform: NodeJS.Platform = process.platform
): string[] => {
  const frameRate = nativeRecordingFrameRate(settings)
  const segmentSeconds = String(Math.max(1, Math.trunc(settings.recording.segmentSeconds)))
  const segmentFrameCount = String(Math.max(1, Math.trunc(Number(frameRate) * Number(segmentSeconds))))

  return [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-nostdin',
    '-filter_threads',
    '1',
    ...buildNativeRecorderInputArgs(frameRate, target),
    '-map',
    '0:v:0',
    '-an',
    ...nativeRecordingVideoFilter(settings),
    '-threads',
    '1',
    ...buildH264VideoArgs({
      platform,
      purpose: 'recording',
      encoder: settings.recording.videoEncoder,
      quality: settings.recording.resolutionPreset === 'native' ? 'native' : 'standard'
    }),
    '-r',
    frameRate,
    '-fps_mode',
    'cfr',
    '-g',
    segmentFrameCount,
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
const browserAudioEnabled = (settings: AppSettings): boolean => settings.recording.systemAudioEnabled || settings.recording.microphoneEnabled
const getErrorCode = (error: unknown): string => (
  typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
)

export const selectAvailableReplayWindow = <T extends ReplayWindowSegment>(
  sourceSegments: T[],
  replayStartMs: number,
  replayEndMs: number
): AvailableReplayWindow<T> | undefined => {
  const overlapping = sourceSegments.filter((segment) => (
    segment.endedAtMs >= replayStartMs - exportToleranceMs &&
    segment.startedAtMs <= replayEndMs + exportToleranceMs
  )).sort((a, b) => a.startedAtMs - b.startedAtMs)
  const selected: T[] = []
  let coveredUntilMs = Number.NEGATIVE_INFINITY
  for (const segment of overlapping) {
    if (segment.endedAtMs <= coveredUntilMs + exportToleranceMs) continue
    if (selected.length > 0 && segment.startedAtMs > coveredUntilMs + exportToleranceMs) return undefined
    selected.push(segment)
    coveredUntilMs = segment.endedAtMs
  }

  const first = selected[0]
  const last = selected.at(-1)
  if (!first || !last || first.startedAtMs > replayStartMs || last.endedAtMs < replayEndMs) return undefined

  return {
    segments: selected,
    replayStartMs,
    replayEndMs
  }
}

export const selectBrowserSessionPrefix = <T extends BrowserSessionChunk>(
  sourceSegments: T[],
  sessionId: string,
  lastSequence: number
): T[] | undefined => {
  if (!Number.isInteger(lastSequence) || lastSequence < 0) return undefined

  const prefix = sourceSegments
    .filter((segment) => segment.backend === 'browser' && segment.sessionId === sessionId && segment.sequence <= lastSequence)
    .sort((left, right) => left.sequence - right.sequence)
  if (prefix.length !== lastSequence + 1) return undefined
  if (prefix.some((segment, index) => segment.sequence !== index)) return undefined
  return prefix
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
    let aborted = false
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => {
      aborted = true
      child.kill('SIGTERM')
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      settle(() => reject(aborted
        ? createAbortError()
        : isMissingMediaToolError(error) ? createMissingMediaToolError('ffmpeg') : error))
    })
    child.on('exit', (code) => {
      if (aborted) {
        settle(() => reject(createAbortError()))
        return
      }
      if (code === 0) {
        settle(resolve)
        return
      }

      settle(() => reject(new Error(`ffmpeg exited with code ${code ?? 'unknown'}: ${stderr.trim()}`)))
    })
  })
}

const probeBrowserSessionHasAudio = async (path: string): Promise<boolean> => (
  new Promise<boolean>((resolveProbe) => {
    let settled = false
    const settle = (hasAudio: boolean) => {
      if (settled) return
      settled = true
      resolveProbe(hasAudio)
    }

    try {
      const child = spawn(resolveMediaToolPath('ffprobe'), [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=codec_type',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        path
      ], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
      let stdout = ''
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
      })
      child.once('error', () => settle(false))
      child.once('close', (code) => settle(code === 0 && stdout.trim().split(/\s+/).includes('audio')))
    } catch {
      settle(false)
    }
  })
)

const probeBrowserSessionVideoPackets = async (path: string): Promise<BrowserSessionVideoPacketMetadata> => (
  new Promise<BrowserSessionVideoPacketMetadata>((resolveProbe, rejectProbe) => {
    let settled = false
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      callback()
    }

    try {
      const child = spawn(resolveMediaToolPath('ffprobe'), [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'packet=pts_time,duration_time',
        '-of',
        'json',
        path
      ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
      })
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
      })
      child.once('error', (error) => settle(() => rejectProbe(
        isMissingMediaToolError(error) ? createMissingMediaToolError('ffprobe') : error
      )))
      child.once('close', (code) => settle(() => {
        if (code !== 0) {
          rejectProbe(new Error(`ffprobe exited with code ${code ?? 'unknown'}: ${normalizeFfmpegLog(stderr)}`))
          return
        }
        const videoPacketMetadata = parseBrowserSessionVideoPacketMetadata(stdout)
        if (videoPacketMetadata === undefined) {
          rejectProbe(new Error('ffprobe не смог определить фактическую длительность видео browser-сессии'))
          return
        }
        resolveProbe(videoPacketMetadata)
      }))
    } catch (error) {
      settle(() => rejectProbe(
        isMissingMediaToolError(error) ? createMissingMediaToolError('ffprobe') : error
      ))
    }
  })
)

const probeBrowserSessionMedia = async (path: string): Promise<BrowserSessionMediaMetadata> => {
  const [hasAudio, videoPacketMetadata] = await Promise.all([
    probeBrowserSessionHasAudio(path),
    probeBrowserSessionVideoPackets(path)
  ])
  return { hasAudio, ...videoPacketMetadata }
}

export const createWindowRecorderService = ({
  appDataDir,
  isWindowSourceAvailable,
  getDisplayBounds,
  probeBrowserSessionMedia: inspectBrowserSessionMedia = probeBrowserSessionMedia,
  runFfmpeg: executeFfmpeg = runFfmpeg
}: WindowRecorderServiceInput): WindowRecorderService => {
  const legacyCacheRoot = resolve(join(appDataDir, 'window-recording'))
  const segments: StoredSegment[] = []
  const pendingSegmentPaths = new Set<string>()
  const activeSegmentReadCounts = new Map<string, number>()
  let protectedSinceMs = 0
  const replayProtectionTimes = new Map<string, number>()
  let freeRecording: FreeRecordingState | undefined
  let freeRecordingExportProtectedSinceMs = 0
  let nativeRecorders: NativeRecorderState[] = []
  let nativeLastError = ''
  let nativeMissingSource: { settingsKey: string, message: string } | undefined

  const cachePaths = (settings: AppSettings) => {
    const root = resolve(join(settings.clip.outputDir, '.tradetools-cache'))
    return {
      root,
      segmentsDir: join(root, 'segments'),
      replaysDir: join(root, 'replays')
    }
  }

  const protectSegmentReads = (paths: string[]): (() => void) => {
    for (const path of paths) activeSegmentReadCounts.set(path, (activeSegmentReadCounts.get(path) ?? 0) + 1)
    return () => {
      for (const path of paths) {
        const nextCount = (activeSegmentReadCounts.get(path) ?? 1) - 1
        if (nextCount <= 0) activeSegmentReadCounts.delete(path)
        else activeSegmentReadCounts.set(path, nextCount)
      }
    }
  }

  const isPathInside = (parentPath: string, childPath: string): boolean => {
    const childRelativePath = relative(parentPath, childPath)
    return Boolean(childRelativePath) && !childRelativePath.startsWith('..') && !isAbsolute(childRelativePath)
  }

  const canRemoveLegacyCache = (settings: AppSettings): boolean => {
    const outputRoot = resolve(settings.clip.outputDir)
    return outputRoot !== legacyCacheRoot && !isPathInside(legacyCacheRoot, outputRoot)
  }

  const nativeSettingsKey = (settings: AppSettings, target?: NativeRecorderTarget): string => [
    cachePaths(settings).root,
    settings.recording.sourceType,
    settings.recording.windowSourceId,
    settings.recording.windowSourceName,
    settings.recording.videoEncoder,
    settings.recording.resolutionPreset,
    settings.recording.frameRate,
    settings.recording.segmentSeconds,
    String(settings.recording.systemAudioEnabled),
    String(settings.recording.microphoneEnabled),
    target?.sourceId ?? '',
    target?.sourceName ?? '',
    String(target?.processId ?? ''),
    target?.inputBackend ?? '',
    String(target?.outputIndex ?? ''),
    target?.bounds ? `${target.bounds.x}:${target.bounds.y}:${target.bounds.width}:${target.bounds.height}` : ''
  ].join('|')

  const screenOutputIndex = (sourceId: string): number | undefined => {
    const match = /^screen:(\d+):/.exec(sourceId)
    if (!match) return undefined

    const index = Number(match[1])
    return Number.isInteger(index) && index >= 0 && index < 64 ? index : undefined
  }

  const nativeScreenTargets = (settings: AppSettings): NativeRecorderTarget[] => {
    const displays = new Map((getDisplayBounds?.() ?? []).map((display) => [display.displayId, display]))
    return settings.recording.captureTargets
      .filter((target) => target.type === 'screen' && target.id.startsWith('screen:') && target.displayId)
      .flatMap((target, index) => {
        const bounds = displays.get(target.displayId ?? '')
        return bounds
          ? [{
              sourceId: target.id,
              sourceName: target.name,
              processId: target.processId,
              inputBackend: 'ddagrab' as const,
              inputName: 'ddagrab',
              outputIndex: screenOutputIndex(target.id) ?? index,
              bounds
            }]
          : []
      })
  }

  const expectedNativeRecorderSettingsKeys = (settings: AppSettings): string[] => (
    settings.recording.mode === 'window' && settings.recording.sourceType === 'screen'
      ? nativeScreenTargets(settings).map((target) => nativeSettingsKey(settings, target))
      : []
  )

  const activeNativeRecorderSettingsKeys = (): Set<string> => new Set(
    nativeRecorders
      .filter((recorder) => recorder.process.exitCode === null)
      .map((recorder) => recorder.settingsKey)
  )

  const hasPartialNativeScreenRecorderSet = (settings: AppSettings): boolean => {
    const expectedKeys = expectedNativeRecorderSettingsKeys(settings)
    if (expectedKeys.length <= 1 || nativeRecorders.length === 0) return false

    const activeKeys = activeNativeRecorderSettingsKeys()
    return expectedKeys.some((key) => !activeKeys.has(key))
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

        const segmentPath = isAbsolute(rawPath) ? rawPath : join(current.segmentsDir, rawPath)
        const fileStat = await stat(segmentPath).catch(() => undefined)
        if (!fileStat?.isFile() || fileStat.size <= 0) continue

        const id = `${current.sessionId}-${index}`
        if (knownIds.has(id)) continue

        segments.push({
          id,
          backend: 'ffmpeg',
          sourceId: current.sourceId,
          sourceName: current.sourceName,
          processId: current.processId,
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
    const { segmentsDir } = cachePaths(settings)
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
        processId: target.processId,
        startedAtMs: processStartedAtMs,
        segmentsDir,
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

    await stopNativeRecorder()
    return buildStatus(settings, {
      backend: 'browser',
      fallbackRequired: true,
      message: 'Окна терминалов пишутся через Chromium без захвата курсора. Качество сохраняется в разрешении выбранного пресета.'
    })
  }

  const pruneDiskFiles = async (segmentsDir: string, keepPaths: Set<string>) => {
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
        if (fileStat && Date.now() - fileStat.mtimeMs < nativeSegmentFileFreshnessMs) return
      }

      await rm(filePath, { force: true }).catch(() => undefined)
    }))
  }

  const pruneReplayFiles = async (replaysDir: string, cutoffMs: number) => {
    const entries = await readdir(replaysDir, { withFileTypes: true }).catch(() => [])
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile() || !['.mp4', '.txt'].includes(extname(entry.name).toLowerCase())) return

      const filePath = join(replaysDir, entry.name)
      const fileStat = await stat(filePath).catch(() => undefined)
      if (!fileStat || !shouldPruneReplayFile(fileStat, cutoffMs)) return
      await rm(filePath, { force: true }).catch(() => undefined)
    }))
  }

  const pruneSegments = async (settings: AppSettings, nowMs = Date.now()) => {
    const { segmentsDir, replaysDir } = cachePaths(settings)
    await scanNativeSegments()
    const maxAgeMs = (settings.clip.replayBufferSeconds + settings.clip.paddingBeforeSeconds + settings.clip.paddingAfterSeconds + 30) * 1000
    const replayCutoffMs = nowMs - maxAgeMs
    const protectedCutoffs = [
      protectedSinceMs,
      ...replayProtectionTimes.values(),
      freeRecording?.startedAtMs ?? 0,
      freeRecordingExportProtectedSinceMs
    ].filter((value) => value > 0)
    const protectedCutoffMs = protectedCutoffs.length > 0 ? Math.min(...protectedCutoffs) : 0
    const cutoffMs = protectedCutoffMs > 0 ? Math.min(replayCutoffMs, protectedCutoffMs) : replayCutoffMs
    const activeBrowserSessionIds = new Set(segments
      .filter((segment) => segment.backend === 'browser' && !segment.retainedForSession && segment.endedAtMs >= cutoffMs)
      .map((segment) => segment.sessionId))
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index]
      if (!segment || segment.endedAtMs >= cutoffMs) continue
      if (activeSegmentReadCounts.has(segment.path)) continue
      if (segment.backend === 'browser' && activeBrowserSessionIds.has(segment.sessionId)) {
        segment.retainedForSession = true
        continue
      }

      segments.splice(index, 1)
      await rm(segment.path, { force: true }).catch(() => undefined)
    }

    const keepPaths = new Set([...segments.map((segment) => segment.path), ...pendingSegmentPaths, ...activeSegmentReadCounts.keys()])
    await pruneDiskFiles(segmentsDir, keepPaths)
    await pruneReplayFiles(replaysDir, replayCutoffMs)
  }

  const targetMatchesSegment = (segment: StoredSegment, captureTarget: CaptureTargetRef): boolean => {
    if (segment.sourceId === captureTarget.id) return true
    if (Boolean(captureTarget.name) && segment.sourceName === captureTarget.name) return true

    const segmentProcessId = sanitizeProcessId(segment.processId)
    const targetProcessId = sanitizeProcessId(captureTarget.processId)
    return Boolean(
      captureTarget.symbol &&
      segmentProcessId !== undefined &&
      segmentProcessId === targetProcessId &&
      terminalTitleMatchesTicker(segment.sourceName, captureTarget.symbol)
    )
  }

  const relevantSegments = (settings: AppSettings, captureTarget?: CaptureTargetRef): StoredSegment[] => {
    const sourceId = settings.recording.windowSourceId
    const sourceName = settings.recording.windowSourceName
    const configuredTargets = settings.recording.captureTargets
    const matchesConfiguredTarget = (segment: StoredSegment): boolean => {
      if (captureTarget) return targetMatchesSegment(segment, captureTarget)
      if (settings.recording.sourceType === 'window' && (sourceId || sourceName)) {
        return segment.sourceId === sourceId || segment.sourceName === sourceName
      }
      if (configuredTargets.length > 0) return configuredTargets.some((target) => targetMatchesSegment(segment, target))
      return true
    }

    return segments
      .filter((segment) => !segment.retainedForSession && matchesConfiguredTarget(segment))
      .sort((a, b) => a.startedAtMs - b.startedAtMs)
  }

  const statusCaptureTargets = (settings: AppSettings): CaptureTargetRef[] => {
    const { windowSourceId, windowSourceName, sourceType, captureTargets } = settings.recording
    if (sourceType !== 'window' || (!windowSourceId && !windowSourceName)) return captureTargets

    const selectedTarget = captureTargets.find((target) => (
      target.type === 'window' && (
        Boolean(windowSourceId) && target.id === windowSourceId ||
        Boolean(windowSourceName) && target.name === windowSourceName
      )
    ))
    return [selectedTarget ?? {
      id: windowSourceId,
      name: windowSourceName || windowSourceId || 'Выбранное окно',
      type: 'window'
    }]
  }

  const buildSourceStatuses = (settings: AppSettings) => statusCaptureTargets(settings).map((target) => {
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
    const sourceStatuses = buildSourceStatuses(settings)
    const metrics = aggregateWindowRecorderSourceStatuses(sourceStatuses, {
      segmentCount: sourceSegments.length,
      bufferedSeconds: Math.min(settings.clip.replayBufferSeconds, rawBufferedSeconds),
      lastSegmentAtMs: last?.endedAtMs ?? 0
    })
    const bufferedSeconds = metrics.bufferedSeconds
    const hasNativeRecorder = nativeRecorders.length > 0
    const active = Boolean(hasNativeRecorder && override.backend !== 'browser') || Boolean(last && Date.now() - last.endedAtMs < browserSegmentStaleAfterMs(settings))
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
      segmentCount: metrics.segmentCount,
      bufferedSeconds,
      lastSegmentAtMs: metrics.lastSegmentAtMs,
      message: override.message ?? defaultMessage,
      sources: sourceStatuses
    }
  }

  const waitForSegmentsUntil = async (settings: AppSettings, targetEndMs: number, timeoutMs: number, captureTarget?: CaptureTargetRef): Promise<StoredSegment[]> => {
    const deadlineMs = Date.now() + timeoutMs
    while (Date.now() <= deadlineMs) {
      await pruneSegments(settings)
      const sourceSegments = relevantSegments(settings, captureTarget)
      if (sourceSegments.some((segment) => segment.endedAtMs >= targetEndMs)) {
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

  const buildBrowserSessionFile = async (
    sessionId: string,
    lastSequence: number,
    replayId: string,
    fileIndex: number,
    replaysDir: string
  ): Promise<ReplaySessionFile> => {
    const sessionSegments = selectBrowserSessionPrefix(segments, sessionId, lastSequence)
    if (!sessionSegments) {
      throw new Error('Часть непрерывной сессии встроенной записи уже недоступна. Дождитесь накопления нового буфера и повторите сохранение.')
    }

    const firstSegment = sessionSegments[0]
    const lastSegment = sessionSegments.at(-1)
    if (!firstSegment || !lastSegment) throw new Error('Нет частей непрерывной сессии встроенной записи для сборки клипа')
    const sessionPath = join(replaysDir, `${toFileTimestamp(lastSegment.endedAtMs)}-${replayId}-${fileIndex}.webm`)
    const releaseSegmentReads = protectSegmentReads(sessionSegments.map((segment) => segment.path))
    try {
      await Promise.all(sessionSegments.map(assertSegmentFile))
      await writeFile(sessionPath, await readFile(firstSegment.path))
      for (const segment of sessionSegments.slice(1)) await appendFile(sessionPath, await readFile(segment.path))
    } catch (error) {
      await rm(sessionPath, { force: true }).catch(() => undefined)
      throw error
    } finally {
      releaseSegmentReads()
    }

    let mediaMetadata: BrowserSessionMediaMetadata
    try {
      mediaMetadata = await inspectBrowserSessionMedia(sessionPath)
    } catch (error) {
      await rm(sessionPath, { force: true }).catch(() => undefined)
      throw error
    }

    return {
      path: sessionPath,
      startedAtMs: firstSegment.startedAtMs,
      endedAtMs: lastSegment.endedAtMs,
      firstVideoPacketSeconds: mediaMetadata.firstVideoPacketSeconds,
      videoDurationSeconds: mediaMetadata.videoDurationSeconds,
      maxVideoPacketGapSeconds: mediaMetadata.maxVideoPacketGapSeconds,
      hasAudio: mediaMetadata.hasAudio,
      cleanup: true
    }
  }

  const buildSessionFiles = async (neededSegments: StoredSegment[], replayId: string, replaysDir: string): Promise<ReplaySessionFile[]> => {
    await Promise.all(neededSegments.map(assertSegmentFile))
    if (neededSegments.every((segment) => segment.backend !== 'browser')) {
      return neededSegments.map((segment) => ({
        path: segment.path,
        startedAtMs: segment.startedAtMs,
        endedAtMs: segment.endedAtMs
      }))
    }

    const lastNeededSequenceBySession = new Map<string, number>()
    const firstNeededAtBySession = new Map<string, number>()
    for (const segment of neededSegments) {
      lastNeededSequenceBySession.set(segment.sessionId, Math.max(lastNeededSequenceBySession.get(segment.sessionId) ?? -1, segment.sequence))
      firstNeededAtBySession.set(segment.sessionId, Math.min(firstNeededAtBySession.get(segment.sessionId) ?? segment.startedAtMs, segment.startedAtMs))
    }

    const sessionIds = [...lastNeededSequenceBySession.keys()].sort((left, right) => (
      (firstNeededAtBySession.get(left) ?? 0) - (firstNeededAtBySession.get(right) ?? 0)
    ))
    const sessionFiles: ReplaySessionFile[] = []
    try {
      for (const sessionId of sessionIds) {
        sessionFiles.push(await buildBrowserSessionFile(
          sessionId,
          lastNeededSequenceBySession.get(sessionId) ?? -1,
          replayId,
          sessionFiles.length,
          replaysDir
        ))
      }
      return sessionFiles
    } catch (error) {
      await Promise.all(sessionFiles.map((file) => rm(file.path, { force: true }).catch(() => undefined)))
      throw error
    }
  }

  const replayEncodeArgs = (
    settings: AppSettings,
    outputPath: string,
    maps?: { video: string, audio?: string }
  ): string[] => {
    const resolvedMaps = maps ?? {
      video: '0:v:0',
      ...(browserAudioEnabled(settings) ? { audio: '0:a?' } : {})
    }
    const audioArgs = resolvedMaps.audio
      ? ['-map', resolvedMaps.audio, '-c:a', 'aac', '-b:a', '160k']
      : ['-an']
    const renderThreads = String(calculateFfmpegRenderThreads())

    return [
      '-map',
      resolvedMaps.video,
      ...audioArgs,
      ...buildH264VideoArgs({
        platform: process.platform,
        purpose: 'export',
        encoder: settings.recording.videoEncoder,
        quality: settings.recording.resolutionPreset === 'native' ? 'native' : 'standard'
      }),
      '-threads',
      renderThreads,
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

  const trimReplayFile = async (
    sessionFiles: ReplaySessionFile[],
    listPath: string,
    replayPath: string,
    settings: AppSettings,
    backend: StoredSegment['backend'],
    replayStartMs: number,
    replayEndMs: number,
    signal?: AbortSignal
  ): Promise<void> => {
    const firstSession = sessionFiles[0]
    if (!firstSession) throw new Error('Нет сегментов встроенной записи для сборки клипа')

    const startSeconds = Math.max(0, (replayStartMs - firstSession.startedAtMs) / 1000)
    const durationSeconds = Math.max(0.001, (replayEndMs - replayStartMs) / 1000)
    const renderThreads = String(calculateFfmpegRenderThreads())
    if (backend === 'browser') {
      assertBrowserSessionVideoCoverage(sessionFiles, planBrowserSessionTimeline(sessionFiles))
    }

    if (sessionFiles.length === 1) {
      await executeFfmpeg([
        '-y',
        '-threads',
        renderThreads,
        '-filter_threads',
        '1',
        '-fflags',
        '+genpts',
        '-ss',
        formatFfmpegSeconds(startSeconds),
        '-t',
        formatFfmpegSeconds(durationSeconds),
        '-i',
        firstSession.path,
        ...replayEncodeArgs(settings, replayPath)
      ], signal)
      return
    }

    if (backend === 'browser') {
      const hasAudio = shouldConcatBrowserAudio(sessionFiles, browserAudioEnabled(settings))
      const concatFilter = buildBrowserSessionConcatFilter({
        sessionFiles,
        startSeconds,
        durationSeconds,
        hasAudio
      })
      await executeFfmpeg([
        '-y',
        '-threads',
        renderThreads,
        '-filter_threads',
        '1',
        '-filter_complex_threads',
        '1',
        '-fflags',
        '+genpts',
        ...sessionFiles.flatMap((sessionFile) => ['-i', sessionFile.path]),
        '-filter_complex',
        concatFilter,
        ...replayEncodeArgs(settings, replayPath, {
          video: '[vout]',
          ...(hasAudio ? { audio: '[aout]' } : {})
        })
      ], signal)
      return
    }

    await writeFile(listPath, buildReplayConcatManifest(sessionFiles), 'utf8')
    await executeFfmpeg([
      '-y',
      '-threads',
      renderThreads,
      '-filter_threads',
      '1',
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
      ...replayEncodeArgs(settings, replayPath)
    ], signal)
  }

  const replayBackendForSegments = (neededSegments: StoredSegment[]): StoredSegment['backend'] => {
    const backend = neededSegments[0]?.backend
    if (!backend || !neededSegments.every((segment) => segment.backend === backend)) {
      throw new Error('Во время записи переключился backend записи. Дождитесь новой записи после перезапуска рекордера.')
    }
    return backend
  }

  const exportReplay = async (settings: AppSettings, trade: ClosedTrade, captureTarget?: CaptureTargetRef, signal?: AbortSignal): Promise<ReplayExportResult> => {
    const { replaysDir } = cachePaths(settings)
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
      const missingBeginningSeconds = firstSourceSegment
        ? Math.max(0, (firstSourceSegment.startedAtMs - replayStartMs) / 1000)
        : 0
      if (missingBeginningSeconds > 0) {
        throw new Error(`Встроенный рекордер не сохранил весь клип: отсутствует ${formatRoundedSeconds(missingBeginningSeconds)} в начале, поэтому начало сделки или отступ до входа не записаны. Оставьте окно терминала открытым.`)
      }
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
      const backend = replayBackendForSegments(neededSegments)
      sessionFiles = await buildSessionFiles(neededSegments, replayId, replaysDir)
      await trimReplayFile(sessionFiles, listPath, replayPath, settings, backend, exportReplayStartMs, exportReplayEndMs, signal)
      const savedAt = new Date(exportReplayEndMs)
      await utimes(replayPath, savedAt, savedAt)
      return {
        replayPath,
        readyClip: true
      }
    } catch (error) {
      await rm(replayPath, { force: true }).catch(() => undefined)
      throw error
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
    const { replaysDir } = cachePaths(settings)
    const recording = freeRecording
    if (!recording) throw new Error('Свободная запись не запущена')

    const endedAtMs = Date.now()
    const endedIntervals = recording.intervals.map((interval, index) => (
      index === recording.intervals.length - 1 && interval.endMs === undefined
        ? { ...interval, endMs: endedAtMs }
        : { ...interval }
    ))
    const intervals = endedIntervals.filter((interval) => (interval.endMs ?? endedAtMs) - interval.startMs > 250)
    const finishedRecording = { startedAtMs: recording.startedAtMs, intervals }
    const durationSeconds = Math.round(getFreeRecordingRecordedMs(finishedRecording, endedAtMs) / 1000)
    if (intervals.length === 0 || durationSeconds <= 0) throw new Error('Свободная запись слишком короткая: нет сохранённых сегментов')

    const targetEndMs = Math.max(...intervals.map((interval) => interval.endMs ?? endedAtMs))
    const timeoutMs = Math.max(5_000, settings.recording.segmentSeconds * 2_000 + 2_000)
    let listPath = ''
    let replayPath = ''
    let sessionFiles: ReplaySessionFile[] = []

    freeRecording = undefined
    freeRecordingExportProtectedSinceMs = finishedRecording.startedAtMs

    try {
      const sourceSegments = await waitForSegmentsUntil(settings, targetEndMs, timeoutMs)
      const neededSegments = sourceSegments.filter((segment) => intervals.some((interval) => (
        segment.endedAtMs >= interval.startMs - exportToleranceMs &&
        segment.startedAtMs <= (interval.endMs ?? endedAtMs) + exportToleranceMs
      )))

      if (neededSegments.length === 0) throw new Error('Свободная запись ещё не накопила видео. Подождите пару секунд и попробуйте закончить снова.')

      await mkdir(replaysDir, { recursive: true })
      const replayId = randomUUID()
      listPath = join(replaysDir, `${toFileTimestamp(Date.now())}-${replayId}.txt`)
      replayPath = await buildFreeRecordingPath(settings, finishedRecording.startedAtMs, endedAtMs)
      await rm(replayPath, { force: true }).catch(() => undefined)
      const backend = replayBackendForSegments(neededSegments)
      sessionFiles = await buildSessionFiles(neededSegments, replayId, replaysDir)
      await trimReplayFile(sessionFiles, listPath, replayPath, settings, backend, finishedRecording.startedAtMs, endedAtMs)
      const savedAt = new Date(endedAtMs)
      await utimes(replayPath, savedAt, savedAt)

      return {
        ok: true,
        videoPath: replayPath,
        fileName: basename(replayPath),
        startedAtMs: finishedRecording.startedAtMs,
        endedAtMs,
        durationSeconds
      }
    } catch (error) {
      if (replayPath) await rm(replayPath, { force: true }).catch(() => undefined)
      throw error
    } finally {
      freeRecordingExportProtectedSinceMs = 0
      if (listPath) await rm(listPath, { force: true }).catch(() => undefined)
      await Promise.all(sessionFiles.filter((file) => file.cleanup).map((file) => rm(file.path, { force: true }).catch(() => undefined)))
    }
  }

  const clearCache = async (settings: AppSettings): Promise<VideoCacheClearResult> => {
    if (protectedSinceMs > 0 || replayProtectionTimes.size > 0 || freeRecording || freeRecordingExportProtectedSinceMs > 0) {
      throw new Error('Нельзя очистить кэш во время активной сделки или свободной записи')
    }

    await stopNativeRecorder()
    segments.splice(0, segments.length)

    const { root } = cachePaths(settings)
    await rm(root, { recursive: true, force: true })

    const legacyCacheRemoved = canRemoveLegacyCache(settings)
    if (legacyCacheRemoved) await rm(legacyCacheRoot, { recursive: true, force: true })

    return {
      ok: true,
      cachePath: root,
      legacyCacheRemoved
    }
  }

  const getWindowRecorderStatus = async (settings: AppSettings): Promise<WindowRecorderStatus> => {
    if (hasPartialNativeScreenRecorderSet(settings)) {
      return buildStatus(settings, {
        backend: 'browser',
        fallbackRequired: true,
        message: 'Часть ffmpeg-рекордеров экранов остановилась. Перезапускаем фоновую запись.'
      })
    }

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
    clearCache,
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
      const processId = sanitizeProcessId(input.processId)
      const sequence = Number(input.sequence)
      const data = Buffer.from(input.data)
      if (!input.sourceId || !input.sourceName || !startedAtMs || endedAtMs <= startedAtMs || data.length === 0) {
        throw new Error('Некорректный сегмент встроенной записи')
      }

      const { segmentsDir } = cachePaths(settings)
      await mkdir(segmentsDir, { recursive: true })
      const id = randomUUID()
      const sessionId = typeof input.sessionId === 'string' && input.sessionId.trim() ? input.sessionId.trim() : id
      const path = join(segmentsDir, `${toFileTimestamp(startedAtMs)}-${toFileTimestamp(endedAtMs)}__${id}.webm`)
      pendingSegmentPaths.add(path)
      try {
        await writeFile(path, data)
        const fileStat = await stat(path)

        segments.push({
          id,
          backend: 'browser',
          sourceId: input.sourceId,
          sourceName: input.sourceName,
          processId,
          sessionId,
          sequence: Number.isFinite(sequence) && sequence >= 0 ? Math.trunc(sequence) : 0,
          startedAtMs,
          endedAtMs,
          path,
          sizeBytes: fileStat.size
        })
      } finally {
        pendingSegmentPaths.delete(path)
      }
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

      const replayProtectionId = randomUUID()
      replayProtectionTimes.set(
        replayProtectionId,
        Math.max(1, settings.clip.paddingBeforeSeconds > 0
          ? trade.entryTimeMs - settings.clip.paddingBeforeSeconds * 1000
          : trade.entryTimeMs)
      )

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
        replayProtectionTimes.delete(replayProtectionId)
      }
    }
  }
}
