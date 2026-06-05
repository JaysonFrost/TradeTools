import { describe, expect, it } from 'vitest'
import { planReplayTrim } from '../../src/main/services/video/trimPlanner'

describe('planReplayTrim', () => {
  it('calculates clip offsets from trade timestamps and replay duration', () => {
    const plan = planReplayTrim({
      tradeEntryTimeMs: Date.parse('2026-05-13T03:49:21.000Z'),
      tradeExitTimeMs: Date.parse('2026-05-13T03:51:10.000Z'),
      replaySavedAtMs: Date.parse('2026-05-13T03:51:12.000Z'),
      replayDurationSeconds: 1800,
      paddingBeforeSeconds: 3,
      paddingAfterSeconds: 5
    })

    expect(plan.startSeconds).toBe(1686)
    expect(plan.endSeconds).toBe(1800)
    expect(plan.durationSeconds).toBe(114)
  })

  it('clamps offsets to replay boundaries', () => {
    const plan = planReplayTrim({
      tradeEntryTimeMs: Date.parse('2026-05-13T03:21:13.000Z'),
      tradeExitTimeMs: Date.parse('2026-05-13T03:51:20.000Z'),
      replaySavedAtMs: Date.parse('2026-05-13T03:51:12.000Z'),
      replayDurationSeconds: 1800,
      paddingBeforeSeconds: 20,
      paddingAfterSeconds: 20
    })

    expect(plan.startSeconds).toBe(0)
    expect(plan.endSeconds).toBe(1800)
  })

  it('rejects invalid trade windows', () => {
    expect(() =>
      planReplayTrim({
        tradeEntryTimeMs: 2000,
        tradeExitTimeMs: 1000,
        replaySavedAtMs: 3000,
        replayDurationSeconds: 60,
        paddingBeforeSeconds: 3,
        paddingAfterSeconds: 5
      })
    ).toThrow('Trade exit must be after entry')
  })

  it('rejects trades outside the measured replay time window', () => {
    expect(() =>
      planReplayTrim({
        tradeEntryTimeMs: Date.parse('2026-05-13T03:40:00.000Z'),
        tradeExitTimeMs: Date.parse('2026-05-13T03:41:00.000Z'),
        replaySavedAtMs: Date.parse('2026-05-13T03:51:12.000Z'),
        replayDurationSeconds: 120,
        paddingBeforeSeconds: 3,
        paddingAfterSeconds: 5
      })
    ).toThrow('Сделка не попадает в окно OBS Replay Buffer')
  })
})
