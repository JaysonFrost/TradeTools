import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { AppSettings } from '../settings/settings'
import type { ClosedTrade } from '../trades/simulatedTradePipeline'
import { createMissingMediaToolError, isMissingMediaToolError, resolveMediaToolPath } from '../video/mediaBinaries'

export type WindowCaptureSource = {
  id: string
  name: string
  displayId: string
}

export type WindowRecordingSegmentInput = {
  sourceId: string
  sourceName: string
  startedAtMs: number
  endedAtMs: number
  mimeType: string
  data: ArrayBuffer
}

export type WindowRecorderStatus = {
  enabled: boolean
  active: boolean
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

export type WindowRecorderService = {
  appendSegment: (input: WindowRecordingSegmentInput, settings: AppSettings) => Promise<WindowRecorderStatus>
  getStatus: (settings: AppSettings) => Promise<WindowRecorderStatus>
  saveReplayBuffer: (input: WindowReplaySaveInput) => Promise<WindowReplaySaveResult>
}

type StoredSegment = {
  id: string
  sourceId: string
  sourceName: string
  startedAtMs: number
  endedAtMs: number
  path: string
  sizeBytes: number
}

type WindowRecorderServiceInput = {
  appDataDir: string
}

const pollIntervalMs = 250
const exportToleranceMs = 1_500
const segmentStaleAfterMs = 8_000

const sleep = (durationMs: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, durationMs))

const sanitizeSegmentTime = (value: unknown): number => {
  const time = Number(value)
  return Number.isFinite(time) && time > 0 ? Math.trunc(time) : 0
}

const toFileTimestamp = (timeMs: number): string => new Date(timeMs).toISOString().replace(/[:.]/g, '-')

const escapeConcatPath = (path: string): string => path.replace(/\\/g, '/').replace(/'/g, "'\\''")

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

  const pruneDiskFiles = async (keepIds: Set<string>) => {
    const entries = await readdir(segmentsDir, { withFileTypes: true }).catch(() => [])
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile() || !entry.name.endsWith('.webm')) return

      const fileId = entry.name.replace(/\.webm$/i, '').split('__').at(-1)
      if (fileId && keepIds.has(fileId)) return

      await rm(join(segmentsDir, entry.name), { force: true }).catch(() => undefined)
    }))
  }

  const pruneSegments = async (settings: AppSettings, nowMs = Date.now()) => {
    const maxAgeMs = (settings.clip.replayBufferSeconds + settings.clip.paddingBeforeSeconds + settings.clip.paddingAfterSeconds + 30) * 1000
    const cutoffMs = nowMs - maxAgeMs

    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index]
      if (!segment || segment.endedAtMs >= cutoffMs) continue

      segments.splice(index, 1)
      await rm(segment.path, { force: true }).catch(() => undefined)
    }

    await pruneDiskFiles(new Set(segments.map((segment) => segment.id)))
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

  const buildStatus = async (settings: AppSettings): Promise<WindowRecorderStatus> => {
    await pruneSegments(settings)
    const sourceSegments = relevantSegments(settings)
    const first = sourceSegments[0]
    const last = sourceSegments.at(-1)
    const bufferedSeconds = first && last ? Math.max(0, (last.endedAtMs - first.startedAtMs) / 1000) : 0
    const active = Boolean(last && Date.now() - last.endedAtMs < segmentStaleAfterMs)

    return {
      enabled: settings.recording.mode === 'window',
      active,
      mode: settings.recording.mode,
      sourceId: settings.recording.windowSourceId,
      sourceName: settings.recording.windowSourceName,
      segmentCount: sourceSegments.length,
      bufferedSeconds,
      lastSegmentAtMs: last?.endedAtMs ?? 0,
      message: settings.recording.mode !== 'window'
        ? 'Встроенная запись окна выключена'
        : !settings.recording.windowSourceId
          ? 'Выберите окно терминала для встроенной записи'
          : active
            ? `Встроенная запись окна активна, накоплено ${Math.round(bufferedSeconds)}с`
            : 'Ждём сегменты от встроенного рекордера'
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

  const exportReplay = async (settings: AppSettings, trade: ClosedTrade): Promise<string> => {
    const replayStartMs = trade.entryTimeMs - settings.clip.paddingBeforeSeconds * 1000
    const replayEndMs = trade.exitTimeMs + settings.clip.paddingAfterSeconds * 1000
    const timeoutMs = Math.max(5_000, settings.clip.paddingAfterSeconds * 1000 + settings.recording.segmentSeconds * 2_000 + 2_000)
    const sourceSegments = await waitForSegmentsUntil(settings, replayEndMs, timeoutMs)
    const exportSegments = sourceSegments.filter((segment) => (
      segment.endedAtMs >= replayStartMs - exportToleranceMs &&
      segment.startedAtMs <= replayEndMs + exportToleranceMs
    ))

    const first = exportSegments[0]
    const last = exportSegments.at(-1)
    if (!first || !last) {
      throw new Error('Встроенный рекордер ещё не накопил видео для этой сделки. Оставьте окно терминала открытым и дождитесь нескольких секунд записи.')
    }
    if (first.startedAtMs > replayStartMs + exportToleranceMs) {
      throw new Error('Встроенный рекордер запущен слишком поздно: в буфере нет начала сделки.')
    }
    if (last.endedAtMs < replayEndMs - exportToleranceMs) {
      throw new Error('Встроенный рекордер ещё не записал время после выхода из сделки. Попробуйте ещё раз через пару секунд.')
    }

    await mkdir(replaysDir, { recursive: true })
    const replayId = randomUUID()
    const listPath = join(replaysDir, `${toFileTimestamp(Date.now())}-${replayId}.txt`)
    const copyReplayPath = join(replaysDir, `${toFileTimestamp(last.endedAtMs)}-${replayId}.webm`)
    const encodedReplayPath = join(replaysDir, `${toFileTimestamp(last.endedAtMs)}-${replayId}.mp4`)
    const concatList = exportSegments
      .map((segment) => `file '${escapeConcatPath(segment.path)}'`)
      .join('\n')

    await writeFile(listPath, `${concatList}\n`, 'utf8')
    try {
      let replayPath = copyReplayPath
      try {
        await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', copyReplayPath])
      } catch {
        replayPath = encodedReplayPath
        await rm(copyReplayPath, { force: true }).catch(() => undefined)
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
          '-fps_mode',
          'cfr',
          '-avoid_negative_ts',
          'make_zero',
          '-movflags',
          '+faststart',
          encodedReplayPath
        ])
      }
      const savedAt = new Date(last.endedAtMs)
      await utimes(replayPath, savedAt, savedAt)
      return replayPath
    } finally {
      await rm(listPath, { force: true }).catch(() => undefined)
    }
  }

  return {
    async appendSegment(input, settings) {
      if (settings.recording.mode !== 'window') return buildStatus(settings)

      const startedAtMs = sanitizeSegmentTime(input.startedAtMs)
      const endedAtMs = sanitizeSegmentTime(input.endedAtMs)
      const data = Buffer.from(input.data)
      if (!input.sourceId || !input.sourceName || !startedAtMs || endedAtMs <= startedAtMs || data.length === 0) {
        throw new Error('Некорректный сегмент встроенной записи')
      }

      await mkdir(segmentsDir, { recursive: true })
      const id = randomUUID()
      const path = join(segmentsDir, `${toFileTimestamp(startedAtMs)}-${toFileTimestamp(endedAtMs)}__${id}.webm`)
      await writeFile(path, data)
      const fileStat = await stat(path)

      segments.push({
        id,
        sourceId: input.sourceId,
        sourceName: input.sourceName,
        startedAtMs,
        endedAtMs,
        path,
        sizeBytes: fileStat.size
      })
      await pruneSegments(settings, endedAtMs)
      return buildStatus(settings)
    },
    getStatus: buildStatus,
    async saveReplayBuffer({ settings, trade }) {
      const requestedAtMs = Date.now()
      if (settings.recording.mode !== 'window') {
        return {
          ok: false,
          requestedAtMs,
          message: 'Встроенная запись окна выключена'
        }
      }

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
      }
    }
  }
}
