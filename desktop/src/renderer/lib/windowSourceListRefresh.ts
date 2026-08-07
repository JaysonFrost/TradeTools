import type { WindowCaptureSource } from '../../main/services/recording/windowRecorderService'

export const refreshWindowSourceList = async (
  listSources: () => Promise<WindowCaptureSource[]>,
  applySources: (sources: WindowCaptureSource[]) => void
): Promise<WindowCaptureSource[]> => {
  const sources = await listSources()
  applySources(sources)
  return sources
}
