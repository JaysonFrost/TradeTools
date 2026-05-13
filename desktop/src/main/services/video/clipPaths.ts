import { join } from 'node:path'

export type ClipPathTrade = {
  exchange: string
  marketType: string
  symbol: string
  side: string
  entryTimeMs: number
}

export type ClipFileNames = {
  videoFileName: string
  metadataFileName: string
}

export type ClipOutputPaths = {
  dayFolder: string
  videoPath: string
  metadataPath: string
}

const pad = (value: number): string => String(value).padStart(2, '0')

const formatDateParts = (timeMs: number): { day: string; timestamp: string } => {
  const date = new Date(timeMs)
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  const timestamp = `${day}_${pad(date.getUTCHours())}-${pad(date.getUTCMinutes())}-${pad(date.getUTCSeconds())}`
  return { day, timestamp }
}

const sanitizePart = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9-]+/g, '-')

export const buildClipFileNames = (trade: ClipPathTrade): ClipFileNames => {
  const { timestamp } = formatDateParts(trade.entryTimeMs)
  const stem = [
    timestamp,
    sanitizePart(trade.exchange),
    sanitizePart(trade.marketType),
    sanitizePart(trade.symbol),
    sanitizePart(trade.side)
  ].join('_')

  return {
    videoFileName: `${stem}.mp4`,
    metadataFileName: `${stem}.json`
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
