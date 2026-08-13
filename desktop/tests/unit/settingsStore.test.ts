import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { createSettingsStore } from '../../src/main/services/settings/settingsStore'
import { recordingSourceRevision } from '../../src/shared/recordingSourceRevision'

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
    expect(settings.tradeSource.mode).toBe('terminal-window')
    expect(settings).not.toHaveProperty('obs')
    expect(settings.clip.outputDir).toBe(join(tempDir, 'clips'))
  })

  it('persists normalized built-in recording and clip settings', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'TradeTools-settings-'))
    const store = createSettingsStore(tempDir)

    const settings = await store.update({
      recording: {
        mode: 'window',
        sourceType: 'screen',
        windowSourceId: 'screen:1',
        windowSourceName: 'Trading terminal',
        resolutionPreset: '1080p',
        frameRate: 24,
        segmentSeconds: 3,
        systemAudioEnabled: true,
        microphoneEnabled: true
      },
      clip: { paddingBeforeSeconds: 99, outputDir: '/Users/igor/Clips' }
    })

    expect(settings.recording).toEqual({
      mode: 'window',
      sourceType: 'screen',
      windowSourceId: 'screen:1',
      windowSourceName: 'Trading terminal',
      captureTargets: [{
        id: 'screen:1',
        name: 'Trading terminal',
        type: 'screen'
      }],
      saveTargetMode: 'all',
      saveTargetId: 'screen:1',
      saveTradeDisplayOnly: false,
      videoEncoder: 'gpu',
      resolutionPreset: '1080p',
      frameRate: 24,
      segmentSeconds: 3,
      systemAudioEnabled: true,
      microphoneEnabled: true
    })
    expect(settings.clip.paddingBeforeSeconds).toBe(99)
    expect(settings.clip.replayBufferSeconds).toBe(99)
    expect(settings.clip.outputDir).toBe('/Users/igor/Clips')
    expect(settings).not.toHaveProperty('obs')

    const reloaded = await store.load()
    expect(reloaded).toEqual(settings)
  })

  it('migrates legacy OBS settings to built-in recording and drops OBS fields', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'TradeTools-settings-legacy-obs-'))
    await writeFile(join(tempDir, 'settings.json'), JSON.stringify({
      recording: { mode: 'obs' },
      obs: { host: 'localhost', port: 4455, passwordConfigured: true },
      clip: { replaySourceDir: 'C:/legacy-obs-replays' }
    }), 'utf8')
    const store = createSettingsStore(tempDir)

    const settings = await store.load()

    expect(settings.recording.mode).toBe('window')
    expect(settings).not.toHaveProperty('obs')
    expect(settings.clip).not.toHaveProperty('replaySourceDir')
  })

  it('drops legacy Binance API settings when persisting settings', async () => {
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
      },
      tradeSource: { mode: 'binance-futures' }
    } as unknown as Parameters<typeof store.update>[0])

    expect(settings).not.toHaveProperty('exchange')
    expect(settings.tradeSource.mode).toBe('terminal-window')

    const reloaded = await store.load()
    expect(JSON.stringify(reloaded).toLowerCase()).not.toContain('binance')
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

  it('persists the selected interface theme between app launches', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'TradeTools-settings-theme-'))
    const store = createSettingsStore(tempDir)

    const saved = await store.update({ system: { interfaceTheme: 'classic' } })

    expect(saved.system.interfaceTheme).toBe('classic')
    expect((await store.load()).system.interfaceTheme).toBe('classic')
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

  it('serializes concurrent saves without corrupting or dropping settings', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'TradeTools-settings-concurrent-'))
    const store = createSettingsStore(tempDir)

    await Promise.all([
      store.update({ system: { launchAtLogin: true } }),
      store.update({ system: { keepProxyRunningAfterClose: true } }),
      store.update({
        proxyRuntime: {
          activeStartProxyId: 'proxy-1',
          entryHost: '92.38.129.126',
          entryPort: 443,
          localPort: 1083,
          entryUuidConfigured: true,
          configuredAtMs: 123
        }
      })
    ])

    const text = await readFile(join(tempDir, 'settings.json'), 'utf8')
    expect(() => JSON.parse(text)).not.toThrow()

    const settings = await store.load()
    expect(settings.system).toMatchObject({ launchAtLogin: true, keepProxyRunningAfterClose: true })
    expect(settings.proxyRuntime).toMatchObject({
      activeStartProxyId: 'proxy-1',
      entryHost: '92.38.129.126',
      entryUuidConfigured: true
    })
  })

  it('rejects a stale screen metadata update after the user selects HAPP', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'TradeTools-settings-source-race-'))
    const store = createSettingsStore(tempDir)
    const screenSettings = await store.update({
      recording: {
        sourceType: 'screen',
        windowSourceId: 'screen:1',
        windowSourceName: 'Screen 1',
        captureTargets: [{ id: 'screen:1', name: 'Screen 1', type: 'screen' }]
      }
    })
    const staleRevision = recordingSourceRevision(screenSettings.recording)

    await store.update({
      recording: {
        sourceType: 'window',
        windowSourceId: 'window:happ',
        windowSourceName: 'Happ 2.18.3 (573)',
        captureTargets: [{ id: 'window:happ', name: 'Happ 2.18.3 (573)', type: 'window' }],
        saveTargetMode: 'selected',
        saveTargetId: 'window:happ'
      }
    })
    const result = await store.updateIf({
      recording: {
        windowSourceId: 'screen:1-new',
        windowSourceName: 'Screen 1',
        captureTargets: [{ id: 'screen:1-new', name: 'Screen 1', type: 'screen', displayId: '1' }]
      }
    }, (current) => recordingSourceRevision(current.recording) === staleRevision)

    expect(result.recording).toMatchObject({
      sourceType: 'window',
      windowSourceId: 'window:happ',
      windowSourceName: 'Happ 2.18.3 (573)',
      saveTargetId: 'window:happ'
    })
    expect(await store.load()).toEqual(result)
  })
})
