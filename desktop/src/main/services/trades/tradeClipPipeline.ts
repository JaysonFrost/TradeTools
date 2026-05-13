import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { AppSettings } from '../settings/settings'
import { buildFfmpegTrimArgs } from '../video/ffmpegCommand'
import { buildClipFileNames, buildClipOutputPaths } from '../video/clipPaths'
import { findNewestReplayFile } from '../video/replayFileFinder'
import { planReplayTrim } from '../video/trimPlanner'
import type { ClosedTrade } from './simulatedTradePipeline'

export type ClipReviewStatus = 'pending-review'

export type ClipQueueItem = {
  id: string
  status: ClipReviewStatus
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
}

export type TradeClipPipelineDeps = {
  getSettings: () => Promise<AppSettings>
  saveReplayBuffer: () => Promise<SaveReplayBufferResult>
  runFfmpeg?: (args: string[]) => Promise<void>
  now?: () => number
}

export type TradeClipPipeline = {
  createClipForClosedTrade: (trade: ClosedTrade) => Promise<ClipQueueItem>
  listPendingClips: () => Promise<ClipQueueItem[]>
}

const parseMetadata = async (metadataPath: string): Promise<ClipQueueItem | undefined> => {
  try {
    const parsed = JSON.parse(await readFile(metadataPath, 'utf8')) as ClipQueueItem
    if (parsed.status !== 'pending-review') return undefined
    return parsed
  } catch {
    return undefined
  }
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

export const createTradeClipPipeline = (deps: TradeClipPipelineDeps): TradeClipPipeline => {
  const runFfmpeg = deps.runFfmpeg ?? (async (args) => {
    const { spawn } = await import('node:child_process')
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', args, { stdio: 'ignore' })
      child.on('error', reject)
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code ?? 'unknown'}`)))
    })
  })
  const now = deps.now ?? (() => Date.now())

  return {
    async createClipForClosedTrade(trade) {
      const settings = await deps.getSettings()
      const replaySave = await deps.saveReplayBuffer()
      if (!replaySave.ok) throw new Error(replaySave.message)

      const replayPath = await findNewestReplayFile({
        directory: settings.clip.replaySourceDir,
        afterMs: replaySave.requestedAtMs
      })
      if (!replayPath) throw new Error('OBS сохранил Replay Buffer, но свежий replay-файл не найден')

      const replayStat = await import('node:fs/promises').then(({ stat }) => stat(replayPath))
      const paths = buildClipOutputPaths(settings.clip.outputDir, trade)
      const trim = planReplayTrim({
        tradeEntryTimeMs: trade.entryTimeMs,
        tradeExitTimeMs: trade.exitTimeMs,
        replaySavedAtMs: replayStat.mtimeMs,
        replayDurationSeconds: settings.clip.replayBufferSeconds,
        paddingBeforeSeconds: settings.clip.paddingBeforeSeconds,
        paddingAfterSeconds: settings.clip.paddingAfterSeconds
      })
      const ffmpegArgs = buildFfmpegTrimArgs({
        inputPath: replayPath,
        outputPath: paths.videoPath,
        startSeconds: trim.startSeconds,
        endSeconds: trim.endSeconds,
        mode: 'copy'
      })

      await mkdir(paths.dayFolder, { recursive: true })
      await runFfmpeg(ffmpegArgs)

      const names = buildClipFileNames(trade)
      const item: ClipQueueItem = {
        id: `${trade.id}-${trade.entryTimeMs}`,
        status: 'pending-review',
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
    }
  }
}
