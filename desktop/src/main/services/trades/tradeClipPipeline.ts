import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'
import type { AppSettings } from '../settings/settings'
import { buildFfmpegTrimArgs } from '../video/ffmpegCommand'
import { buildClipFileNames, buildClipOutputPaths } from '../video/clipPaths'
import { waitForNewestReplayFile } from '../video/replayFileFinder'
import { planReplayTrim } from '../video/trimPlanner'
import { probeVideoDurationSeconds, type VideoDurationProbe } from '../video/videoProbe'
import type { ClosedTrade } from './simulatedTradePipeline'

export type ClipReviewStatus = 'pending-review'

export type ClipQueueItem = {
  id: string
  status: ClipReviewStatus
  title: string
  fileName: string
  videoPath: string
  metadataPath: string
  symbol: string
  side: string
  exchange: string
  marketType: string
  entryTimeMs: number
  exitTimeMs: number
  durationSeconds: number
  createdAtMs: number
}

export type TradeClipMetadata = ClipQueueItem & {
  replayPath: string
  replaySavedAtMs: number
  replayDurationSeconds: number
  outputDurationSeconds: number
  outputSizeBytes: number
  trade: ClosedTrade
  trim: {
    startSeconds: number
    endSeconds: number
    durationSeconds: number
  }
}

export type SaveReplayBufferResult = {
  ok: boolean
  message: string
  requestedAtMs: number
  replayPath?: string
}

export type DeleteClipFromQueueResult = {
  ok: true
  metadataPath: string
}

export type TradeClipPipelineDeps = {
  getSettings: () => Promise<AppSettings>
  saveReplayBuffer: () => Promise<SaveReplayBufferResult>
  runFfmpeg?: (args: string[]) => Promise<void>
  getVideoDurationSeconds?: VideoDurationProbe
  now?: () => number
}

export type TradeClipPipeline = {
  createClipForClosedTrade: (trade: ClosedTrade) => Promise<ClipQueueItem>
  listPendingClips: () => Promise<ClipQueueItem[]>
  deleteClipFromQueue: (metadataPath: string) => Promise<DeleteClipFromQueueResult>
}

const parseTradeClipMetadata = async (metadataPath: string): Promise<TradeClipMetadata | undefined> => {
  try {
    const parsed = JSON.parse(await readFile(metadataPath, 'utf8')) as TradeClipMetadata
    if (parsed.status !== 'pending-review') return undefined
    return {
      ...parsed,
      title: parsed.title ?? parsed.fileName.replace(/\.[^.]+$/, '')
    }
  } catch {
    return undefined
  }
}

const toClipQueueItem = (metadata: TradeClipMetadata): ClipQueueItem => ({
  id: metadata.id,
  status: metadata.status,
  title: metadata.title,
  fileName: metadata.fileName,
  videoPath: metadata.videoPath,
  metadataPath: metadata.metadataPath,
  symbol: metadata.symbol,
  side: metadata.side,
  exchange: metadata.exchange,
  marketType: metadata.marketType,
  entryTimeMs: metadata.entryTimeMs,
  exitTimeMs: metadata.exitTimeMs,
  durationSeconds: metadata.durationSeconds,
  createdAtMs: metadata.createdAtMs
})

const parseMetadata = async (metadataPath: string): Promise<ClipQueueItem | undefined> => {
  const metadata = await parseTradeClipMetadata(metadataPath)
  return metadata ? toClipQueueItem(metadata) : undefined
}

const collectJsonFiles = async (directory: string): Promise<string[]> => {
  try {
    const entries = await import('node:fs/promises').then(({ readdir }) => readdir(directory, { withFileTypes: true }))
    const nested = await Promise.all(entries.map(async (entry) => {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory()) return collectJsonFiles(path)
      return entry.isFile() && entry.name.endsWith('.json') ? [path] : []
    }))
    return nested.flat()
  } catch {
    return []
  }
}

const isPathInside = (parentPath: string, childPath: string): boolean => {
  const childRelativePath = relative(parentPath, childPath)
  return Boolean(childRelativePath) && !childRelativePath.startsWith('..') && !isAbsolute(childRelativePath)
}

export const createTradeClipPipeline = (deps: TradeClipPipelineDeps): TradeClipPipeline => {
  const getVideoDurationSeconds = deps.getVideoDurationSeconds ?? probeVideoDurationSeconds
  const runFfmpeg = deps.runFfmpeg ?? (async (args) => {
    const { spawn } = await import('node:child_process')
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', args, { stdio: 'ignore' })
      child.on('error', reject)
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code ?? 'unknown'}`)))
    })
  })
  const now = deps.now ?? (() => Date.now())
  let temporaryClipSequence = 0

  const nextTemporaryClipPath = (videoPath: string): string => {
    temporaryClipSequence += 1
    return `${videoPath}.tmp-${process.pid}-${now()}-${temporaryClipSequence}.mp4`
  }

  return {
    async createClipForClosedTrade(trade) {
      const settings = await deps.getSettings()
      const replaySave = await deps.saveReplayBuffer()
      if (!replaySave.ok) throw new Error(replaySave.message)

      const replayPath = replaySave.replayPath ?? await waitForNewestReplayFile({
        directory: settings.clip.replaySourceDir,
        afterMs: replaySave.requestedAtMs
      })
      if (!replayPath) throw new Error(`OBS сохранил Replay Buffer, но свежий replay-файл не найден в папке: ${settings.clip.replaySourceDir}. Проверьте, что это та же папка, куда OBS сохраняет Replay Buffer.`)

      const replayStat = await stat(replayPath)
      const replaySavedAtMs = replayStat.mtimeMs
      const replayDurationSeconds = await getVideoDurationSeconds(replayPath)
      const paths = buildClipOutputPaths(settings.clip.outputDir, trade)
      const trim = planReplayTrim({
        tradeEntryTimeMs: trade.entryTimeMs,
        tradeExitTimeMs: trade.exitTimeMs,
        replaySavedAtMs,
        replayDurationSeconds,
        paddingBeforeSeconds: settings.clip.paddingBeforeSeconds,
        paddingAfterSeconds: settings.clip.paddingAfterSeconds
      })
      const ffmpegArgs = buildFfmpegTrimArgs({
        inputPath: replayPath,
        outputPath: nextTemporaryClipPath(paths.videoPath),
        startSeconds: trim.startSeconds,
        endSeconds: trim.endSeconds,
        mode: 'reencode'
      })
      const temporaryVideoPath = ffmpegArgs.at(-1)
      if (!temporaryVideoPath) throw new Error('Не удалось подготовить временный путь клипа')

      await mkdir(paths.dayFolder, { recursive: true })
      let outputDurationSeconds: number
      try {
        await runFfmpeg(ffmpegArgs)
        outputDurationSeconds = await getVideoDurationSeconds(temporaryVideoPath)
        if (outputDurationSeconds < Math.max(1, trim.durationSeconds - 2)) {
          throw new Error(`ffmpeg создал слишком короткий клип: ${outputDurationSeconds.toFixed(2)}с вместо ${trim.durationSeconds}с. Проверьте время сделки из API и длительность OBS Replay Buffer.`)
        }
        await rename(temporaryVideoPath, paths.videoPath)
      } catch (error) {
        await unlink(temporaryVideoPath).catch(() => undefined)
        throw error
      }
      const outputStat = await stat(paths.videoPath)

      const names = buildClipFileNames(trade)
      const item: ClipQueueItem = {
        id: `${trade.id}-${trade.entryTimeMs}`,
        status: 'pending-review',
        title: names.title,
        fileName: names.videoFileName,
        videoPath: paths.videoPath,
        metadataPath: paths.metadataPath,
        symbol: trade.symbol,
        side: trade.side,
        exchange: trade.exchange,
        marketType: trade.marketType,
        entryTimeMs: trade.entryTimeMs,
        exitTimeMs: trade.exitTimeMs,
        durationSeconds: trim.durationSeconds,
        createdAtMs: now()
      }
      const metadata: TradeClipMetadata = {
        ...item,
        replayPath,
        replaySavedAtMs,
        replayDurationSeconds,
        outputDurationSeconds,
        outputSizeBytes: outputStat.size,
        trade,
        trim
      }

      await writeFile(paths.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
      return item
    },
    async listPendingClips() {
      const settings = await deps.getSettings()
      const metadataFiles = await collectJsonFiles(`${settings.clip.outputDir}/clips`)
      const items = await Promise.all(metadataFiles.map(parseMetadata))
      return items
        .filter((item): item is ClipQueueItem => item !== undefined)
        .sort((a, b) => b.createdAtMs - a.createdAtMs || basename(a.videoPath).localeCompare(basename(a.videoPath)))
    },
    async deleteClipFromQueue(metadataPath) {
      const settings = await deps.getSettings()
      const queueRoot = resolve(settings.clip.outputDir, 'clips')
      const resolvedMetadataPath = resolve(metadataPath)
      if (extname(resolvedMetadataPath).toLowerCase() !== '.json' || !isPathInside(queueRoot, resolvedMetadataPath)) {
        throw new Error('Некорректный путь метаданных клипа')
      }

      const metadata = await parseTradeClipMetadata(resolvedMetadataPath)
      if (!metadata) throw new Error('Метаданные клипа не найдены')

      await unlink(resolvedMetadataPath)
      return {
        ok: true,
        metadataPath: resolvedMetadataPath
      }
    }
  }
}
