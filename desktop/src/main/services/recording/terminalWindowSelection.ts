const normalizeTerminalTitleToken = (value: string): string => value.replace(/[^a-z0-9]/gi, '').toUpperCase()

const tickerCharacterPattern = (ticker: string): string => (
  normalizeTerminalTitleToken(ticker).split('').join('[^A-Z0-9]*')
)

export const terminalTitleMatchesTicker = (title: string, ticker: string): boolean => {
  const normalizedTicker = normalizeTerminalTitleToken(ticker)
  if (!normalizedTicker) return false

  const separatedTickerPattern = tickerCharacterPattern(normalizedTicker)
  return new RegExp(`(?:^|[^A-Z0-9])${separatedTickerPattern}(?=$|[^A-Z0-9])`, 'i').test(title)
}

const terminalTitleContainsTickerCharacters = (title: string, ticker: string): boolean => {
  const pattern = tickerCharacterPattern(ticker)
  return Boolean(pattern) && new RegExp(pattern, 'i').test(title)
}

type RecordingSourceRef = {
  sourceId: string
  sourceName: string
  processId?: number
}

type RecordingTargetRef = {
  id: string
  name: string
  processId?: number
  symbol?: string
}

export const recordingSourceMatchesTarget = (source: RecordingSourceRef, target: RecordingTargetRef): boolean => {
  if (source.sourceId === target.id || source.sourceName === target.name) return true

  return Boolean(
    source.processId &&
    target.processId &&
    source.processId === target.processId &&
    terminalTitleMatchesTicker(source.sourceName, target.symbol ?? '')
  )
}

export const preferTerminalSourcesForSymbol = <T extends { name: string }>(symbol: string, sources: T[]): T[] => {
  const normalizedSymbol = normalizeTerminalTitleToken(symbol)
  if (!normalizedSymbol) return sources

  const symbolSources = sources.filter((source) => terminalTitleMatchesTicker(source.name, symbol))
  if (symbolSources.length > 0) return symbolSources

  return sources.filter((source) => !terminalTitleContainsTickerCharacters(source.name, normalizedSymbol))
}
