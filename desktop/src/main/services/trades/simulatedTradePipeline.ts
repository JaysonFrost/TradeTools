import { buildClipOutputPaths } from '../video/clipPaths'
import { buildFfmpegTrimArgs } from '../video/ffmpegCommand'
import { planReplayTrim } from '../video/trimPlanner'
import type { CaptureTargetRef } from '../settings/settings'

export type ClosedTrade = {
  id: string
  exchange: string
  marketType: string
  symbol: string
  side: string
  status: 'closed'
  entryTimeMs: number
  exitTimeMs: number
  recordingTarget?: CaptureTargetRef
  manualTitle?: string
}

export type SimulatedClipInput = {
  dataDir: string
  replayPath: string
  replaySavedAtMs: number
  replayDurationSeconds: number
  paddingBeforeSeconds: number
  paddingAfterSeconds: number
  trade: ClosedTrade
}

export type SimulatedClipPlan = {
  trade: ClosedTrade
  dayFolder: string
  videoPath: string
  metadataPath: string
  ffmpegArgs: string[]
}

export const createSimulatedClosedTrade = (exitTimeMs: number, durationMs = 109_000): ClosedTrade => ({
  id: `sim-${exitTimeMs}`,
  exchange: 'BINANCE',
  marketType: 'FUTURES',
  symbol: 'BTCUSDT',
  side: 'LONG',
  status: 'closed',
  entryTimeMs: exitTimeMs - durationMs,
  exitTimeMs
})

export const planSimulatedClip = (input: SimulatedClipInput): SimulatedClipPlan => {
  const paths = buildClipOutputPaths(input.dataDir, input.trade)
  const trim = planReplayTrim({
    tradeEntryTimeMs: input.trade.entryTimeMs,
    tradeExitTimeMs: input.trade.exitTimeMs,
    replaySavedAtMs: input.replaySavedAtMs,
    replayDurationSeconds: input.replayDurationSeconds,
    paddingBeforeSeconds: input.paddingBeforeSeconds,
    paddingAfterSeconds: input.paddingAfterSeconds
  })

  return {
    trade: input.trade,
    ...paths,
    ffmpegArgs: buildFfmpegTrimArgs({
      inputPath: input.replayPath,
      outputPath: paths.videoPath,
      startSeconds: trim.startSeconds,
      endSeconds: trim.endSeconds,
      mode: 'reencode'
    })
  }
}
