import { describe, expect, it } from 'vitest'
import { createDefaultSettings, normalizeSettings } from '../../src/main/services/settings/settings'

describe('settings', () => {
  it('creates Russian-first defaults for clip automation and planned subscription gates', () => {
    const settings = createDefaultSettings('/Users/igor/Library/Application Support/Trade Clipper')

    expect(settings.language).toBe('ru')
    expect(settings.clip.paddingBeforeSeconds).toBe(3)
    expect(settings.clip.paddingAfterSeconds).toBe(5)
    expect(settings.clip.outputDir).toBe('/Users/igor/Library/Application Support/Trade Clipper/clips')
    expect(settings.access.subscriptionRequired).toBe(true)
    expect(settings.access.telegramBotRequired).toBe(true)
    expect(settings.access.discordGuildGateEnabled).toBe(true)
  })

  it('normalizes unsafe clip padding and keeps user output folder', () => {
    const settings = normalizeSettings({
      language: 'en',
      clip: { paddingBeforeSeconds: -5, paddingAfterSeconds: 600, replayBufferSeconds: 30, outputDir: '/clips' }
    }, '/app-data')

    expect(settings.language).toBe('ru')
    expect(settings.clip.paddingBeforeSeconds).toBe(0)
    expect(settings.clip.paddingAfterSeconds).toBe(60)
    expect(settings.clip.replayBufferSeconds).toBe(120)
    expect(settings.clip.outputDir).toBe('/clips')
  })
})
