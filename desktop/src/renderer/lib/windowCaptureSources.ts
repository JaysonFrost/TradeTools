import type { WindowCaptureSource } from '../../main/services/recording/windowRecorderService'
import { isSupportedTerminalWindowName } from '../../shared/supportedTerminalWindows'

const ignoredWindowPatterns = [
  /tradetools/i,
  /tradeclipper/i,
  /codex/i,
  /electron/i,
  /devtools/i
]

export const isAutoRecordedTerminalSource = (source: WindowCaptureSource): boolean => (
  source.type === 'window' &&
  !ignoredWindowPatterns.some((pattern) => pattern.test(source.name)) &&
  isSupportedTerminalWindowName(source.name)
)

export const findAutoRecordedTerminalSources = (sources: WindowCaptureSource[]): WindowCaptureSource[] => {
  const sourceIds = new Set<string>()
  return sources.filter((source) => {
    if (!isAutoRecordedTerminalSource(source) || sourceIds.has(source.id)) return false
    sourceIds.add(source.id)
    return true
  })
}

export const findPreferredTerminalSource = (sources: WindowCaptureSource[]): WindowCaptureSource | undefined => {
  return findAutoRecordedTerminalSources(sources)[0]
}
