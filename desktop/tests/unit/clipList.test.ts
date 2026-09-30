import { describe, expect, it } from 'vitest'
import type { ClipQueueItem } from '../../src/main/services/trades/tradeClipPipeline'
import { filterClips, getClipDayGroups, getClipsForDate, getClipsForPeriod } from '../../src/renderer/lib/clipList'

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

  it('shows only the three newest clips in a compact preview', () => {
    const preview = getClipDayGroups(clips, 'date', 'desc', 0, 3).flatMap((group) => group.clips)
    expect(preview.map((item) => item.id)).toEqual(['tuesday', 'monday-alpha', 'monday-zebra'])
    expect(clips.map((item) => item.id)).toEqual(['monday-zebra', 'monday-alpha', 'tuesday', 'previous-sunday'])
  })

  it('pages a large archive across day boundaries without skipping or repeating clips', () => {
    const archive = Array.from({ length: 103 }, (_, index) => clip(String(index), mondayMorning + index * 3_600_000, `Video ${index}`, index))
    const ordered = getClipDayGroups(archive, 'date', 'desc').flatMap((group) => group.clips)
    const pages = Array.from({ length: 6 }, (_, page) => getClipDayGroups(archive, 'date', 'desc', page * 20, 20).flatMap((group) => group.clips))
    expect(pages.map((page) => page.length)).toEqual([20, 20, 20, 20, 20, 3])
    expect(pages.flat()).toEqual(ordered)
    expect(getClipDayGroups([], 'date', 'desc', 0, 20)).toEqual([])
    expect(getClipDayGroups(archive, 'date', 'desc', archive.length, 20)).toEqual([])
  })

  it('keeps the selected sort order when a page starts within a day', () => {
    expect(getClipDayGroups(clips, 'name', 'asc', 1, 2).flatMap((group) => group.clips).map((item) => item.id)).toEqual(['monday-alpha', 'monday-zebra'])
    expect(getClipDayGroups(clips, 'date', 'asc', 1, 2).flatMap((group) => group.clips).map((item) => item.id)).toEqual(['monday-zebra', 'monday-alpha'])
  })

  it('filters clips by a pasted path, file name, trade fields and local date', () => {
    const createdAtMs = new Date(2026, 7, 6, 13, 19).getTime()
    const btcClip: ClipQueueItem = {
      ...clip('btc', createdAtMs, 'BTC scalp', 42),
      fileName: 'BTCUSDT Binance 06.08.26 13-19-00.mp4',
      videoPath: 'C:\\Users\\Igor\\Trade Clips\\BTCUSDT Binance 06.08.26 13-19-00.mp4',
      symbol: 'BTCUSDT',
      exchange: 'Binance',
      side: 'LONG',
      marketType: 'Futures',
      tmmTradeUrl: 'https://tradermake.money/app2/account/my-trades/91'
    }
    const ethClip: ClipQueueItem = {
      ...clip('eth', new Date(2026, 7, 5, 8, 4).getTime(), 'ETH review', 30),
      symbol: 'ETHUSDT'
    }
    const searchable = [btcClip, ethClip]

    expect(filterClips(searchable, '')).toEqual(searchable)
    expect(filterClips(searchable, 'c:\\users\\igor\\trade clips\\btcusdt')).toEqual([btcClip])
    expect(filterClips(searchable, 'C:/USERS/IGOR/TRADE CLIPS/BTCUSDT')).toEqual([btcClip])
    expect(filterClips(searchable, 'binance LONG 06.08.2026 13:19')).toEqual([btcClip])
    expect(filterClips(searchable, '06.08.26')).toEqual([btcClip])
    expect(filterClips(searchable, 'eth review')).toEqual([ethClip])
  })
})
