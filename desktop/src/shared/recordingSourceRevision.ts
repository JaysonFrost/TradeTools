import type { AppSettings } from '../main/services/settings/settings'

export const recordingSourceRevision = (recording: AppSettings['recording']): string => JSON.stringify({
  mode: recording.mode,
  sourceType: recording.sourceType,
  windowSourceId: recording.windowSourceId,
  windowSourceName: recording.windowSourceName,
  captureTargets: recording.captureTargets.map((target) => [
    target.id,
    target.name,
    target.type,
    target.displayId ?? '',
    target.processId ?? 0,
    target.symbol ?? ''
  ]),
  saveTargetMode: recording.saveTargetMode,
  saveTargetId: recording.saveTargetId
})
