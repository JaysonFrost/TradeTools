import { join } from 'node:path'

export type ClipPathTrade = {
  exchange: string
  marketType: string
  symbol: string
  side: string
  entryTimeMs: number
}

export type ClipFileNames = {
  title: string
  videoFileName: string
  metadataFileName: string
}

export type ClipOutputPaths = {
  dayFolder: string
  videoPath: string
  metadataPath: string
}

const pad = (value: number): string => String(value).padStart(2, '0')

const formatDateParts = (timeMs: number): { day: string; titleTimestamp: string } => {
  const date = new Date(timeMs)
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const titleTimestamp = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${String(date.getFullYear()).slice(-2)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return { day, titleTimestamp }
}

const formatSymbol = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]+/g, '')

const formatExchange = (value: string): string => {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (!cleaned) return 'Exchange'

  return cleaned
    .split(/\s+/)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export const buildClipFileNames = (trade: ClipPathTrade): ClipFileNames => {
  const { titleTimestamp } = formatDateParts(trade.entryTimeMs)
  const title = `${formatSymbol(trade.symbol)} ${formatExchange(trade.exchange)} ${titleTimestamp}`

  return {
    title,
    videoFileName: `${title}.mp4`,
    metadataFileName: `${title}.json`
  }
}

export const buildClipOutputPaths = (dataDir: string, trade: ClipPathTrade): ClipOutputPaths => {
  const { day } = formatDateParts(trade.entryTimeMs)
  const names = buildClipFileNames(trade)
  const dayFolder = join(dataDir, 'clips', day)

  return {
    dayFolder,
    videoPath: join(dayFolder, names.videoFileName),
    metadataPath: join(dayFolder, names.metadataFileName)
  }
}
