import type { AppSettings, CaptureTargetRef } from '../settings/settings'

export const selectedWindowTradeTarget = (
  settings: AppSettings,
  symbol: string
): CaptureTargetRef | undefined => {
  if (settings.recording.sourceType !== 'window') return undefined

  const selectedId = settings.recording.windowSourceId
  const selectedName = settings.recording.windowSourceName
  const selectedTarget = selectedId
    ? settings.recording.captureTargets.find((target) => target.type === 'window' && target.id === selectedId)
      ?? settings.recording.captureTargets.find((target) => target.type === 'window' && Boolean(selectedName) && target.name === selectedName)
    : settings.recording.captureTargets.find((target) => target.type === 'window' && Boolean(selectedName) && target.name === selectedName)

  if (selectedTarget) return { ...selectedTarget, symbol }
  if (selectedId) {
    return {
      id: selectedId,
      name: selectedName || 'Выбранное окно',
      type: 'window',
      symbol
    }
  }
  if (selectedName) return undefined

  const savedTarget = settings.recording.captureTargets.find((target) => (
    target.type === 'window' && target.id === settings.recording.saveTargetId
  ))
  if (savedTarget) return { ...savedTarget, symbol }

  return undefined
}
