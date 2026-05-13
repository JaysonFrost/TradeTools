export type ReplayTrimInput = {
  tradeEntryTimeMs: number
  tradeExitTimeMs: number
  replaySavedAtMs: number
  replayDurationSeconds: number
  paddingBeforeSeconds: number
  paddingAfterSeconds: number
}

export type ReplayTrimPlan = {
  startSeconds: number
  endSeconds: number
  durationSeconds: number
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

export const planReplayTrim = (input: ReplayTrimInput): ReplayTrimPlan => {
  if (input.tradeExitTimeMs <= input.tradeEntryTimeMs) {
    throw new Error('Trade exit must be after entry')
  }

  if (input.replayDurationSeconds <= 0) {
    throw new Error('Replay duration must be positive')
  }

  const replayStartTimeMs = input.replaySavedAtMs - input.replayDurationSeconds * 1000
  const rawStartSeconds = (input.tradeEntryTimeMs - replayStartTimeMs) / 1000 - input.paddingBeforeSeconds
  const rawEndSeconds = (input.tradeExitTimeMs - replayStartTimeMs) / 1000 + input.paddingAfterSeconds
  const startSeconds = Math.floor(clamp(rawStartSeconds, 0, input.replayDurationSeconds))
  const endSeconds = Math.ceil(clamp(rawEndSeconds, startSeconds, input.replayDurationSeconds))

  return {
    startSeconds,
    endSeconds,
    durationSeconds: endSeconds - startSeconds
  }
}
