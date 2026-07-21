import type { ClipQueueItem } from '../../main/services/trades/tradeClipPipeline'

export type ClipPeriod = 'day' | 'week' | 'month'
export type ClipSortKey = 'date' | 'name' | 'duration'
export type ClipSortDirection = 'asc' | 'desc'

export type ClipDayGroup = {
  key: string
  label: string
  clips: ClipQueueItem[]
}

const dateKey = (value: number | Date): string => {
  const date = typeof value === 'number' ? new Date(value) : value
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const startOfDay = (value: Date): Date => new Date(value.getFullYear(), value.getMonth(), value.getDate())

const compareValues = (left: number | string, right: number | string): number => (
  typeof left === 'string' && typeof right === 'string'
    ? left.localeCompare(right, 'ru', { sensitivity: 'base' })
    : Number(left) - Number(right)
)

const compareClips = (sort: ClipSortKey, direction: ClipSortDirection) => (left: ClipQueueItem, right: ClipQueueItem): number => {
  const multiplier = direction === 'asc' ? 1 : -1
  const comparison = sort === 'name'
    ? compareValues(left.title, right.title)
    : sort === 'duration'
      ? compareValues(left.durationSeconds, right.durationSeconds)
      : compareValues(left.createdAtMs, right.createdAtMs)
  if (comparison !== 0) return comparison * multiplier

  return compareValues(right.createdAtMs, left.createdAtMs) || left.metadataPath.localeCompare(right.metadataPath)
}

export const getClipsForPeriod = (clips: ClipQueueItem[], period: ClipPeriod, now = new Date()): ClipQueueItem[] => {
  const today = startOfDay(now)
  if (period === 'day') return clips.filter((clip) => dateKey(clip.createdAtMs) === dateKey(today))

  if (period === 'month') {
    return clips.filter((clip) => {
      const date = new Date(clip.createdAtMs)
      return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth()
    })
  }

  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - (today.getDay() + 6) % 7)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 7)
  return clips.filter((clip) => clip.createdAtMs >= weekStart.getTime() && clip.createdAtMs < weekEnd.getTime())
}

export const getClipsForDate = (clips: ClipQueueItem[], selectedDate: string): ClipQueueItem[] => (
  selectedDate ? clips.filter((clip) => dateKey(clip.createdAtMs) === selectedDate) : []
)

export const getClipDayGroups = (clips: ClipQueueItem[], sort: ClipSortKey, direction: ClipSortDirection): ClipDayGroup[] => {
  const groups = new Map<string, ClipQueueItem[]>()
  for (const clip of clips) {
    const key = dateKey(clip.createdAtMs)
    groups.set(key, [...(groups.get(key) ?? []), clip])
  }

  const dayDirection = sort === 'date' ? direction : 'desc'
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right) * (dayDirection === 'asc' ? 1 : -1))
    .map(([key, dayClips]) => {
      const [year, month, day] = key.split('-').map(Number)
      return {
        key,
        label: new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
          .format(new Date(year, (month ?? 1) - 1, day ?? 1)),
        clips: [...dayClips].sort(compareClips(sort, direction))
      }
    })
}
