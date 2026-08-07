import { describe, expect, it } from 'vitest'
import { selectedWindowTradeTarget } from '../../src/main/services/recording/tradeCaptureTargetSelection'
import { createDefaultSettings } from '../../src/main/services/settings/settings'

describe('selectedWindowTradeTarget', () => {
  it('keeps the selected HAPP window authoritative for a Vataga trade', () => {
    const settings = createDefaultSettings('C:/TradeTools')
    settings.recording.sourceType = 'window'
    settings.recording.windowSourceId = 'window:happ'
    settings.recording.windowSourceName = 'Happ 2.18.3 (573)'
    settings.recording.saveTargetId = 'window:happ'
    settings.recording.captureTargets = [{
      id: 'window:happ',
      name: 'Happ 2.18.3 (573)',
      type: 'window',
      processId: 51532
    }]

    expect(selectedWindowTradeTarget(settings, 'BEATUSDT')).toEqual({
      id: 'window:happ',
      name: 'Happ 2.18.3 (573)',
      type: 'window',
      processId: 51532,
      symbol: 'BEATUSDT'
    })
  })

  it('returns the saved target during a transient source-list miss', () => {
    const settings = createDefaultSettings('C:/TradeTools')
    settings.recording.windowSourceId = 'window:vataga'
    settings.recording.windowSourceName = 'Vataga.terminal'
    settings.recording.captureTargets = [{
      id: 'window:vataga',
      name: 'Vataga.terminal',
      type: 'window'
    }]

    expect(selectedWindowTradeTarget(settings, 'HEIUSDT')).toMatchObject({
      id: 'window:vataga',
      name: 'Vataga.terminal',
      symbol: 'HEIUSDT'
    })
  })

  it('never lets a stale Vataga save target override the explicit HAPP window', () => {
    const settings = createDefaultSettings('C:/TradeTools')
    settings.recording.windowSourceId = 'window:happ'
    settings.recording.windowSourceName = 'Happ 2.18.3 (573)'
    settings.recording.saveTargetId = 'window:vataga'
    settings.recording.captureTargets = [{
      id: 'window:vataga',
      name: 'Vataga.terminal',
      type: 'window'
    }]

    expect(selectedWindowTradeTarget(settings, 'BEATUSDT')).toEqual({
      id: 'window:happ',
      name: 'Happ 2.18.3 (573)',
      type: 'window',
      symbol: 'BEATUSDT'
    })
  })

  it('leaves terminal auto-discovery available when no window is configured', () => {
    expect(selectedWindowTradeTarget(createDefaultSettings('C:/TradeTools'), 'KOMAUSDT')).toBeUndefined()
  })
})
