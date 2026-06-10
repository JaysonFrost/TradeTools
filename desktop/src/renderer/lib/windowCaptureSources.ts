import type { WindowCaptureSource } from '../../main/services/recording/windowRecorderService'

const terminalNamePatterns = [
  /vataga/i,
  /ватага/i,
  /tiger(\.trade|trade)?/i,
  /тигр/i,
  /metascalp/i,
  /meta\s?trader|mt4|mt5/i,
  /terminal/i,
  /терминал/i,
  /binance/i,
  /bybit/i,
  /okx/i,
  /tradingview/i,
  /trading|trade/i,
  /торг/i,
  /quantower/i,
  /cscalp/i,
  /atas/i,
  /quik/i,
  /dxtrade/i
]

const ignoredWindowPatterns = [
  /tradetools/i,
  /tradeclipper/i,
  /codex/i,
  /electron/i,
  /devtools/i
]

const scoreTerminalSource = (source: WindowCaptureSource): number => {
  if (source.type !== 'window') return 0
  if (ignoredWindowPatterns.some((pattern) => pattern.test(source.name))) return -100

  const patternScore = terminalNamePatterns.reduce((score, pattern, index) => (
    pattern.test(source.name) ? Math.max(score, 100 - index) : score
  ), 0)

  return patternScore
}

export const findPreferredTerminalSource = (sources: WindowCaptureSource[]): WindowCaptureSource | undefined => {
  const windowSources = sources.filter((source) => source.type === 'window')
  const rankedSources = sources
    .filter((source) => source.type === 'window')
    .map((source, index) => ({ source, index, score: scoreTerminalSource(source) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)

  if (rankedSources[0]?.source) return rankedSources[0].source

  const nonIgnoredSources = windowSources.filter((source) => !ignoredWindowPatterns.some((pattern) => pattern.test(source.name)))
  return nonIgnoredSources.length === 1 ? nonIgnoredSources[0] : undefined
}
