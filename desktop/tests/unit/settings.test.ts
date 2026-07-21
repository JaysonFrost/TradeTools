import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDefaultSettings, normalizeSettings } from '../../src/main/services/settings/settings'
import { defaultLocalProxyPort } from '../../src/shared/defaults'

const legacyVideoProviderSettingsKey = ['you', 'tube'].join('')
const legacyAuthFlagKey = [['oa', 'uth'].join(''), 'Client', 'Configured'].join('')
const legacyGateSettingsKey = ['ac', 'cess'].join('')
const legacySubscriptionFlagKey = ['sub', 'scription', 'Required'].join('')
const legacyTelegramGateFlagKey = ['telegram', 'Bot', 'Required'].join('')
const legacyDiscordGateFlagKey = ['discord', 'Guild', 'Gate', 'Enabled'].join('')
const legacyAdminPanelFlagKey = ['admin', 'Panel', 'Enabled'].join('')

describe('settings', () => {
  it('creates Russian-first defaults for free local clip automation', () => {
    const settings = createDefaultSettings('/Users/igor/Library/Application Support/TradeTools')

    expect(settings.language).toBe('ru')
    expect(settings.clip.paddingBeforeSeconds).toBe(2)
    expect(settings.clip.paddingAfterSeconds).toBe(2)
    expect(settings.clip.replayBufferSeconds).toBe(60)
    expect(settings.recording).toEqual({
      mode: 'window',
      sourceType: 'window',
      windowSourceId: '',
      windowSourceName: '',
      captureTargets: [],
      saveTargetMode: 'all',
      saveTargetId: '',
      saveTradeDisplayOnly: false,
      videoEncoder: 'gpu',
      resolutionPreset: '1440p',
      frameRate: 30,
      segmentSeconds: 2,
      systemAudioEnabled: false,
      microphoneEnabled: false
    })
    expect(settings.clip.outputDir).toBe(join('/Users/igor/Library/Application Support/TradeTools', 'clips'))
    expect(settings.system).toEqual({
      launchAtLogin: false,
      alwaysOnTop: false,
      keepProxyRunningAfterClose: false,
      proxyPaymentNotificationsEnabled: true,
      clipSuccessNotificationsEnabled: true,
      paymentReminderDaysBefore: 5
    })
    expect(settings.proxyRuntime).toEqual({
      activeStartProxyId: '',
      route: '',
      entryHost: '',
      entryPort: 443,
      localPort: defaultLocalProxyPort,
      localProxyType: 'SOCKS5',
      entryUuidConfigured: false,
      configuredAtMs: 0
    })
    expect(settings.proxies).toEqual([])
    expect(settings.tradeSource).toEqual({
      mode: 'terminal-window'
    })
    expect(settings).not.toHaveProperty('exchange')
    expect(settings).not.toHaveProperty(legacyVideoProviderSettingsKey)
    expect(settings).not.toHaveProperty(legacyGateSettingsKey)
  })

  it('normalizes unsafe clip padding and keeps user output folder', () => {
    const settings = normalizeSettings({
      language: 'en',
      clip: { paddingBeforeSeconds: -5, paddingAfterSeconds: 600, replayBufferSeconds: 30, outputDir: '/clips' }
    }, '/app-data')

    expect(settings.language).toBe('ru')
    expect(settings.clip.paddingBeforeSeconds).toBe(0)
    expect(settings.clip.paddingAfterSeconds).toBe(600)
    expect(settings.clip.replayBufferSeconds).toBe(30)
    expect(settings.clip.outputDir).toBe('/clips')
  })

  it('allows the heavy 10 minute clip preset for built-in recording', () => {
    const settings = normalizeSettings({
      recording: {
        mode: 'window'
      },
      clip: {
        paddingBeforeSeconds: 600,
        paddingAfterSeconds: 600,
        replayBufferSeconds: 30
      }
    }, '/app-data')

    expect(settings.clip.paddingBeforeSeconds).toBe(600)
    expect(settings.clip.paddingAfterSeconds).toBe(600)
    expect(settings.clip.replayBufferSeconds).toBe(600)
  })

  it('drops legacy Binance Futures API settings and keeps the no-API source', () => {
    const settings = normalizeSettings({
      exchange: {
        binanceFutures: {
          enabled: true,
          testnet: true,
          apiKeyConfigured: true,
          apiSecretConfigured: true
        }
      },
      tradeSource: {
        mode: 'binance-futures'
      }
    } as unknown as Parameters<typeof normalizeSettings>[0], '/app-data')

    expect(settings).not.toHaveProperty('exchange')
    expect(settings.tradeSource.mode).toBe('terminal-window')
  })

  it('keeps terminal-window as the explicit no-API trade source', () => {
    const settings = normalizeSettings({
      tradeSource: {
        mode: 'terminal-window'
      }
    }, '/app-data')

    expect(settings.tradeSource.mode).toBe('terminal-window')
  })

  it('normalizes built-in window recording settings', () => {
    const settings = normalizeSettings({
      recording: {
        mode: 'window',
        sourceType: 'screen',
        windowSourceId: ' screen:1 ',
        windowSourceName: ' Terminal ',
        frameRate: 999,
        segmentSeconds: 0,
        videoEncoder: 'cpu',
        resolutionPreset: 'native',
        systemAudioEnabled: true,
        microphoneEnabled: false
      }
    }, '/app-data')

    expect(settings.recording).toEqual({
      mode: 'window',
      sourceType: 'screen',
      windowSourceId: 'screen:1',
      windowSourceName: 'Terminal',
      captureTargets: [{
        id: 'screen:1',
        name: 'Terminal',
        type: 'screen'
      }],
      saveTargetMode: 'all',
      saveTargetId: 'screen:1',
      saveTradeDisplayOnly: false,
      videoEncoder: 'cpu',
      resolutionPreset: 'native',
      frameRate: 60,
      segmentSeconds: 1,
      systemAudioEnabled: true,
      microphoneEnabled: false
    })
  })

  it('normalizes explicit GPU encoder devices and falls back to auto GPU', () => {
    expect(normalizeSettings({
      recording: {
        videoEncoder: 'gpu:nvidia:1' as never
      }
    }, '/app-data').recording.videoEncoder).toBe('gpu:nvidia:1')

    expect(normalizeSettings({
      recording: {
        videoEncoder: 'gpu:amd:0' as never
      }
    }, '/app-data').recording.videoEncoder).toBe('gpu:amd:0')

    expect(normalizeSettings({
      recording: {
        videoEncoder: 'gpu:intel:0' as never
      }
    }, '/app-data').recording.videoEncoder).toBe('gpu:intel:0')

    expect(normalizeSettings({
      recording: {
        videoEncoder: 'broken' as never
      }
    }, '/app-data').recording.videoEncoder).toBe('gpu')
  })

  it('normalizes selected multi-monitor capture targets', () => {
    const settings = normalizeSettings({
      recording: {
        mode: 'window',
        sourceType: 'screen',
        windowSourceId: 'screen:1',
        windowSourceName: 'Screen 1',
        captureTargets: [
          { id: ' screen:1 ', name: ' Экран 1 ', type: 'screen', displayId: ' 1001 ' },
          { id: 'window:vataga', name: 'Vataga', type: 'window' },
          { id: '', name: 'Broken', type: 'screen' }
        ],
        saveTargetMode: 'selected',
        saveTargetId: ' screen:1 '
      }
    }, '/app-data')

    expect(settings.recording.captureTargets).toEqual([{
      id: 'screen:1',
      name: 'Экран 1',
      type: 'screen',
      displayId: '1001'
    }])
    expect(settings.recording.saveTargetMode).toBe('selected')
    expect(settings.recording.saveTargetId).toBe('screen:1')
  })

  it('ignores the legacy trade-display-only screen saving flag', () => {
    const settings = normalizeSettings({
      recording: {
        mode: 'window',
        sourceType: 'screen',
        captureTargets: [
          { id: 'screen:1:0', name: 'Экран 1', type: 'screen', displayId: '1453013278' },
          { id: 'screen:2:0', name: 'Экран 2', type: 'screen', displayId: '2725992212' }
        ],
        saveTargetMode: 'all',
        saveTradeDisplayOnly: true
      }
    }, '/app-data')

    expect(settings.recording.saveTradeDisplayOnly).toBe(false)
  })

  it('drops legacy window ids that were mislabeled as screen capture targets', () => {
    const settings = normalizeSettings({
      recording: {
        mode: 'window',
        sourceType: 'screen',
        windowSourceId: 'window:8849754:0',
        windowSourceName: 'Vataga.terminal',
        captureTargets: [
          { id: 'window:8849754:0', name: 'Vataga.terminal', type: 'screen' },
          { id: 'screen:1:0', name: 'Экран 1', type: 'screen', displayId: '1453013278' }
        ],
        saveTargetMode: 'all',
        saveTargetId: 'window:8849754:0'
      }
    }, '/app-data')

    expect(settings.recording.captureTargets).toEqual([{
      id: 'screen:1:0',
      name: 'Экран 1',
      type: 'screen',
      displayId: '1453013278'
    }])
    expect(settings.recording.saveTargetId).toBe('screen:1:0')
  })

  it('normalizes proxy records and system notification settings without raw proxy passwords', () => {
    const settings = normalizeSettings({
      system: {
        launchAtLogin: true,
        alwaysOnTop: true,
        keepProxyRunningAfterClose: true,
        proxyPaymentNotificationsEnabled: false,
        clipSuccessNotificationsEnabled: false,
        paymentReminderDaysBefore: 99
      },
      proxies: [{
        id: 'proxy-1',
        name: ' Main proxy ',
        server: ' 1.2.3.4:9000 ',
        login: ' trader ',
        passwordConfigured: true,
        nextProxyId: 'proxy-2',
        localProxyPort: 1081,
        paymentDueDate: '2026-06-20',
        dashboardUrl: 'https://proxy.example.com/cabinet',
        notes: ' paid monthly '
      }]
    }, '/app-data')

    expect(settings.system).toEqual({
      launchAtLogin: true,
      alwaysOnTop: true,
      keepProxyRunningAfterClose: true,
      proxyPaymentNotificationsEnabled: false,
      clipSuccessNotificationsEnabled: false,
      paymentReminderDaysBefore: 30
    })
    expect(settings.proxies).toEqual([{
      id: 'proxy-1',
      name: 'Main proxy',
      server: '1.2.3.4:9000',
      login: 'trader',
      passwordConfigured: true,
      nextProxyId: 'proxy-2',
      localProxyPort: 1081,
      paymentDueDay: 20,
      dashboardUrl: 'https://proxy.example.com/cabinet',
      notes: 'paid monthly'
    }])
    expect(JSON.stringify(settings)).not.toContain('proxy-password')
  })

  it('uses root as the default SSH login for proxy records', () => {
    const settings = normalizeSettings({
      proxies: [{
        id: 'proxy-1',
        name: 'Edgecenter',
        server: '1.2.3.4',
        login: ''
      }]
    }, '/app-data')

    expect(settings.proxies[0]?.login).toBe('root')
  })

  it('uses 1083 as the default local proxy port for proxy records', () => {
    const settings = normalizeSettings({
      proxies: [{
        id: 'proxy-1',
        name: 'Edgecenter',
        server: '1.2.3.4',
        localProxyPort: 0
      }]
    }, '/app-data')

    expect(settings.proxies[0]?.localProxyPort).toBe(defaultLocalProxyPort)
  })

  it('normalizes active proxy runtime without storing the VLESS uuid', () => {
    const settings = normalizeSettings({
      proxyRuntime: {
        activeStartProxyId: ' proxy-1 ',
        route: ' Edgecenter -> Vultr ',
        entryHost: ' 92.38.129.126 ',
        entryPort: 443,
        localPort: 1083,
        localProxyType: 'HTTP',
        entryUuidConfigured: true,
        configuredAtMs: 123
      }
    }, '/app-data')

    expect(settings.proxyRuntime).toEqual({
      activeStartProxyId: 'proxy-1',
      route: 'Edgecenter -> Vultr',
      entryHost: '92.38.129.126',
        entryPort: 443,
        localPort: 1083,
        localProxyType: 'HTTP',
        entryUuidConfigured: true,
      configuredAtMs: 123
    })
    expect(settings.proxyRuntime).not.toHaveProperty('entryUuid')
  })

  it('uses SOCKS5 for a proxy runtime saved without a selected type', () => {
    expect(normalizeSettings({}, '/app-data').proxyRuntime.localProxyType).toBe('SOCKS5')
  })

  it('drops legacy external publishing settings from stored settings', () => {
    const settings = normalizeSettings({
      [legacyVideoProviderSettingsKey]: {
        [legacyAuthFlagKey]: true,
        authorized: true,
        defaultPrivacyStatus: 'unlisted'
      }
    } as Parameters<typeof normalizeSettings>[0], '/app-data')

    expect(settings).not.toHaveProperty(legacyVideoProviderSettingsKey)
  })

  it('drops legacy gated settings from stored settings', () => {
    const settings = normalizeSettings({
      [legacyGateSettingsKey]: {
        [legacySubscriptionFlagKey]: true,
        [legacyTelegramGateFlagKey]: true,
        [legacyDiscordGateFlagKey]: true,
        [legacyAdminPanelFlagKey]: true
      }
    } as Parameters<typeof normalizeSettings>[0], '/app-data')

    expect(settings).not.toHaveProperty(legacyGateSettingsKey)
  })
})
