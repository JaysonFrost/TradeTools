import { join } from 'node:path'

export type ClipPathTrade = {
  exchange: string
  marketType: string
  symbol: string
  side: string
  entryTimeMs: number
  manualTitle?: string
}

export type ClipPathCaptureTarget = {
  id?: string
  name: string
  type?: string
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

const formatCaptureTargetSuffix = (captureTarget?: ClipPathCaptureTarget): string => {
  const name = captureTarget?.name.trim()
  return name ? ` - ${name}` : ''
}

const formatOutputSequenceSuffix = (outputSequence: number): string => {
  const sequence = Number.isFinite(outputSequence) ? Math.max(1, Math.trunc(outputSequence)) : 1
  return sequence > 1 ? ` (${sequence})` : ''
}

export const toSafeClipFileBaseName = (value: string): string => {
  return value
    .replace(/\.mp4$/iu, '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
}

export const buildClipFileNames = (
  trade: ClipPathTrade,
  captureTarget?: ClipPathCaptureTarget,
  outputSequence = 1
): ClipFileNames => {
  const { titleTimestamp } = formatDateParts(trade.entryTimeMs)
  const titlePrefix = trade.manualTitle?.trim() || `${formatSymbol(trade.symbol)} ${formatExchange(trade.exchange)}`.trim()
  const title = `${titlePrefix} ${titleTimestamp}${formatCaptureTargetSuffix(captureTarget)}`
  const safeFileName = toSafeClipFileBaseName(title)
  const outputSequenceSuffix = formatOutputSequenceSuffix(outputSequence)

  return {
    title,
    videoFileName: `${safeFileName}${outputSequenceSuffix}.mp4`,
    metadataFileName: `${safeFileName}${outputSequenceSuffix}.json`
  }
}

export const buildClipOutputPaths = (
  dataDir: string,
  trade: ClipPathTrade,
  captureTarget?: ClipPathCaptureTarget,
  outputSequence = 1
): ClipOutputPaths => {
  const { day } = formatDateParts(trade.entryTimeMs)
  const names = buildClipFileNames(trade, captureTarget, outputSequence)
  const dayFolder = join(dataDir, day)

  return {
    dayFolder,
    videoPath: join(dayFolder, names.videoFileName),
    metadataPath: join(dayFolder, names.metadataFileName)
  }
}
