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

export type RecordingSourceRef = {
  sourceId: string
  sourceName: string
  processId?: number
}

export type RecordingTargetRef = {
  id: string
  name: string
  processId?: number
  symbol?: string
}

const distinctSourceIds = (sources: RecordingSourceRef[]): Set<string> => new Set(
  sources.map((source) => source.sourceId)
)

const uniquelyIdentifiedSources = <T extends RecordingSourceRef>(sources: T[]): T[] => (
  distinctSourceIds(sources).size === 1 ? sources : []
)

export const recordingSourcesMatchingTarget = <T extends RecordingSourceRef>(
  sources: T[],
  target: RecordingTargetRef
): T[] => {
  const exactIdMatches = target.id
    ? sources.filter((source) => source.sourceId === target.id)
    : []
  if (exactIdMatches.length > 0) return exactIdMatches

  const targetProcessId = target.processId
  const processMatches = targetProcessId
    ? sources.filter((source) => source.processId === targetProcessId)
    : []
  const processAndTickerMatches = target.symbol
    ? processMatches.filter((source) => terminalTitleMatchesTicker(source.sourceName, target.symbol ?? ''))
    : []
  const uniqueProcessAndTickerMatches = uniquelyIdentifiedSources(processAndTickerMatches)
  if (uniqueProcessAndTickerMatches.length > 0) return uniqueProcessAndTickerMatches

  const nameMatches = target.name
    ? sources.filter((source) => source.sourceName === target.name)
    : []
  const sameNameProcessMatches = targetProcessId
    ? nameMatches.filter((source) => source.processId === targetProcessId)
    : []
  const uniqueSameNameProcessMatches = uniquelyIdentifiedSources(sameNameProcessMatches)
  if (uniqueSameNameProcessMatches.length > 0) return uniqueSameNameProcessMatches

  return uniquelyIdentifiedSources(nameMatches)
}

export const recordingSourceMatchesTarget = (
  source: RecordingSourceRef,
  target: RecordingTargetRef,
  availableSources: RecordingSourceRef[]
): boolean => {
  const matchingSources = recordingSourcesMatchingTarget(availableSources, target)
  return matchingSources.some((candidate) => candidate.sourceId === source.sourceId)
}

type TerminalWindowCandidate = {
  name: string
  processId?: number
  bounds?: {
    x: number
    y: number
    width: number
    height: number
  }
}

type TerminalWindowSelection = {
  source?: TerminalWindowCandidate
  candidates: TerminalWindowCandidate[]
  reason: 'process' | 'symbol' | 'cursor' | 'first' | 'ambiguous' | 'none'
}

const windowContainsPoint = (
  source: TerminalWindowCandidate,
  point: { x: number, y: number }
): boolean => {
  const bounds = source.bounds
  return Boolean(bounds) &&
    point.x >= bounds!.x &&
    point.x < bounds!.x + bounds!.width &&
    point.y >= bounds!.y &&
    point.y < bounds!.y + bounds!.height
}

export const selectTerminalWindowSource = <T extends TerminalWindowCandidate>(
  event: { symbol: string, processId?: number },
  terminalSources: T[],
  cursorPoint?: { x: number, y: number }
): Omit<TerminalWindowSelection, 'source' | 'candidates'> & { source?: T, candidates: T[] } => {
  const processCandidates = event.processId
    ? terminalSources.filter((candidate) => candidate.processId === event.processId)
    : []
  const processScopedCandidates = processCandidates.length > 0 ? processCandidates : terminalSources
  const candidates = preferTerminalSourcesForSymbol(event.symbol, processScopedCandidates)
  if (candidates.length === 0) return { candidates, reason: 'none' }
  if (candidates.length === 1) {
    const reason = processScopedCandidates.length > candidates.length
      ? 'symbol'
      : processCandidates.length > 0
        ? 'process'
        : 'first'
    return { source: candidates[0], candidates, reason }
  }

  const cursorSource = cursorPoint
    ? candidates.find((candidate) => windowContainsPoint(candidate, cursorPoint))
    : undefined
  if (cursorSource) return { source: cursorSource, candidates, reason: 'cursor' }

  const candidateNames = new Set(candidates.map((candidate) => candidate.name.trim().toLocaleLowerCase()))
  if (candidateNames.size === 1) return { source: candidates[0], candidates, reason: 'first' }

  return { candidates, reason: 'ambiguous' }
}

export const preferTerminalSourcesForSymbol = <T extends { name: string }>(symbol: string, sources: T[]): T[] => {
  const normalizedSymbol = normalizeTerminalTitleToken(symbol)
  if (!normalizedSymbol) return sources

  const symbolSources = sources.filter((source) => terminalTitleMatchesTicker(source.name, symbol))
  if (symbolSources.length > 0) return symbolSources

  return sources.filter((source) => !terminalTitleContainsTickerCharacters(source.name, normalizedSymbol))
}
