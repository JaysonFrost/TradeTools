import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { createSettingsStore } from '../../src/main/services/settings/settingsStore'

let tempDir: string | undefined

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

describe('settingsStore', () => {
  it('loads defaults when settings file does not exist', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'tradecut-settings-'))
    const store = createSettingsStore(tempDir)

    const settings = await store.load()

    expect(settings.language).toBe('ru')
    expect(settings.obs.host).toBe('127.0.0.1')
    expect(settings.clip.outputDir).toBe(join(tempDir, 'clips'))
  })

  it('persists normalized OBS and clip settings without storing raw password', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'tradecut-settings-'))
    const store = createSettingsStore(tempDir)

    const settings = await store.update({
      clip: { paddingBeforeSeconds: 99, outputDir: '/Users/igor/Clips' },
      obs: { host: 'localhost', port: 4455, passwordConfigured: true }
    })

    expect(settings.clip.paddingBeforeSeconds).toBe(60)
    expect(settings.clip.outputDir).toBe('/Users/igor/Clips')
    expect(settings.obs).toEqual({ host: 'localhost', port: 4455, passwordConfigured: true })

    const reloaded = await store.load()
    expect(reloaded).toEqual(settings)
  })

  it('persists Binance Futures configured flags without raw API credentials', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'tradecut-settings-'))
    const store = createSettingsStore(tempDir)

    const settings = await store.update({
      exchange: {
        binanceFutures: {
          enabled: true,
          testnet: true,
          apiKeyConfigured: true,
          apiSecretConfigured: true
        }
      }
    })

    expect(settings.exchange.binanceFutures).toEqual({
      enabled: true,
      testnet: true,
      apiKeyConfigured: true,
      apiSecretConfigured: true
    })

    const reloaded = await store.load()
    expect(JSON.stringify(reloaded)).not.toContain('binance-key')
    expect(JSON.stringify(reloaded)).not.toContain('binance-secret')
    expect(reloaded).toEqual(settings)
  })
})
