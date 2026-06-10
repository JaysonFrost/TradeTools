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
    tempDir = await mkdtemp(join(tmpdir(), 'TradeTools-settings-'))
    const store = createSettingsStore(tempDir)

    const settings = await store.load()

    expect(settings.language).toBe('ru')
    expect(settings.recording.mode).toBe('window')
    expect(settings.obs.host).toBe('127.0.0.1')
    expect(settings.clip.outputDir).toBe(join(tempDir, 'clips'))
  })

  it('persists normalized recording, OBS and clip settings without storing raw password', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'TradeTools-settings-'))
    const store = createSettingsStore(tempDir)

    const settings = await store.update({
      recording: {
        mode: 'window',
        sourceType: 'screen',
        windowSourceId: 'terminal-source',
        windowSourceName: 'Trading terminal',
        frameRate: 24,
        segmentSeconds: 3
      },
      clip: { paddingBeforeSeconds: 99, outputDir: '/Users/igor/Clips' },
      obs: { host: 'localhost', port: 4455, passwordConfigured: true }
    })

    expect(settings.recording).toEqual({
      mode: 'window',
      sourceType: 'screen',
      windowSourceId: 'terminal-source',
      windowSourceName: 'Trading terminal',
      frameRate: 24,
      segmentSeconds: 3
    })
    expect(settings.clip.paddingBeforeSeconds).toBe(60)
    expect(settings.clip.outputDir).toBe('/Users/igor/Clips')
    expect(settings.obs).toEqual({ host: 'localhost', port: 4455, passwordConfigured: true })

    const reloaded = await store.load()
    expect(reloaded).toEqual(settings)
  })

  it('persists Binance Futures configured flags without raw API credentials', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'TradeTools-settings-'))
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

  it('persists proxy metadata and system preferences without raw proxy passwords', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'TradeTools-settings-proxies-'))
    const store = createSettingsStore(tempDir)

    const settings = await store.update({
      system: {
        launchAtLogin: true,
        paymentReminderDaysBefore: 2
      },
      proxies: [{
        id: 'proxy-1',
        name: 'London proxy',
        server: 'gb.proxy.test:9000',
        login: 'trader',
        passwordConfigured: true,
        paymentDueDay: 15,
        dashboardUrl: 'https://proxy.example.com/account',
        notes: 'main futures account'
      }]
    })

    expect(settings.system.launchAtLogin).toBe(true)
    expect(settings.system.paymentReminderDaysBefore).toBe(2)
    expect(settings.proxies).toHaveLength(1)
    expect(JSON.stringify(settings)).not.toContain('raw-proxy-password')

    const reloaded = await store.load()
    expect(reloaded).toEqual(settings)
  })

  it('keeps active proxy runtime when updating unrelated settings', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'TradeTools-settings-runtime-'))
    const store = createSettingsStore(tempDir)

    await store.update({
      proxyRuntime: {
        activeStartProxyId: 'proxy-1',
        route: 'Edgecenter -> Vultr',
        entryHost: '92.38.129.126',
        entryPort: 443,
        localPort: 1083,
        entryUuidConfigured: true,
        configuredAtMs: 123
      }
    })

    const settings = await store.update({
      system: {
        launchAtLogin: true
      }
    })

    expect(settings.proxyRuntime).toMatchObject({
      activeStartProxyId: 'proxy-1',
      entryHost: '92.38.129.126',
      localPort: 1083,
      entryUuidConfigured: true
    })
  })
})
