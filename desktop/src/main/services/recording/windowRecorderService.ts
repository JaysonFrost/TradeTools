import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { appendFile, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join } from 'node:path'
import type { AppSettings } from '../settings/settings'
import type { ClosedTrade } from '../trades/simulatedTradePipeline'
import { toSafeClipFileBaseName } from '../video/clipPaths'
import { createMissingMediaToolError, isMissingMediaToolError, resolveMediaToolPath } from '../video/mediaBinaries'

export type WindowCaptureSource = {
  id: string
  name: string
  displayId: string
  type: AppSettings['recording']['sourceType']
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
}

export type WindowReplaySaveInput = {
  settings: AppSettings
  trade: ClosedTrade
}

export type WindowReplaySaveResult = {
  ok: boolean
  message: string
  requestedAtMs: number
  replayPath?: string
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

type WindowRecorderServiceInput = {
  appDataDir: string
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
const padDatePart = (value: number): string => String(value).padStart(2, '0')
const formatFilePeriodTimestamp = (timeMs: number): string => {
  const date = new Date(timeMs)
  return `${padDatePart(date.getDate())}.${padDatePart(date.getMonth() + 1)}.${date.getFullYear()} ${padDatePart(date.getHours())}-${padDatePart(date.getMinutes())}-${padDatePart(date.getSeconds())}`
}

const escapeConcatPath = (path: string): string => path.replace(/\\/g, '/').replace(/'/g, "'\\''")
const isNativeRecordingSupported = (): boolean => process.platform === 'win32'
const isGdigrabRecorderEnabled = (): boolean => process.env.TRADETOOLS_ENABLE_GDIGRAB === '1'
const normalizeFfmpegLog = (value: string): string => value.replace(/\s+/g, ' ').trim().slice(-800)
const formatFrameRate = (value: number): string => String(Math.max(10, Math.min(60, Math.trunc(value))))

const runFfmpeg = async (args: string[]): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(resolveMediaToolPath('ffmpeg'), args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      reject(isMissingMediaToolError(error) ? createMissingMediaToolError('ffmpeg') : error)
    })
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`ffmpeg exited with code ${code ?? 'unknown'}: ${stderr.trim()}`))
    })
  })
}

export const createWindowRecorderService = ({ appDataDir }: WindowRecorderServiceInput): WindowRecorderService => {
  const segmentsDir = join(appDataDir, 'window-recording', 'segments')
  const replaysDir = join(appDataDir, 'window-recording', 'replays')
  const segments: StoredSegment[] = []
  let protectedSinceMs = 0
  let freeRecording: FreeRecordingState | undefined
  let nativeRecorder: NativeRecorderState | undefined
  let nativeLastError = ''

  const nativeSettingsKey = (settings: AppSettings): string => [
    settings.recording.sourceType,
    settings.recording.windowSourceId,
    settings.recording.windowSourceName,
    settings.recording.frameRate,
    settings.recording.segmentSeconds
  ].join('|')

  const nativeSourceName = (settings: AppSettings): string => (
    settings.recording.windowSourceName ||
    (settings.recording.sourceType === 'screen' ? 'Экран' : '')
  )

  const buildNativeRecorderArgs = (settings: AppSettings, outputPattern: string, listPath: string): string[] => {
    const frameRate = formatFrameRate(settings.recording.frameRate)
    const segmentSeconds = String(Math.max(1, Math.trunc(settings.recording.segmentSeconds)))
    const inputName = settings.recording.sourceType === 'screen'
      ? 'desktop'
      : `title=${settings.recording.windowSourceName}`

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
      '-i',
      inputName,
      '-map',
      '0:v:0',
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-tune',
      'zerolatency',
      '-crf',
      '24',
      '-pix_fmt',
      'yuv420p',
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
    const current = nativeRecorder
    if (!current) return

    nativeRecorder = undefined
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
  }

  const scanNativeSegments = async () => {
    const current = nativeRecorder
    if (!current) return

    const listText = await readFile(current.listPath, 'utf8').catch(() => '')
    if (!listText.trim()) return

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

  const startNativeRecorder = async (settings: AppSettings): Promise<WindowRecorderStatus> => {
    if (settings.recording.mode !== 'window') {
      await stopNativeRecorder()
      return buildStatus(settings)
    }

    if (!isNativeRecordingSupported()) {
      return buildStatus(settings, {
        backend: 'browser',
        fallbackRequired: true,
        message: 'Оптимизированная ffmpeg-запись пока доступна на Windows. Используем совместимый рекордер Chromium.'
      })
    }

    if (!isGdigrabRecorderEnabled()) {
      await stopNativeRecorder()
      return buildStatus(settings, {
        backend: 'browser',
        fallbackRequired: true,
        message: 'Фоновый GDI-захват отключён: он может мигать курсором Windows и мешать играм. Пишем через встроенный Chromium-рекордер без курсора.'
      })
    }

    if (settings.recording.sourceType === 'screen') {
      await stopNativeRecorder()
      return buildStatus(settings, {
        backend: 'browser',
        fallbackRequired: true,
        message: 'Запись экрана идёт через Chromium: так не мигает курсор Windows. Для максимального FPS выберите конкретное окно терминала.'
      })
    }

    if (settings.recording.sourceType === 'window' && !settings.recording.windowSourceName) {
      return buildStatus(settings, {
        backend: 'browser',
        fallbackRequired: true,
        message: 'Откройте торговый терминал, TradeTools выберет окно и начнёт запись'
      })
    }

    const settingsKey = nativeSettingsKey(settings)
    if (nativeRecorder?.settingsKey === settingsKey && nativeRecorder.process.exitCode === null) {
      await scanNativeSegments()
      return buildStatus(settings, { backend: 'ffmpeg' })
    }

    await stopNativeRecorder()
    await mkdir(segmentsDir, { recursive: true })

    const sessionId = `ffmpeg-${Date.now()}-${randomUUID()}`
    const listPath = join(segmentsDir, `${sessionId}.csv`)
    const outputPattern = join(segmentsDir, `${sessionId}-%06d.mp4`)
    const sourceName = nativeSourceName(settings)
    const processStartedAtMs = Date.now()
    const child = spawn(resolveMediaToolPath('ffmpeg'), buildNativeRecorderArgs(settings, outputPattern, listPath), {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true
    })
    const state: NativeRecorderState = {
      process: child,
      sessionId,
      settingsKey,
      sourceId: settings.recording.windowSourceId || settings.recording.sourceType,
      sourceName,
      startedAtMs: processStartedAtMs,
      listPath,
      outputPattern,
      stderr: '',
      stopping: false
    }

    nativeLastError = ''
    nativeRecorder = state

    child.stderr.on('data', (chunk) => {
      state.stderr = normalizeFfmpegLog(`${state.stderr}${String(chunk)}`)
    })
    child.on('error', (error) => {
      nativeLastError = isMissingMediaToolError(error) ? createMissingMediaToolError('ffmpeg').message : error.message
      if (nativeRecorder === state) nativeRecorder = undefined
    })
    child.on('exit', (code, signal) => {
      if (!state.stopping) {
        nativeLastError = normalizeFfmpegLog(state.stderr) || `ffmpeg остановился: ${code ?? signal ?? 'unknown'}`
      }
      if (nativeRecorder === state) nativeRecorder = undefined
    })

    await sleep(nativeRecorderStartupGraceMs)
    if (nativeRecorder !== state || child.exitCode !== null) {
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
      message: 'Оптимизированная ffmpeg-запись запущена, ждём первые сегменты'
    })
  }

  const pruneDiskFiles = async (keepPaths: Set<string>) => {
    const entries = await readdir(segmentsDir, { withFileTypes: true }).catch(() => [])
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile()) return
      const filePath = join(segmentsDir, entry.name)
      const extension = extname(entry.name).toLowerCase()
      if (!['.webm', '.mp4', '.csv'].includes(extension)) return
      if (keepPaths.has(filePath)) return
      if (nativeRecorder?.listPath === filePath) return

      if (nativeRecorder && entry.name.startsWith(`${nativeRecorder.sessionId}-`)) {
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

  const relevantSegments = (settings: AppSettings): StoredSegment[] => {
    const sourceId = settings.recording.windowSourceId
    const sourceName = settings.recording.windowSourceName
    return segments
      .filter((segment) => (
        sourceId ? segment.sourceId === sourceId || segment.sourceName === sourceName : segment.sourceName === sourceName
      ))
      .sort((a, b) => a.startedAtMs - b.startedAtMs)
  }

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
    const active = Boolean(nativeRecorder && override.backend !== 'browser') || Boolean(last && Date.now() - last.endedAtMs < segmentStaleAfterMs)
    const backend = override.backend ?? (nativeRecorder ? 'ffmpeg' : 'browser')
    const bufferTargetSeconds = Math.max(1, Math.round(settings.clip.replayBufferSeconds))
    const bufferMessage = `накоплено ${Math.round(bufferedSeconds)}с из ${bufferTargetSeconds}с`
    const defaultMessage = settings.recording.mode !== 'window'
      ? 'Встроенная запись окна выключена'
      : !settings.recording.windowSourceId && settings.recording.sourceType === 'window'
        ? 'Откройте торговый терминал, TradeTools выберет окно и начнёт запись'
        : backend === 'ffmpeg' && nativeRecorder
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
      ...(override.fallbackRequired || (settings.recording.mode === 'window' && !nativeRecorder && Boolean(nativeLastError)) ? { fallbackRequired: true } : {}),
      mode: settings.recording.mode,
      sourceId: settings.recording.windowSourceId,
      sourceName: settings.recording.windowSourceName,
      segmentCount: sourceSegments.length,
      bufferedSeconds,
      lastSegmentAtMs: last?.endedAtMs ?? 0,
      message: override.message ?? defaultMessage
    }
  }

  const waitForSegmentsUntil = async (settings: AppSettings, targetEndMs: number, timeoutMs: number): Promise<StoredSegment[]> => {
    const deadlineMs = Date.now() + timeoutMs
    while (Date.now() <= deadlineMs) {
      await pruneSegments(settings)
      const sourceSegments = relevantSegments(settings)
      if (sourceSegments.some((segment) => segment.endedAtMs >= targetEndMs - exportToleranceMs)) {
        return sourceSegments
      }
      await sleep(pollIntervalMs)
    }

    return relevantSegments(settings)
  }

  const buildSessionFiles = async (sourceSegments: StoredSegment[], neededSegments: StoredSegment[], replayId: string): Promise<string[]> => {
    const lastNeededSequenceBySession = new Map<string, number>()
    const sessionStartedAt = new Map<string, number>()

    for (const segment of neededSegments) {
      lastNeededSequenceBySession.set(segment.sessionId, Math.max(lastNeededSequenceBySession.get(segment.sessionId) ?? -1, segment.sequence))
    }
    for (const segment of sourceSegments) {
      if (!lastNeededSequenceBySession.has(segment.sessionId)) continue
      sessionStartedAt.set(segment.sessionId, Math.min(sessionStartedAt.get(segment.sessionId) ?? segment.startedAtMs, segment.startedAtMs))
    }

    const sessionIds = [...lastNeededSequenceBySession.keys()].sort((left, right) => (
      (sessionStartedAt.get(left) ?? 0) - (sessionStartedAt.get(right) ?? 0)
    ))
    const sessionFiles: string[] = []

    for (const sessionId of sessionIds) {
      const lastSequence = lastNeededSequenceBySession.get(sessionId) ?? -1
      const sessionSegments = sourceSegments
        .filter((segment) => segment.sessionId === sessionId && segment.sequence <= lastSequence)
        .sort((left, right) => left.sequence - right.sequence || left.startedAtMs - right.startedAtMs)
      const firstSequence = sessionSegments[0]?.sequence
      if (firstSequence !== 0) throw new Error('Встроенный рекордер уже очистил начало нужной сессии записи. Попробуйте увеличить длительность буфера записи.')

      const sessionPath = join(replaysDir, `${toFileTimestamp(sessionSegments.at(-1)?.endedAtMs ?? Date.now())}-${replayId}-${sessionFiles.length}.webm`)
      await rm(sessionPath, { force: true }).catch(() => undefined)
      for (const segment of sessionSegments) {
        await appendFile(sessionPath, await readFile(segment.path))
      }
      sessionFiles.push(sessionPath)
    }

    return sessionFiles
  }

  const encodeReplayFile = async (inputPath: string, outputPath: string, settings: AppSettings): Promise<void> => {
    await runFfmpeg([
      '-y',
      '-fflags',
      '+genpts',
      '-i',
      inputPath,
      '-map',
      '0:v:0',
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(settings.recording.frameRate),
      '-fps_mode',
      'cfr',
      '-avoid_negative_ts',
      'make_zero',
      '-movflags',
      '+faststart',
      outputPath
    ])
  }

  const concatNativeReplayFile = async (neededSegments: StoredSegment[], listPath: string, replayPath: string, settings: AppSettings): Promise<void> => {
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
      ])
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
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-r',
        String(settings.recording.frameRate),
        '-fps_mode',
        'cfr',
        '-avoid_negative_ts',
        'make_zero',
        '-movflags',
        '+faststart',
        replayPath
      ])
    }
  }

  const writeReplayFromSegments = async (
    sourceSegments: StoredSegment[],
    neededSegments: StoredSegment[],
    replayPath: string,
    settings: AppSettings,
    replayId: string,
    listPath: string
  ): Promise<string[]> => {
    const allNativeSegments = neededSegments.every((segment) => segment.backend === 'ffmpeg')
    const allBrowserSegments = neededSegments.every((segment) => segment.backend === 'browser')
    const sessionFiles: string[] = []

    if (allNativeSegments) {
      await concatNativeReplayFile(neededSegments, listPath, replayPath, settings)
      return sessionFiles
    }

    if (allBrowserSegments) {
      sessionFiles.push(...await buildSessionFiles(sourceSegments, neededSegments, replayId))
      if (sessionFiles.length === 1 && sessionFiles[0]) {
        await encodeReplayFile(sessionFiles[0], replayPath, settings)
        return sessionFiles
      }

      const concatList = sessionFiles
        .map((path) => `file '${escapeConcatPath(path)}'`)
        .join('\n')
      await writeFile(listPath, `${concatList}\n`, 'utf8')
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
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-r',
        String(settings.recording.frameRate),
        '-fps_mode',
        'cfr',
        '-avoid_negative_ts',
        'make_zero',
        '-movflags',
        '+faststart',
        replayPath
      ])
      return sessionFiles
    }

    throw new Error('Во время записи переключился backend записи. Дождитесь новой записи после перезапуска рекордера.')
  }

  const exportReplay = async (settings: AppSettings, trade: ClosedTrade): Promise<string> => {
    const replayEndMs = trade.exitTimeMs + settings.clip.paddingAfterSeconds * 1000
    const replayStartMs = trade.entryTimeMs - settings.clip.paddingBeforeSeconds * 1000
    const timeoutMs = Math.max(5_000, settings.clip.paddingAfterSeconds * 1000 + settings.recording.segmentSeconds * 2_000 + 2_000)
    const sourceSegments = await waitForSegmentsUntil(settings, replayEndMs, timeoutMs)
    const neededSegments = sourceSegments.filter((segment) => (
      segment.endedAtMs >= replayStartMs - exportToleranceMs &&
      segment.startedAtMs <= replayEndMs + exportToleranceMs
    ))
    const firstSourceSegment = sourceSegments[0]
    const lastSourceSegment = sourceSegments.at(-1)
    const bufferedSeconds = firstSourceSegment && lastSourceSegment
      ? (lastSourceSegment.endedAtMs - firstSourceSegment.startedAtMs) / 1000
      : 0
    const requiredSeconds = (replayEndMs - replayStartMs) / 1000

    const first = neededSegments[0]
    const last = neededSegments.at(-1)
    if (!first || !last) {
      throw new Error(`Встроенный рекордер ещё не накопил видео для этой сделки. Накоплено ${formatRoundedSeconds(bufferedSeconds)}, нужно примерно ${formatRoundedSeconds(requiredSeconds)}. Оставьте окно терминала открытым.`)
    }
    if (first.startedAtMs > replayStartMs + exportToleranceMs) {
      throw new Error('Встроенный рекордер запущен слишком поздно: в буфере нет начала сделки.')
    }
    if (last.endedAtMs < replayEndMs - exportToleranceMs) {
      const remainingSeconds = (replayEndMs - last.endedAtMs) / 1000
      throw new Error(`Встроенный рекордер ещё не записал время после выхода из сделки. Осталось примерно ${formatRoundedSeconds(remainingSeconds)}.`)
    }

    await mkdir(replaysDir, { recursive: true })
    const replayId = randomUUID()
    const listPath = join(replaysDir, `${toFileTimestamp(Date.now())}-${replayId}.txt`)
    const replayPath = join(replaysDir, `${toFileTimestamp(last.endedAtMs)}-${replayId}.mp4`)
    let sessionFiles: string[] = []

    try {
      sessionFiles = await writeReplayFromSegments(sourceSegments, neededSegments, replayPath, settings, replayId, listPath)
      const savedAt = new Date(last.endedAtMs)
      await utimes(replayPath, savedAt, savedAt)
      return replayPath
    } finally {
      await rm(listPath, { force: true }).catch(() => undefined)
      await Promise.all(sessionFiles.map((path) => rm(path, { force: true }).catch(() => undefined)))
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
    let sessionFiles: string[] = []

    try {
      await rm(replayPath, { force: true }).catch(() => undefined)
      sessionFiles = await writeReplayFromSegments(sourceSegments, neededSegments, replayPath, settings, replayId, listPath)
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
      await Promise.all(sessionFiles.map((path) => rm(path, { force: true }).catch(() => undefined)))
    }
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
      await pruneSegments(settings, endedAtMs)
      return buildStatus(settings)
    },
    getStatus: buildStatus,
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
    async saveReplayBuffer({ settings, trade }) {
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
        const replayPath = await exportReplay(settings, trade)
        return {
          ok: true,
          requestedAtMs,
          replayPath,
          message: `Встроенный replay сохранён: ${basename(replayPath)}`
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
