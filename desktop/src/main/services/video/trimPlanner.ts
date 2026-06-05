export type ReplayTrimInput = {
  tradeEntryTimeMs: number
  tradeExitTimeMs: number
  replaySavedAtMs: number
  replayDurationSeconds: number
  paddingBeforeSeconds: number
  paddingAfterSeconds: number
  clockToleranceSeconds?: number
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
  const replayEndTimeMs = input.replaySavedAtMs
  const clockToleranceMs = (input.clockToleranceSeconds ?? 5) * 1000
  if (input.tradeExitTimeMs < replayStartTimeMs - clockToleranceMs || input.tradeEntryTimeMs > replayEndTimeMs + clockToleranceMs) {
    throw new Error('Сделка не попадает в окно OBS Replay Buffer. Проверьте длительность Replay Buffer в OBS и время сделки из API.')
  }

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
