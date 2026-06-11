import { access, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { AppSettings } from '../settings/settings'
import { buildFfmpegTrimArgs } from '../video/ffmpegCommand'
import { buildClipFileNames, buildClipOutputPaths, toSafeClipFileBaseName } from '../video/clipPaths'
import { createMissingMediaToolError, isMissingMediaToolError, resolveMediaToolPath } from '../video/mediaBinaries'
import { waitForNewestReplayFile } from '../video/replayFileFinder'
import { planReplayTrim } from '../video/trimPlanner'
import { probeVideoDetails, type VideoDetails, type VideoDetailsProbe, type VideoDurationProbe } from '../video/videoProbe'
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

export type ClipProcessingStatus = {
  active: boolean
  title: string
  message: string
  progressPercent: number
  startedAtMs?: number
}

export type TradeClipMetadata = ClipQueueItem & {
  replayPath: string
  replaySavedAtMs: number
  replayDurationSeconds: number
  replayFrameRate?: number
  outputDurationSeconds: number
  outputFrameRate?: number
  outputSizeBytes: number
  videoDiagnostics: {
    replay: VideoDetails
    output: VideoDetails
  }
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

export type SaveReplayBufferInput = {
  settings: AppSettings
  trade: ClosedTrade
}

export type DeleteClipFromQueueResult = {
  ok: true
  metadataPath: string
}

export type RenameClipFileResult = {
  ok: true
  clip: ClipQueueItem
}

export type TradeClipPipelineDeps = {
  getSettings: () => Promise<AppSettings>
  saveReplayBuffer: (input: SaveReplayBufferInput) => Promise<SaveReplayBufferResult>
  runFfmpeg?: (args: string[]) => Promise<void>
  getVideoDurationSeconds?: VideoDurationProbe
  getVideoDetails?: VideoDetailsProbe
  now?: () => number
}

export type TradeClipPipeline = {
  createClipForClosedTrade: (trade: ClosedTrade) => Promise<ClipQueueItem>
  listPendingClips: () => Promise<ClipQueueItem[]>
  renameClipFile: (input: { metadataPath: string, fileName: string }) => Promise<RenameClipFileResult>
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

const assertClipMetadataPath = (settings: AppSettings, metadataPath: string): string => {
  const queueRoot = resolve(settings.clip.outputDir)
  const resolvedMetadataPath = resolve(metadataPath)
  if (extname(resolvedMetadataPath).toLowerCase() !== '.json' || !isPathInside(queueRoot, resolvedMetadataPath)) {
    throw new Error('Некорректный путь метаданных клипа')
  }

  return resolvedMetadataPath
}

const normalizeClipVideoFileName = (value: string): string => {
  const baseName = toSafeClipFileBaseName(value)
  if (!baseName) throw new Error('Укажите имя файла')
  return `${baseName}.mp4`
}

const minimumUsableFrameRate = 12

const usableTargetFrameRate = (details: VideoDetails): number | undefined => {
  const frameRate = details.averageFrameRate ?? details.nominalFrameRate
  if (!frameRate || frameRate < minimumUsableFrameRate || frameRate > 240) return undefined
  return frameRate
}

const assertUsableFrameRate = (details: VideoDetails, sourceLabel: string): void => {
  const frameRate = details.averageFrameRate ?? details.nominalFrameRate
  if (!frameRate || frameRate >= minimumUsableFrameRate) return

  throw new Error(`${sourceLabel} содержит только ${frameRate.toFixed(1)} fps. TradeTools не может восстановить кадры, которых нет в исходной записи. Проверьте в OBS: Settings > Video > Common FPS Values, Output > Encoder overload, Game/Display Capture и Replay Buffer output.`)
}

export const createTradeClipPipeline = (deps: TradeClipPipelineDeps): TradeClipPipeline => {
  const getVideoDetails = deps.getVideoDetails ?? (
    deps.getVideoDurationSeconds
      ? async (path: string): Promise<VideoDetails> => ({ durationSeconds: await deps.getVideoDurationSeconds?.(path) ?? 0 })
      : probeVideoDetails
  )
  const runFfmpeg = deps.runFfmpeg ?? (async (args) => {
    const { spawn } = await import('node:child_process')
    await new Promise<void>((resolve, reject) => {
      const child = spawn(resolveMediaToolPath('ffmpeg'), args, { stdio: 'ignore' })
      child.on('error', (error) => {
        reject(isMissingMediaToolError(error) ? createMissingMediaToolError('ffmpeg') : error)
      })
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
      const replaySave = await deps.saveReplayBuffer({ settings, trade })
      if (!replaySave.ok) throw new Error(replaySave.message)

      const replayPath = replaySave.replayPath ?? await waitForNewestReplayFile({
        directory: settings.clip.replaySourceDir,
        afterMs: replaySave.requestedAtMs
      })
      if (!replayPath) {
        throw new Error(settings.recording.mode === 'window'
          ? 'Встроенный рекордер не вернул replay-файл. Проверьте, что выбранное окно терминала открыто и запись активна.'
          : `OBS сохранил Replay Buffer, но свежий replay-файл не найден в папке: ${settings.clip.replaySourceDir}. Проверьте, что это та же папка, куда OBS сохраняет Replay Buffer.`
        )
      }

      const replayStat = await stat(replayPath)
      const replaySavedAtMs = replayStat.mtimeMs
      const replayDetails = await getVideoDetails(replayPath)
      assertUsableFrameRate(replayDetails, settings.recording.mode === 'window' ? 'Встроенный replay-файл' : 'OBS replay-файл')
      const replayDurationSeconds = replayDetails.durationSeconds
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
        mode: 'reencode',
        targetFrameRate: usableTargetFrameRate(replayDetails)
      })
      const temporaryVideoPath = ffmpegArgs.at(-1)
      if (!temporaryVideoPath) throw new Error('Не удалось подготовить временный путь клипа')

      await mkdir(paths.dayFolder, { recursive: true })
      let outputDetails: VideoDetails
      try {
        await runFfmpeg(ffmpegArgs)
        outputDetails = await getVideoDetails(temporaryVideoPath)
        assertUsableFrameRate(outputDetails, 'Готовый клип')
        const outputDurationSeconds = outputDetails.durationSeconds
        if (outputDurationSeconds < Math.max(1, trim.durationSeconds - 2)) {
          throw new Error(`ffmpeg создал слишком короткий клип: ${outputDurationSeconds.toFixed(2)}с вместо ${trim.durationSeconds}с. Проверьте время сделки из API и длительность буфера записи.`)
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
        ...(replayDetails.averageFrameRate ? { replayFrameRate: replayDetails.averageFrameRate } : {}),
        outputDurationSeconds: outputDetails.durationSeconds,
        ...(outputDetails.averageFrameRate ? { outputFrameRate: outputDetails.averageFrameRate } : {}),
        outputSizeBytes: outputStat.size,
        videoDiagnostics: {
          replay: replayDetails,
          output: outputDetails
        },
        trade,
        trim
      }

      await writeFile(paths.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
      return item
    },
    async listPendingClips() {
      const settings = await deps.getSettings()
      const metadataFiles = await collectJsonFiles(resolve(settings.clip.outputDir))
      const items = await Promise.all(metadataFiles.map(parseMetadata))
      return items
        .filter((item): item is ClipQueueItem => item !== undefined)
        .sort((a, b) => b.createdAtMs - a.createdAtMs || basename(a.videoPath).localeCompare(basename(a.videoPath)))
    },
    async renameClipFile(input) {
      const settings = await deps.getSettings()
      const resolvedMetadataPath = assertClipMetadataPath(settings, input.metadataPath)
      const metadata = await parseTradeClipMetadata(resolvedMetadataPath)
      if (!metadata) throw new Error('Метаданные клипа не найдены')

      const currentVideoPath = resolve(metadata.videoPath)
      const videoDirectory = dirname(currentVideoPath)
      const queueRoot = resolve(settings.clip.outputDir)
      if (!isPathInside(queueRoot, currentVideoPath)) throw new Error('Некорректный путь видео клипа')

      const nextFileName = normalizeClipVideoFileName(input.fileName)
      const nextVideoPath = join(videoDirectory, nextFileName)
      if (resolve(nextVideoPath) === currentVideoPath) {
        const unchanged = {
          ...metadata,
          title: nextFileName.replace(/\.mp4$/i, ''),
          fileName: nextFileName,
          videoPath: currentVideoPath,
          metadataPath: resolvedMetadataPath
        }
        await writeFile(resolvedMetadataPath, `${JSON.stringify(unchanged, null, 2)}\n`, 'utf8')
        return {
          ok: true,
          clip: toClipQueueItem(unchanged)
        }
      }

      await access(currentVideoPath).catch(() => {
        throw new Error('Файл видео не найден')
      })
      await access(nextVideoPath).then(() => {
        throw new Error('Файл с таким именем уже существует')
      }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })

      await rename(currentVideoPath, nextVideoPath)
      const nextMetadata: TradeClipMetadata = {
        ...metadata,
        title: nextFileName.replace(/\.mp4$/i, ''),
        fileName: nextFileName,
        videoPath: nextVideoPath,
        metadataPath: resolvedMetadataPath
      }
      await writeFile(resolvedMetadataPath, `${JSON.stringify(nextMetadata, null, 2)}\n`, 'utf8')

      return {
        ok: true,
        clip: toClipQueueItem(nextMetadata)
      }
    },
    async deleteClipFromQueue(metadataPath) {
      const settings = await deps.getSettings()
      const resolvedMetadataPath = assertClipMetadataPath(settings, metadataPath)
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
