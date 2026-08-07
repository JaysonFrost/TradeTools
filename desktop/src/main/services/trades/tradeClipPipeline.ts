import { access, copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { AppSettings, CaptureTargetRef } from '../settings/settings'
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
  tmmTradeUrl?: string
  captureTarget?: CaptureTargetRef
}

export type ClipProcessingStatus = {
  active: boolean
  title: string
  message: string
  progressPercent: number
  startedAtMs?: number
  queuedCount?: number
  activeJobId?: string
  queuedJobs?: Array<{ id: string, title: string }>
}

export type TradeClipMetadata = ClipQueueItem & {
  tmmVideoPath?: string
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
  captureTarget?: CaptureTargetRef
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
  readyClip?: boolean
}

export type SaveReplayBufferInput = {
  settings: AppSettings
  trade: ClosedTrade
  captureTarget?: CaptureTargetRef
  signal?: AbortSignal
}

export type DeleteClipFromQueueResult = {
  ok: true
  metadataPath: string
}

export type DeleteClipFileResult = {
  ok: true
  metadataPath: string
  videoPath: string
}

export type RenameClipFileResult = {
  ok: true
  clip: ClipQueueItem
}

export type ClearClipQueueResult = {
  ok: true
  removedCount: number
  deletedFileCount: number
}

export type SyncTmmTradeLinksResult = {
  checkedCount: number
  matchedCount: number
}

export type FreeRecordingQueueInput = {
  videoPath: string
  fileName: string
  startedAtMs: number
  endedAtMs: number
  durationSeconds: number
}

export type CreateClipOptions = {
  captureTarget?: CaptureTargetRef
  signal?: AbortSignal
}

export type ManualBufferClipInput = CreateClipOptions & {
  requestedAtMs?: number
}

export type TradeClipPipelineDeps = {
  getSettings: () => Promise<AppSettings>
  saveReplayBuffer: (input: SaveReplayBufferInput) => Promise<SaveReplayBufferResult>
  runFfmpeg?: (args: string[], signal?: AbortSignal) => Promise<void>
  getVideoDurationSeconds?: VideoDurationProbe
  getVideoDetails?: VideoDetailsProbe
  findTmmTradeUrl?: (trade: ClosedTrade) => Promise<string | undefined>
  findTmmTradeUrls?: (trades: ClosedTrade[]) => Promise<Array<string | undefined>>
  updateTmmTradeVideoPath?: (tradeUrl: string, videoPath: string) => Promise<boolean>
  now?: () => number
}

export type TradeClipPipeline = {
  addFreeRecordingToQueue: (input: FreeRecordingQueueInput) => Promise<ClipQueueItem>
  clearQueue: () => Promise<ClearClipQueueResult>
  createClipForClosedTrade: (trade: ClosedTrade, options?: CreateClipOptions) => Promise<ClipQueueItem>
  createManualBufferClip: (input?: ManualBufferClipInput) => Promise<ClipQueueItem>
  syncTmmTradeLinks: () => Promise<SyncTmmTradeLinksResult>
  deleteQueueFiles: () => Promise<ClearClipQueueResult>
  listPendingClips: () => Promise<ClipQueueItem[]>
  renameClipFile: (input: { metadataPath: string, fileName: string }) => Promise<RenameClipFileResult>
  deleteClipFromQueue: (metadataPath: string) => Promise<DeleteClipFromQueueResult>
  deleteClipFile: (metadataPath: string) => Promise<DeleteClipFileResult>
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
  createdAtMs: metadata.createdAtMs,
  ...(metadata.tmmTradeUrl ? { tmmTradeUrl: metadata.tmmTradeUrl } : {}),
  ...(metadata.captureTarget ? { captureTarget: metadata.captureTarget } : {})
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
const minimumOutputDurationFloorSeconds = 0.05
const minimumDurationShortfallToleranceSeconds = 0.25
const maximumDurationShortfallToleranceSeconds = 2

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

const minimumAcceptableOutputDuration = (trimDurationSeconds: number): number => {
  const toleranceSeconds = Math.min(
    maximumDurationShortfallToleranceSeconds,
    Math.max(minimumDurationShortfallToleranceSeconds, trimDurationSeconds * 0.1)
  )
  return Math.max(Math.min(minimumOutputDurationFloorSeconds, trimDurationSeconds * 0.5), trimDurationSeconds - toleranceSeconds)
}

const createAbortError = (): Error => new Error('Сохранение клипа отменено')

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw createAbortError()
}

export const createTradeClipPipeline = (deps: TradeClipPipelineDeps): TradeClipPipeline => {
  const getVideoDetails = deps.getVideoDetails ?? (
    deps.getVideoDurationSeconds
      ? async (path: string): Promise<VideoDetails> => ({ durationSeconds: await deps.getVideoDurationSeconds?.(path) ?? 0 })
      : probeVideoDetails
  )
  const runFfmpeg = deps.runFfmpeg ?? (async (args, signal) => {
    const { spawn } = await import('node:child_process')
    await new Promise<void>((resolve, reject) => {
      throwIfAborted(signal)
      const child = spawn(resolveMediaToolPath('ffmpeg'), args, { stdio: 'ignore' })
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
      child.on('error', (error) => {
        settle(() => reject(isMissingMediaToolError(error) ? createMissingMediaToolError('ffmpeg') : error))
      })
      child.on('exit', (code) => settle(() => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code ?? 'unknown'}`))))
    })
  })
  const now = deps.now ?? (() => Date.now())
  const updateTmmVideoPath = async (tradeUrl: string, videoPath: string): Promise<boolean> => (
    deps.updateTmmTradeVideoPath?.(tradeUrl, videoPath).catch(() => false) ?? Promise.resolve(false)
  )
  let temporaryClipSequence = 0

  const nextTemporaryClipPath = (videoPath: string): string => {
    temporaryClipSequence += 1
    return `${videoPath}.tmp-${process.pid}-${now()}-${temporaryClipSequence}.mp4`
  }

  const listPendingClips = async (): Promise<ClipQueueItem[]> => {
    const settings = await deps.getSettings()
    const metadataFiles = await collectJsonFiles(resolve(settings.clip.outputDir))
    const items = await Promise.all(metadataFiles.map(parseMetadata))
    return items
      .filter((item): item is ClipQueueItem => item !== undefined)
      .sort((a, b) => b.createdAtMs - a.createdAtMs || basename(a.videoPath).localeCompare(basename(b.videoPath)))
  }

  const syncTmmTradeLinks = async (): Promise<SyncTmmTradeLinksResult> => {
    const settings = await deps.getSettings()
    const metadataFiles = await collectJsonFiles(resolve(settings.clip.outputDir))
    const entries = (await Promise.all(metadataFiles.map(async (metadataPath) => ({
      metadataPath,
      metadata: await parseTradeClipMetadata(metadataPath)
    }))))
      .filter((item): item is { metadataPath: string, metadata: TradeClipMetadata } => Boolean(
        item.metadata?.trade && item.metadata.trade.exchange !== 'TradeTools'
      ))
    const pending = entries.filter(({ metadata }) => !metadata.tmmTradeUrl)
    const changedPaths = new Set<string>()

    let links: Array<string | undefined> = []
    if (pending.length > 0) {
      try {
        const foundLinks = deps.findTmmTradeUrls
          ? await deps.findTmmTradeUrls(pending.map(({ metadata }) => metadata.trade))
          : await Promise.all(pending.map(({ metadata }) => deps.findTmmTradeUrl?.(metadata.trade).catch(() => undefined)))
        links = Array.isArray(foundLinks) ? foundLinks : []
      } catch {
        links = []
      }
    }

    let matchedCount = 0
    pending.forEach((entry, index) => {
      const tmmTradeUrl = links[index]
      if (!tmmTradeUrl) return
      entry.metadata = { ...entry.metadata, tmmTradeUrl }
      changedPaths.add(entry.metadataPath)
      matchedCount += 1
    })

    await Promise.all(entries.map(async (entry) => {
      const { metadata } = entry
      if (!metadata.tmmTradeUrl || metadata.tmmVideoPath === metadata.videoPath) return
      if (!await updateTmmVideoPath(metadata.tmmTradeUrl, metadata.videoPath)) return
      entry.metadata = { ...metadata, tmmVideoPath: metadata.videoPath }
      changedPaths.add(entry.metadataPath)
    }))

    await Promise.all(entries
      .filter(({ metadataPath }) => changedPaths.has(metadataPath))
      .map(({ metadataPath, metadata }) => writeFile(
        metadataPath,
        `${JSON.stringify(metadata, null, 2)}\n`,
        'utf8'
      )))
    return { checkedCount: pending.length, matchedCount }
  }

  const clearQueue = async (deleteFiles: boolean): Promise<ClearClipQueueResult> => {
    const settings = await deps.getSettings()
    const queueRoot = resolve(settings.clip.outputDir)
    const items = await listPendingClips()
    let deletedFileCount = 0

    for (const item of items) {
      const metadataPath = assertClipMetadataPath(settings, item.metadataPath)
      const videoPath = resolve(item.videoPath)
      if (deleteFiles && isPathInside(queueRoot, videoPath)) {
        await unlink(videoPath).then(() => {
          deletedFileCount += 1
        }).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
        })
      }
      await unlink(metadataPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    }

    return {
      ok: true,
      removedCount: items.length,
      deletedFileCount
    }
  }

  const createClipForClosedTrade = async (trade: ClosedTrade, options: CreateClipOptions = {}): Promise<ClipQueueItem> => {
    const settings = await deps.getSettings()
    const captureTarget = options.captureTarget ?? trade.recordingTarget
    const targetTrade: ClosedTrade = captureTarget
      ? { ...trade, recordingTarget: captureTarget }
      : trade
    // ponytail: match only real terminal trades; manual recordings have no TMM counterpart.
    const tmmTradeUrlPromise = targetTrade.exchange === 'TradeTools'
      ? Promise.resolve(undefined)
      : deps.findTmmTradeUrl?.(targetTrade).catch(() => undefined) ?? Promise.resolve(undefined)

    throwIfAborted(options.signal)
    const replaySave = await deps.saveReplayBuffer({
      settings,
      trade: targetTrade,
      ...(captureTarget ? { captureTarget } : {}),
      ...(options.signal ? { signal: options.signal } : {})
    })
    throwIfAborted(options.signal)
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
    const paths = buildClipOutputPaths(settings.clip.outputDir, targetTrade, captureTarget)
    const readyClip = replaySave.readyClip === true && settings.recording.mode === 'window'
    const expectedReadyClipDurationSeconds = targetTrade.exchange === 'TradeTools'
      ? replayDurationSeconds
      : Math.max(
          0.001,
          (targetTrade.exitTimeMs - targetTrade.entryTimeMs) / 1000 +
          settings.clip.paddingBeforeSeconds +
          settings.clip.paddingAfterSeconds
        )
    const trim = readyClip
      ? {
          startSeconds: 0,
          endSeconds: replayDurationSeconds,
          durationSeconds: replayDurationSeconds
        }
      : planReplayTrim({
          tradeEntryTimeMs: targetTrade.entryTimeMs,
          tradeExitTimeMs: targetTrade.exitTimeMs,
          replaySavedAtMs,
          replayDurationSeconds,
          paddingBeforeSeconds: settings.clip.paddingBeforeSeconds,
          paddingAfterSeconds: settings.clip.paddingAfterSeconds
        })

    await mkdir(paths.dayFolder, { recursive: true })
    let outputDetails: VideoDetails
    let metadataReplayPath = replayPath
    const temporaryVideoPath = nextTemporaryClipPath(paths.videoPath)
    try {
      throwIfAborted(options.signal)
      if (readyClip) {
        await copyFile(replayPath, temporaryVideoPath)
      } else {
        const ffmpegArgs = buildFfmpegTrimArgs({
          inputPath: replayPath,
          outputPath: temporaryVideoPath,
          startSeconds: trim.startSeconds,
          endSeconds: trim.endSeconds,
          mode: 'reencode',
          targetFrameRate: usableTargetFrameRate(replayDetails),
          platform: process.platform,
          videoEncoder: settings.recording.videoEncoder
        })
        await (options.signal ? runFfmpeg(ffmpegArgs, options.signal) : runFfmpeg(ffmpegArgs))
      }
      throwIfAborted(options.signal)
      outputDetails = await getVideoDetails(temporaryVideoPath)
      assertUsableFrameRate(outputDetails, 'Готовый клип')
      const outputDurationSeconds = outputDetails.durationSeconds
      const requiredOutputDurationSeconds = readyClip ? expectedReadyClipDurationSeconds : trim.durationSeconds
      if (outputDurationSeconds < minimumAcceptableOutputDuration(requiredOutputDurationSeconds)) {
        if (readyClip) {
          throw new Error(`Встроенная запись создала неполный видеоряд: ${outputDurationSeconds.toFixed(2)}с вместо ожидаемых ${requiredOutputDurationSeconds.toFixed(2)}с. Клип не добавлен, чтобы не сохранять зависший хвост.`)
        }
        throw new Error(`ffmpeg создал слишком короткий клип: ${outputDurationSeconds.toFixed(2)}с вместо ${requiredOutputDurationSeconds}с. Проверьте время сделки из API и длительность буфера записи.`)
      }
      await rename(temporaryVideoPath, paths.videoPath)
      if (readyClip) metadataReplayPath = paths.videoPath
    } catch (error) {
      await unlink(temporaryVideoPath).catch(() => undefined)
      throw error
    }
    const outputStat = await stat(paths.videoPath)
    const tmmTradeUrl = await tmmTradeUrlPromise
    const tmmVideoPathSynced = tmmTradeUrl
      ? await updateTmmVideoPath(tmmTradeUrl, paths.videoPath)
      : false

    const names = buildClipFileNames(targetTrade, captureTarget)
    const item: ClipQueueItem = {
      id: `${targetTrade.id}-${targetTrade.entryTimeMs}${captureTarget ? `-${captureTarget.id}` : ''}`,
      status: 'pending-review',
      title: names.title,
      fileName: names.videoFileName,
      videoPath: paths.videoPath,
      metadataPath: paths.metadataPath,
      symbol: targetTrade.symbol,
      side: targetTrade.side,
      exchange: targetTrade.exchange,
      marketType: targetTrade.marketType,
      entryTimeMs: targetTrade.entryTimeMs,
      exitTimeMs: targetTrade.exitTimeMs,
      durationSeconds: trim.durationSeconds,
      createdAtMs: now(),
      ...(tmmTradeUrl ? { tmmTradeUrl } : {}),
      ...(captureTarget ? { captureTarget } : {})
    }
    const metadata: TradeClipMetadata = {
      ...item,
      ...(tmmVideoPathSynced ? { tmmVideoPath: paths.videoPath } : {}),
      replayPath: metadataReplayPath,
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
      trade: targetTrade,
      ...(captureTarget ? { captureTarget } : {}),
      trim
    }

    await writeFile(paths.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
    if ((settings.recording.mode === 'obs' || readyClip) && resolve(replayPath) !== resolve(paths.videoPath)) {
      await unlink(replayPath).catch(() => undefined)
    }
    return item
  }

  return {
    async addFreeRecordingToQueue(input) {
      const settings = await deps.getSettings()
      const queueRoot = resolve(settings.clip.outputDir)
      const videoPath = resolve(input.videoPath)
      if (!isPathInside(queueRoot, videoPath)) throw new Error('Некорректный путь свободной записи')

      const videoStat = await stat(videoPath)
      const outputDetails = await getVideoDetails(videoPath)
      assertUsableFrameRate(outputDetails, 'Свободная запись')
      const title = input.fileName.replace(/\.[^.]+$/, '')
      const metadataPath = join(dirname(videoPath), `${basename(videoPath, extname(videoPath))}.json`)
      const trade: ClosedTrade = {
        id: `free-${input.startedAtMs}-${input.endedAtMs}`,
        exchange: 'TradeTools',
        marketType: 'Free recording',
        symbol: 'FREE',
        side: 'RECORD',
        status: 'closed',
        entryTimeMs: input.startedAtMs,
        exitTimeMs: input.endedAtMs
      }
      const item: ClipQueueItem = {
        id: trade.id,
        status: 'pending-review',
        title,
        fileName: input.fileName,
        videoPath,
        metadataPath,
        symbol: trade.symbol,
        side: trade.side,
        exchange: trade.exchange,
        marketType: trade.marketType,
        entryTimeMs: input.startedAtMs,
        exitTimeMs: input.endedAtMs,
        durationSeconds: input.durationSeconds,
        createdAtMs: now()
      }
      const metadata: TradeClipMetadata = {
        ...item,
        replayPath: videoPath,
        replaySavedAtMs: input.endedAtMs,
        replayDurationSeconds: input.durationSeconds,
        ...(outputDetails.averageFrameRate ? { replayFrameRate: outputDetails.averageFrameRate } : {}),
        outputDurationSeconds: outputDetails.durationSeconds || input.durationSeconds,
        ...(outputDetails.averageFrameRate ? { outputFrameRate: outputDetails.averageFrameRate } : {}),
        outputSizeBytes: videoStat.size,
        videoDiagnostics: {
          replay: outputDetails,
          output: outputDetails
        },
        trade,
        trim: {
          startSeconds: 0,
          endSeconds: input.durationSeconds,
          durationSeconds: input.durationSeconds
        }
      }

      await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
      return item
    },
    clearQueue: () => clearQueue(false),
    createClipForClosedTrade,
    async createManualBufferClip(input = {}) {
      const settings = await deps.getSettings()
      const requestedAtMs = input.requestedAtMs ?? now()
      const captureTarget = input.captureTarget
      const targetId = captureTarget?.id.replace(/[^a-z0-9:-]+/gi, '-') ?? 'default'
      const trade: ClosedTrade = {
        id: `manual-buffer-${requestedAtMs}-${targetId}`,
        exchange: 'TradeTools',
        marketType: 'Manual buffer',
        symbol: 'BUFFER',
        side: 'BUFFER',
        status: 'closed',
        entryTimeMs: requestedAtMs - Math.max(1, settings.clip.replayBufferSeconds) * 1000,
        exitTimeMs: requestedAtMs,
        ...(captureTarget ? { recordingTarget: captureTarget } : {}),
        manualTitle: 'Буфер TradeTools'
      }

      return createClipForClosedTrade(trade, input)
    },
    syncTmmTradeLinks,
    deleteQueueFiles: () => clearQueue(true),
    listPendingClips,
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
      const tmmVideoPathSynced = metadata.tmmTradeUrl
        ? await updateTmmVideoPath(metadata.tmmTradeUrl, nextVideoPath)
        : false
      const nextMetadata: TradeClipMetadata = {
        ...metadata,
        title: nextFileName.replace(/\.mp4$/i, ''),
        fileName: nextFileName,
        videoPath: nextVideoPath,
        metadataPath: resolvedMetadataPath,
        tmmVideoPath: tmmVideoPathSynced ? nextVideoPath : undefined
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
    },
    async deleteClipFile(metadataPath) {
      const settings = await deps.getSettings()
      const resolvedMetadataPath = assertClipMetadataPath(settings, metadataPath)
      const metadata = await parseTradeClipMetadata(resolvedMetadataPath)
      if (!metadata) throw new Error('Метаданные клипа не найдены')

      const videoPath = resolve(metadata.videoPath)
      const queueRoot = resolve(settings.clip.outputDir)
      if (!isPathInside(queueRoot, videoPath)) throw new Error('Некорректный путь видео клипа')

      await unlink(videoPath)
      await unlink(resolvedMetadataPath)
      return {
        ok: true,
        metadataPath: resolvedMetadataPath,
        videoPath
      }
    }
  }
}
