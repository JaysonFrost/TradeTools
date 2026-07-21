import { describe, expect, it } from 'vitest'
import type { ClipQueueItem } from '../../src/main/services/trades/tradeClipPipeline'
import { getClipDayGroups, getClipsForDate, getClipsForPeriod } from '../../src/renderer/lib/clipList'

const clip = (id: string, createdAtMs: number, title: string, durationSeconds: number): ClipQueueItem => ({
  id,
  status: 'pending-review',
  title,
  fileName: `${title}.mp4`,
  videoPath: `C:/clips/${id}.mp4`,
  metadataPath: `C:/clips/${id}.json`,
  symbol: '',
  side: '',
  exchange: '',
  marketType: '',
  entryTimeMs: createdAtMs,
  exitTimeMs: createdAtMs,
  durationSeconds,
  createdAtMs
})

describe('clip list helpers', () => {
  const mondayMorning = new Date(2026, 6, 20, 9).getTime()
  const mondayAfternoon = new Date(2026, 6, 20, 15).getTime()
  const tuesday = new Date(2026, 6, 21, 10).getTime()
  const previousSunday = new Date(2026, 6, 12, 12).getTime()
  const now = new Date(2026, 6, 21, 18)
  const clips = [
    clip('monday-zebra', mondayMorning, 'Zebra', 20),
    clip('monday-alpha', mondayAfternoon, 'Alpha', 90),
    clip('tuesday', tuesday, 'Bravo', 45),
    clip('previous-sunday', previousSunday, 'Archive', 120)
  ]

  it('selects clips for the day, week, month and an exact custom date', () => {
    expect(getClipsForPeriod(clips, 'day', now).map((item) => item.id)).toEqual(['tuesday'])
    expect(getClipsForPeriod(clips, 'week', now).map((item) => item.id)).toEqual(['monday-zebra', 'monday-alpha', 'tuesday'])
    expect(getClipsForPeriod(clips, 'month', now)).toHaveLength(4)
    expect(getClipsForDate(clips, '2026-07-20').map((item) => item.id)).toEqual(['monday-zebra', 'monday-alpha'])
  })

  it('splits clips into calendar-day sections and sorts each day', () => {
    expect(getClipDayGroups(clips, 'date', 'desc').map((group) => group.key)).toEqual([
      '2026-07-21',
      '2026-07-20',
      '2026-07-12'
    ])
    expect(getClipDayGroups(clips, 'name', 'asc')[1]?.clips.map((item) => item.id)).toEqual([
      'monday-alpha',
      'monday-zebra'
    ])
    expect(getClipDayGroups(clips, 'duration', 'desc')[1]?.clips.map((item) => item.id)).toEqual([
      'monday-alpha',
      'monday-zebra'
    ])
  })
})
