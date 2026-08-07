import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { aggregateWindowRecorderSourceStatuses, assertBrowserSessionVideoCoverage, buildBrowserSessionConcatFilter, buildNativeRecorderArgs, buildReplayConcatManifest, createWindowRecorderService, parseBrowserSessionVideoPacketMetadata, planBrowserSessionTimeline, selectAvailableReplayWindow, selectBrowserSessionPrefix, shouldConcatBrowserAudio, shouldPruneReplayFile } from '../../src/main/services/recording/windowRecorderService'
import { createDefaultSettings, normalizeSettings } from '../../src/main/services/settings/settings'
import {
  browserCaptureFrameRate,
  browserVideoBitrate,
  browserVideoTrackIsUsable,
  hasConfiguredRecordingSource,
  mergeBrowserRecorderStatus,
  resolveRecordingTargets,
  sourceMatchesConfiguredRecording,
  shouldPersistBrowserRecorderChunk
} from '../../src/renderer/components/recording/WindowRecorderController'

describe('windowRecorderService', () => {
  const browserVideoMetadata = (
    videoDurationSeconds: number,
    firstVideoPacketSeconds = 0,
    maxVideoPacketGapSeconds = 0.05
  ) => ({ firstVideoPacketSeconds, videoDurationSeconds, maxVideoPacketGapSeconds })

  it('records only the explicitly selected window even when a terminal is auto-detected', () => {
    const settings = createDefaultSettings('C:/TradeTools')
    settings.recording.sourceType = 'window'
    settings.recording.windowSourceId = 'window:happ'
    settings.recording.windowSourceName = 'Happ 2.18.3 (573)'
    settings.recording.captureTargets = [{
      id: 'window:happ',
      name: 'Happ 2.18.3 (573)',
      type: 'window'
    }]
    const sources = [
      { id: 'window:happ', name: 'Happ 2.18.3 (573)', displayId: '', type: 'window' as const },
      { id: 'window:vataga', name: 'Vataga.terminal', displayId: '', type: 'window' as const }
    ]

    expect(resolveRecordingTargets(sources, settings).map((source) => source.id)).toEqual(['window:happ'])
  })

  it('auto-detects terminals only while no window is configured', () => {
    const settings = createDefaultSettings('C:/TradeTools')
    const sources = [
      { id: 'window:happ', name: 'Happ 2.18.3 (573)', displayId: '', type: 'window' as const },
      { id: 'window:vataga', name: 'Vataga.terminal', displayId: '', type: 'window' as const }
    ]

    expect(resolveRecordingTargets(sources, settings).map((source) => source.id)).toEqual(['window:vataga'])
  })

  it('treats every persisted source reference as configured before auto-selection', () => {
    const settings = createDefaultSettings('C:/TradeTools')
    expect(hasConfiguredRecordingSource(settings)).toBe(false)

    settings.recording.captureTargets = [{
      id: 'window:happ',
      name: 'Happ 2.18.3 (573)',
      type: 'window'
    }]
    expect(hasConfiguredRecordingSource(settings)).toBe(true)
  })

  it('preserves real buffer metrics and reports the actually active browser source', () => {
    const status = {
      enabled: true,
      active: false,
      mode: 'window' as const,
      backend: 'browser' as const,
      sourceId: 'window:vataga',
      sourceName: 'Vataga.terminal',
      segmentCount: 12,
      bufferedSeconds: 60,
      lastSegmentAtMs: 123_456,
      message: 'old'
    }

    expect(mergeBrowserRecorderStatus(status, [{
      id: 'window:happ',
      name: 'Happ 2.18.3 (573)'
    }], 'active')).toEqual({
      ...status,
      active: true,
      sourceId: 'window:happ',
      sourceName: 'Happ 2.18.3 (573)',
      message: 'active'
    })
  })

  it('stops a stale Vataga recorder when HAPP is the explicit selection', () => {
    const settings = createDefaultSettings('C:/TradeTools')
    settings.recording.windowSourceId = 'window:happ'
    settings.recording.windowSourceName = 'Happ 2.18.3 (573)'

    expect(sourceMatchesConfiguredRecording({
      id: 'window:happ',
      name: 'Happ 2.18.3 (573)',
      displayId: '',
      type: 'window'
    }, settings)).toBe(true)
    expect(sourceMatchesConfiguredRecording({
      id: 'window:vataga',
      name: 'Vataga.terminal',
      displayId: '',
      type: 'window'
    }, settings)).toBe(false)
  })

  it('keeps every explicitly selected screen recorder during reconciliation', () => {
    const settings = createDefaultSettings('C:/TradeTools')
    settings.recording.sourceType = 'screen'
    settings.recording.windowSourceId = 'screen:one'
    settings.recording.windowSourceName = 'Screen one'
    settings.recording.captureTargets = [
      { id: 'screen:one', name: 'Screen one', type: 'screen', displayId: '1' },
      { id: 'screen:two', name: 'Screen two', type: 'screen', displayId: '2' }
    ]

    expect(sourceMatchesConfiguredRecording({
      id: 'screen:two',
      name: 'Screen two',
      displayId: '2',
      type: 'screen'
    }, settings)).toBe(true)
  })

  it('counts auto-detected terminal segments when no source has been persisted yet', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'tradetools-window-auto-source-'))
    const settings = createDefaultSettings(dataDir)
    const service = createWindowRecorderService({ appDataDir: dataDir })
    const endedAtMs = Date.now()

    try {
      const status = await service.appendSegment({
        sourceId: 'window:vataga-auto',
        sourceName: 'Vataga.terminal',
        sessionId: 'auto-session',
        sequence: 0,
        startedAtMs: endedAtMs - 1_000,
        endedAtMs,
        mimeType: 'video/webm',
        data: new ArrayBuffer(1)
      }, settings)

      expect(status.active).toBe(true)
      expect(status.segmentCount).toBe(1)
      expect(status.bufferedSeconds).toBe(1)
      expect(status.lastSegmentAtMs).toBe(endedAtMs)
    } finally {
      await service.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('keeps explicit HAPP buffer metrics authoritative over a stale Vataga capture target', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'tradetools-window-explicit-source-'))
    const settings = createDefaultSettings(dataDir)
    settings.recording.windowSourceId = 'window:happ'
    settings.recording.windowSourceName = 'Happ 2.18.3 (573)'
    settings.recording.captureTargets = [{
      id: 'window:vataga',
      name: 'Vataga.terminal',
      type: 'window'
    }]
    const service = createWindowRecorderService({ appDataDir: dataDir })
    const nowMs = Date.now()
    const happEndedAtMs = nowMs - 2_000

    try {
      await service.appendSegment({
        sourceId: 'window:happ',
        sourceName: 'Happ 2.18.3 (573)',
        sessionId: 'happ-session',
        sequence: 0,
        startedAtMs: happEndedAtMs - 1_000,
        endedAtMs: happEndedAtMs,
        mimeType: 'video/webm',
        data: new ArrayBuffer(1)
      }, settings)
      await service.appendSegment({
        sourceId: 'window:vataga',
        sourceName: 'Vataga.terminal',
        sessionId: 'vataga-session',
        sequence: 0,
        startedAtMs: nowMs - 1_000,
        endedAtMs: nowMs,
        mimeType: 'video/webm',
        data: new ArrayBuffer(1)
      }, settings)
      const status = await service.getStatus(settings)

      expect(status).toMatchObject({
        active: true,
        sourceId: 'window:happ',
        sourceName: 'Happ 2.18.3 (573)',
        segmentCount: 1,
        bufferedSeconds: 1,
        lastSegmentAtMs: happEndedAtMs,
        sources: [{
          sourceId: 'window:happ',
          sourceName: 'Happ 2.18.3 (573)',
          segmentCount: 1,
          bufferedSeconds: 1,
          lastSegmentAtMs: happEndedAtMs
        }]
      })
    } finally {
      await service.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('reports the minimum real buffer across multiple selected sources', () => {
    expect(aggregateWindowRecorderSourceStatuses([
      { sourceId: 'window:one', sourceName: 'One', segmentCount: 3, bufferedSeconds: 30, lastSegmentAtMs: 40_000 },
      { sourceId: 'window:two', sourceName: 'Two', segmentCount: 3, bufferedSeconds: 30, lastSegmentAtMs: 50_000 }
    ], {
      segmentCount: 6,
      bufferedSeconds: 40,
      lastSegmentAtMs: 50_000
    })).toEqual({
      segmentCount: 6,
      bufferedSeconds: 30,
      lastSegmentAtMs: 50_000
    })
  })

  it('does not prune a freshly created replay whose mtime represents an older trade', () => {
    const nowMs = 100_000
    const cutoffMs = 50_000

    expect(shouldPruneReplayFile({
      mtimeMs: 40_000,
      ctimeMs: nowMs - 1_000,
      birthtimeMs: nowMs - 1_000
    }, cutoffMs, nowMs)).toBe(false)
    expect(shouldPruneReplayFile({
      mtimeMs: 40_000,
      ctimeMs: nowMs - 61_000,
      birthtimeMs: nowMs - 61_000
    }, cutoffMs, nowMs)).toBe(true)
  })

  const pathExists = async (path: string): Promise<boolean> => {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  }

  const createMissingVatagaWindowFixture = async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'tradetools-window-recorder-'))
    const settings = createDefaultSettings(dataDir)
    const checkedSourceNames: string[] = []
    const service = createWindowRecorderService({
      appDataDir: dataDir,
      isWindowSourceAvailable: async (source) => {
        checkedSourceNames.push(source.sourceName)
        return false
      }
    })
    const recordingSettings = {
      ...settings,
      recording: {
        ...settings.recording,
        mode: 'window' as const,
        sourceType: 'window' as const,
        windowSourceId: 'window:123',
        windowSourceName: 'Vataga.terminal',
        systemAudioEnabled: false,
        microphoneEnabled: false
      }
    }

    return {
      dataDir,
      service,
      settings: recordingSettings,
      getCheckedSourceNames: () => [...checkedSourceNames]
    }
  }

  it('does not start native ffmpeg capture when the saved terminal window is closed', async () => {
    const { dataDir, service, settings, getCheckedSourceNames } = await createMissingVatagaWindowFixture()

    try {
      const status = await service.start(settings)

      expect(getCheckedSourceNames()).toEqual(['Vataga.terminal'])
      expect(status.active).toBe(false)
      expect(status.fallbackRequired).toBe(true)
      expect(status.message).toContain('Окно Vataga.terminal не найдено')
      expect(status.message).not.toContain("Can't find window")
    } finally {
      await service.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('keeps the missing saved window message stable without rechecking windows during status polls', async () => {
    const { dataDir, service, settings, getCheckedSourceNames } = await createMissingVatagaWindowFixture()

    try {
      await service.start(settings)
      const status = await service.getStatus(settings)

      expect(getCheckedSourceNames()).toEqual(['Vataga.terminal'])
      expect(status.active).toBe(false)
      expect(status.fallbackRequired).toBe(true)
      expect(status.message).toContain('Окно Vataga.terminal не найдено')
      expect(status.message).not.toBe('Ждём сегменты от встроенного рекордера')
    } finally {
      await service.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('stores browser recording segments under the configured clip folder cache', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'tradetools-window-cache-path-'))
    const defaults = createDefaultSettings(dataDir)
    const settings = {
      ...defaults,
      recording: {
        ...defaults.recording,
        mode: 'window' as const,
        windowSourceId: 'window:tiger',
        windowSourceName: 'TigerTrade'
      },
      clip: {
        ...defaults.clip,
        outputDir: join(dataDir, 'selected-clips')
      }
    }
    const service = createWindowRecorderService({ appDataDir: dataDir })

    try {
      await service.appendSegment({
        sourceId: 'window:tiger',
        sourceName: 'TigerTrade',
        sessionId: 'browser-session',
        sequence: 0,
        startedAtMs: Date.now() - 2_000,
        endedAtMs: Date.now(),
        mimeType: 'video/webm',
        data: new ArrayBuffer(1)
      }, settings)

      const cacheEntries = await readdir(join(settings.clip.outputDir, '.tradetools-cache', 'segments'))

      expect(cacheEntries).toHaveLength(1)
      expect(cacheEntries[0]).toMatch(/\.webm$/)
      expect(await pathExists(join(dataDir, 'window-recording'))).toBe(false)
    } finally {
      await service.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('keeps 10-second browser segments healthy between MediaRecorder chunks and eventually marks them stale', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'tradetools-window-health-'))
    const defaults = createDefaultSettings(dataDir)
    const settings = {
      ...defaults,
      recording: {
        ...defaults.recording,
        mode: 'window' as const,
        windowSourceId: 'window:tiger',
        windowSourceName: 'TigerTrade',
        segmentSeconds: 10
      }
    }
    const service = createWindowRecorderService({ appDataDir: dataDir })
    const segmentEndedAtMs = 1_786_048_900_000
    let nowMs = segmentEndedAtMs
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs)

    try {
      await service.appendSegment({
        sourceId: 'window:tiger',
        sourceName: 'TigerTrade',
        sessionId: 'browser-session',
        sequence: 0,
        startedAtMs: segmentEndedAtMs - 10_000,
        endedAtMs: segmentEndedAtMs,
        mimeType: 'video/webm',
        data: new ArrayBuffer(1)
      }, settings)

      nowMs = segmentEndedAtMs + 11_000
      expect((await service.getStatus(settings)).active).toBe(true)

      nowMs = segmentEndedAtMs + 26_000
      expect((await service.getStatus(settings)).active).toBe(false)
    } finally {
      nowSpy.mockRestore()
      await service.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('matches a replaced window handle by process and symbol without mixing another symbol or process', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'tradetools-window-process-'))
    const defaults = createDefaultSettings(dataDir)
    const savedProcessId = 12_345
    const settings = {
      ...defaults,
      recording: {
        ...defaults.recording,
        mode: 'window' as const,
        windowSourceId: 'window:old-hwnd',
        windowSourceName: 'TigerTrade - BTCUSDT',
        captureTargets: [{
          id: 'window:old-hwnd',
          name: 'Tiger.com - ETHUSDT',
          type: 'window' as const,
          processId: savedProcessId,
          symbol: 'ETHUSDT'
        }],
        saveTargetId: 'window:old-hwnd'
      }
    }
    const service = createWindowRecorderService({ appDataDir: dataDir })
    const endedAtMs = Date.now()

    try {
      await service.appendSegment({
        sourceId: 'window:new-hwnd',
        sourceName: 'Tiger.com [ETH/USDT] chart',
        processId: savedProcessId,
        sessionId: 'same-process-session',
        sequence: 0,
        startedAtMs: endedAtMs - 4_000,
        endedAtMs: endedAtMs - 3_000,
        mimeType: 'video/webm',
        data: new ArrayBuffer(1)
      }, settings)
      await service.appendSegment({
        sourceId: 'window:same-process-other-symbol',
        sourceName: 'Tiger.com [BETHUSDT] chart',
        processId: savedProcessId,
        sessionId: 'same-process-other-symbol-session',
        sequence: 0,
        startedAtMs: endedAtMs - 3_000,
        endedAtMs: endedAtMs - 2_000,
        mimeType: 'video/webm',
        data: new ArrayBuffer(1)
      }, settings)
      await service.appendSegment({
        sourceId: 'window:other-process-same-symbol',
        sourceName: 'Tiger.com [ETH-USDT] detached',
        processId: 54_321,
        sessionId: 'other-process-same-symbol-session',
        sequence: 0,
        startedAtMs: endedAtMs - 2_000,
        endedAtMs: endedAtMs - 1_000,
        mimeType: 'video/webm',
        data: new ArrayBuffer(1)
      }, settings)

      const status = await service.getStatus(settings)

      expect(status.segmentCount).toBe(1)
      expect(status.lastSegmentAtMs).toBe(endedAtMs - 3_000)
      expect(status.sources).toEqual([expect.objectContaining({
        sourceId: 'window:old-hwnd',
        segmentCount: 1,
        lastSegmentAtMs: endedAtMs - 3_000
      })])
    } finally {
      await service.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('keeps only positive integer process ids while normalizing capture targets', () => {
    const settings = normalizeSettings({
      recording: {
        mode: 'window',
        sourceType: 'window',
        captureTargets: [
          { id: 'window:valid', name: 'Valid', type: 'window', processId: 123, symbol: ' beat/usdt ' },
          { id: 'window:zero', name: 'Zero', type: 'window', processId: 0, symbol: ' --- ' },
          { id: 'window:negative', name: 'Negative', type: 'window', processId: -1 },
          { id: 'window:fraction', name: 'Fraction', type: 'window', processId: 1.5, symbol: ' hei-usdt ' }
        ]
      }
    }, '/app-data')

    expect(settings.recording.captureTargets).toEqual([
      { id: 'window:valid', name: 'Valid', type: 'window', processId: 123, symbol: 'BEATUSDT' },
      { id: 'window:zero', name: 'Zero', type: 'window' },
      { id: 'window:negative', name: 'Negative', type: 'window' },
      { id: 'window:fraction', name: 'Fraction', type: 'window', symbol: 'HEIUSDT' }
    ])
  })

  it('reports browser recording active when any configured capture target has a fresh segment', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'tradetools-window-target-union-'))
    const defaults = createDefaultSettings(dataDir)
    const settings = {
      ...defaults,
      recording: {
        ...defaults.recording,
        mode: 'window' as const,
        windowSourceId: '',
        windowSourceName: '',
        captureTargets: [
          { id: 'window:primary', name: 'Primary terminal', type: 'window' as const, processId: 111 },
          { id: 'window:secondary', name: 'Secondary terminal', type: 'window' as const, processId: 222, symbol: 'ETHUSDT' }
        ],
        saveTargetId: 'window:primary'
      }
    }
    const service = createWindowRecorderService({ appDataDir: dataDir })
    const endedAtMs = Date.now()

    try {
      await service.appendSegment({
        sourceId: 'window:primary-new-hwnd',
        sourceName: 'Primary terminal - BTCUSDT',
        processId: 111,
        sessionId: 'primary-renamed-session',
        sequence: 0,
        startedAtMs: endedAtMs - 3_000,
        endedAtMs: endedAtMs - 2_000,
        mimeType: 'video/webm',
        data: new ArrayBuffer(1)
      }, settings)
      await service.appendSegment({
        sourceId: 'window:secondary-new-hwnd',
        sourceName: 'Secondary terminal - ETHUSDT',
        processId: 222,
        sessionId: 'secondary-session',
        sequence: 0,
        startedAtMs: endedAtMs - 2_000,
        endedAtMs: endedAtMs - 1_000,
        mimeType: 'video/webm',
        data: new ArrayBuffer(1)
      }, settings)
      await service.appendSegment({
        sourceId: 'window:not-configured',
        sourceName: 'Unrelated terminal',
        processId: 333,
        sessionId: 'unrelated-session',
        sequence: 0,
        startedAtMs: endedAtMs - 1_000,
        endedAtMs,
        mimeType: 'video/webm',
        data: new ArrayBuffer(1)
      }, settings)

      const status = await service.getStatus(settings)

      expect(status.active).toBe(true)
      expect(status.segmentCount).toBe(1)
      expect(status.lastSegmentAtMs).toBe(endedAtMs - 1_000)
      expect(status.sources).toEqual([
        expect.objectContaining({ sourceId: 'window:primary', segmentCount: 0 }),
        expect.objectContaining({ sourceId: 'window:secondary', segmentCount: 1 })
      ])
    } finally {
      await service.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('clears the current and legacy video caches without deleting final clips', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'tradetools-window-cache-clear-'))
    const defaults = createDefaultSettings(dataDir)
    const settings = {
      ...defaults,
      recording: {
        ...defaults.recording,
        mode: 'window' as const,
        windowSourceId: 'window:tiger',
        windowSourceName: 'TigerTrade'
      },
      clip: {
        ...defaults.clip,
        outputDir: join(dataDir, 'selected-clips')
      }
    }
    const service = createWindowRecorderService({ appDataDir: dataDir })
    const finalClipPath = join(settings.clip.outputDir, '2026-07-11', 'final.mp4')
    const legacyVideoPath = join(dataDir, 'window-recording', 'segments', 'old.mp4')

    try {
      await mkdir(settings.clip.outputDir, { recursive: true })
      await mkdir(join(settings.clip.outputDir, '2026-07-11'), { recursive: true })
      await mkdir(join(dataDir, 'window-recording', 'segments'), { recursive: true })
      await writeFile(finalClipPath, 'final clip')
      await writeFile(legacyVideoPath, 'legacy cache')
      await service.appendSegment({
        sourceId: 'window:tiger',
        sourceName: 'TigerTrade',
        sessionId: 'browser-session',
        sequence: 0,
        startedAtMs: Date.now() - 2_000,
        endedAtMs: Date.now(),
        mimeType: 'video/webm',
        data: new ArrayBuffer(1)
      }, settings)

      const result = await service.clearCache(settings)

      expect(result.legacyCacheRemoved).toBe(true)
      expect(await pathExists(join(settings.clip.outputDir, '.tradetools-cache'))).toBe(false)
      expect(await pathExists(join(dataDir, 'window-recording'))).toBe(false)
      expect(await pathExists(finalClipPath)).toBe(true)
    } finally {
      await service.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('does not clear the video cache while a trade is protected', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'tradetools-window-cache-protected-'))
    const defaults = createDefaultSettings(dataDir)
    const settings = {
      ...defaults,
      recording: {
        ...defaults.recording,
        mode: 'window' as const,
        windowSourceId: 'window:tiger',
        windowSourceName: 'TigerTrade'
      }
    }
    const service = createWindowRecorderService({ appDataDir: dataDir })

    try {
      await service.appendSegment({
        sourceId: 'window:tiger',
        sourceName: 'TigerTrade',
        sessionId: 'browser-session',
        sequence: 0,
        startedAtMs: Date.now() - 2_000,
        endedAtMs: Date.now(),
        mimeType: 'video/webm',
        data: new ArrayBuffer(1)
      }, settings)
      service.protectSince(Date.now() - 1_000)

      await expect(service.clearCache(settings)).rejects.toThrow('Нельзя очистить кэш')
      expect(await pathExists(join(settings.clip.outputDir, '.tradetools-cache'))).toBe(true)
    } finally {
      await service.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('keeps native recorder errors distinct from the browser window-capture fallback', async () => {
    const source = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')

    expect(source).toContain('isMissingNativeWindowError')
    expect(source).toContain("Can't find window")
    expect(source).toContain('markNativeMissingSource')
    expect(source).toContain('nativeLastError = \'\'')
    expect(source).toContain('Окна терминалов пишутся через Chromium без захвата курсора')
  })

  it('reports the missing beginning instead of a misleading total buffered duration', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'tradetools-window-front-coverage-'))
    const defaults = createDefaultSettings(dataDir)
    const settings = {
      ...defaults,
      recording: {
        ...defaults.recording,
        mode: 'window' as const,
        windowSourceId: 'window:tiger',
        windowSourceName: 'TigerTrade'
      },
      clip: {
        ...defaults.clip,
        paddingBeforeSeconds: 10,
        paddingAfterSeconds: 0,
        replayBufferSeconds: 60
      }
    }
    const service = createWindowRecorderService({ appDataDir: dataDir })
    const nowMs = Date.now()

    try {
      await service.appendSegment({
        sourceId: 'window:tiger',
        sourceName: 'TigerTrade',
        sessionId: 'browser-session',
        sequence: 0,
        startedAtMs: nowMs - 15_000,
        endedAtMs: nowMs,
        mimeType: 'video/webm',
        data: new ArrayBuffer(1)
      }, settings)

      const result = await service.saveReplayBuffer({
        settings,
        trade: {
          id: 'missing-front',
          exchange: 'BINANCE',
          marketType: 'FUTURES',
          symbol: 'BTCUSDT',
          side: 'LONG',
          status: 'closed',
          entryTimeMs: nowMs - 10_000,
          exitTimeMs: nowMs - 5_000
        }
      })

      expect(result.ok).toBe(false)
      expect(result.message).toContain('отсутствует 5с в начале')
      expect(result.message).toContain('начало сделки или отступ до входа не записаны')
      expect(result.message).not.toContain('Накоплено 15с, нужно примерно 15с')
    } finally {
      await service.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('removes reconstructed browser sessions and a partial replay when trade export fails', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'tradetools-window-failed-export-'))
    const defaults = createDefaultSettings(dataDir)
    const outputDir = join(dataDir, 'clips')
    const settings = {
      ...defaults,
      recording: {
        ...defaults.recording,
        mode: 'window' as const,
        sourceType: 'window' as const,
        windowSourceId: 'window:tiger',
        windowSourceName: 'TigerTrade',
        systemAudioEnabled: false,
        microphoneEnabled: false
      },
      clip: {
        ...defaults.clip,
        outputDir,
        paddingBeforeSeconds: 0,
        paddingAfterSeconds: 0,
        replayBufferSeconds: 60
      }
    }
    let reconstructedSessionPath = ''
    let partialReplayPath = ''
    const service = createWindowRecorderService({
      appDataDir: dataDir,
      probeBrowserSessionMedia: async () => ({ hasAudio: false, ...browserVideoMetadata(5) }),
      runFfmpeg: async (args) => {
        reconstructedSessionPath = args[args.indexOf('-i') + 1] ?? ''
        partialReplayPath = args.at(-1) ?? ''
        await writeFile(partialReplayPath, 'partial replay')
        throw new Error('forced replay render failure')
      }
    })
    const endedAtMs = Date.now()

    try {
      await service.appendSegment({
        sourceId: 'window:tiger',
        sourceName: 'TigerTrade',
        sessionId: 'browser-session',
        sequence: 0,
        startedAtMs: endedAtMs - 5_000,
        endedAtMs,
        mimeType: 'video/webm',
        data: new Uint8Array([1]).buffer
      }, settings)

      const result = await service.saveReplayBuffer({
        settings,
        trade: {
          id: 'failed-export',
          exchange: 'BINANCE',
          marketType: 'FUTURES',
          symbol: 'BTCUSDT',
          side: 'LONG',
          status: 'closed',
          entryTimeMs: endedAtMs - 4_000,
          exitTimeMs: endedAtMs - 1_000
        }
      })

      expect(result).toMatchObject({ ok: false, message: 'forced replay render failure' })
      expect(reconstructedSessionPath).toMatch(/\.webm$/)
      expect(partialReplayPath).toMatch(/\.mp4$/)
      await expect(access(reconstructedSessionPath)).rejects.toThrow()
      await expect(access(partialReplayPath)).rejects.toThrow()
      await expect(readdir(join(outputDir, '.tradetools-cache', 'replays'))).resolves.toEqual([])
    } finally {
      await service.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('removes reconstructed browser sessions and a partial output when free recording export fails', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'tradetools-free-recording-failed-export-'))
    const defaults = createDefaultSettings(dataDir)
    const outputDir = join(dataDir, 'clips')
    const settings = {
      ...defaults,
      recording: {
        ...defaults.recording,
        mode: 'window' as const,
        sourceType: 'window' as const,
        windowSourceId: 'window:tiger',
        windowSourceName: 'TigerTrade',
        systemAudioEnabled: false,
        microphoneEnabled: false
      },
      clip: {
        ...defaults.clip,
        outputDir,
        replayBufferSeconds: 60
      }
    }
    let reconstructedSessionPath = ''
    let partialOutputPath = ''
    const service = createWindowRecorderService({
      appDataDir: dataDir,
      isWindowSourceAvailable: async () => true,
      probeBrowserSessionMedia: async () => ({ hasAudio: false, ...browserVideoMetadata(4) }),
      runFfmpeg: async (args) => {
        reconstructedSessionPath = args[args.indexOf('-i') + 1] ?? ''
        partialOutputPath = args.at(-1) ?? ''
        await writeFile(partialOutputPath, 'partial free recording')
        throw new Error('forced free recording render failure')
      }
    })
    const startedAtMs = 1_786_060_000_000
    let nowMs = startedAtMs
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs)

    try {
      await service.startFreeRecording(settings)
      nowMs = startedAtMs + 4_000
      await service.appendSegment({
        sourceId: 'window:tiger',
        sourceName: 'TigerTrade',
        sessionId: 'free-browser-session',
        sequence: 0,
        startedAtMs,
        endedAtMs: nowMs,
        mimeType: 'video/webm',
        data: new Uint8Array([1]).buffer
      }, settings)

      await expect(service.finishFreeRecording(settings)).rejects.toThrow('forced free recording render failure')
      expect(reconstructedSessionPath).toMatch(/\.webm$/)
      expect(partialOutputPath).toMatch(/\.mp4$/)
      await expect(access(reconstructedSessionPath)).rejects.toThrow()
      await expect(access(partialOutputPath)).rejects.toThrow()
      await expect(readdir(join(outputDir, '.tradetools-cache', 'replays'))).resolves.toEqual([])
    } finally {
      nowSpy.mockRestore()
      await service.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('does not make old 60s browser segments become a full 600s buffer after increasing the setting', async () => {
    const source = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')
    const dataDir = await mkdtemp(join(tmpdir(), 'tradetools-window-buffer-resize-'))
    const defaultSettings = createDefaultSettings(dataDir)
    const settings60 = {
      ...defaultSettings,
      recording: {
        ...defaultSettings.recording,
        mode: 'window' as const,
        windowSourceId: 'window:tiger',
        windowSourceName: 'TigerTrade'
      },
      clip: {
        ...defaultSettings.clip,
        replayBufferSeconds: 60
      }
    }
    const settings600 = {
      ...settings60,
      clip: {
        ...settings60.clip,
        replayBufferSeconds: 600
      }
    }
    const service = createWindowRecorderService({ appDataDir: dataDir })
    const nowMs = Date.parse('2026-06-18T10:00:00.000Z')

    vi.useFakeTimers()
    vi.setSystemTime(nowMs)
    try {
      await service.appendSegment({
        sourceId: 'window:tiger',
        sourceName: 'TigerTrade',
        sessionId: 'browser-session',
        sequence: 0,
        startedAtMs: nowMs - 600_000,
        endedAtMs: nowMs - 598_000,
        mimeType: 'video/webm',
        data: new ArrayBuffer(1)
      }, settings60)
      await service.appendSegment({
        sourceId: 'window:tiger',
        sourceName: 'TigerTrade',
        sessionId: 'browser-session',
        sequence: 1,
        startedAtMs: nowMs - 2_000,
        endedAtMs: nowMs,
        mimeType: 'video/webm',
        data: new ArrayBuffer(1)
      }, settings60)

      const status = await service.getStatus(settings600)

      expect(source).not.toContain('sessionLastEndedAt')
      expect(status.bufferedSeconds).toBeLessThan(600)
      expect(status.bufferedSeconds).toBeLessThanOrEqual(5)
    } finally {
      vi.useRealTimers()
      await service.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('does not substitute an unrelated segment when the requested trade window is not buffered', () => {
    const requestedStartMs = Date.parse('2026-06-17T17:47:04.000Z')
    const requestedEndMs = Date.parse('2026-06-17T17:47:10.000Z')
    const nearestSegment = {
      id: 'after-trade',
      startedAtMs: Date.parse('2026-06-17T17:47:20.000Z'),
      endedAtMs: Date.parse('2026-06-17T17:47:22.000Z')
    }

    const selection = selectAvailableReplayWindow([nearestSegment], requestedStartMs, requestedEndMs)

    expect(selection).toBeUndefined()
  })

  it('deduplicates overlapping recorder segments while preserving the requested trade window', () => {
    const first = { id: 'first', startedAtMs: 1_000, endedAtMs: 11_000 }
    const duplicate = { id: 'duplicate', startedAtMs: 1_000, endedAtMs: 11_000 }
    const second = { id: 'second', startedAtMs: 11_000, endedAtMs: 21_000 }

    expect(selectAvailableReplayWindow([duplicate, second, first], 6_000, 16_000)).toEqual({
      segments: [duplicate, second],
      replayStartMs: 6_000,
      replayEndMs: 16_000
    })
  })

  it('rejects a replay window with an internal recording gap', () => {
    const beforeGap = { id: 'before-gap', startedAtMs: 1_000, endedAtMs: 6_000 }
    const afterGap = { id: 'after-gap', startedAtMs: 8_000, endedAtMs: 13_000 }

    expect(selectAvailableReplayWindow([beforeGap, afterGap], 2_000, 12_000)).toBeUndefined()
  })

  it('does not export a partial trade window that misses the exit', () => {
    const beforeExit = { id: 'before-exit', startedAtMs: 1_000, endedAtMs: 9_000 }

    expect(selectAvailableReplayWindow([beforeExit], 2_000, 10_000)).toBeUndefined()
  })

  it('keeps active trade segments and exports the full trade range instead of capping to the idle buffer', async () => {
    const source = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')

    expect(source).toContain('protectSince')
    expect(source).toContain('protectedSinceMs')
    expect(source).toContain('const replayProtectionTimes = new Map<string, number>()')
    expect(source).toContain('replayProtectionTimes.delete(replayProtectionId)')
    expect(source).not.toContain('protectedSinceMs = previousProtectedSinceMs')
    expect(source).toContain('const replayStartMs = trade.entryTimeMs - settings.clip.paddingBeforeSeconds * 1000')
    expect(source).not.toContain('maxReplayWindowMs')
    expect(source).not.toContain('Math.max(requestedReplayStartMs, replayEndMs - maxReplayWindowMs)')
  })

  it('marks built-in replay exports as ready clips and trims browser segments before the pipeline step', async () => {
    const source = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')

    expect(source).toContain('readyClip: true')
    expect(source).toContain('trimReplayFile')
    expect(source).toContain('calculateFfmpegRenderThreads')
    expect(source).toContain("'-filter_threads'")
    expect(source).not.toContain('concatNativeReplayFile')
    expect(source).toContain('replayStartMs')
    expect(source).toContain('replayEndMs')
  })

  it('rebuilds continuous browser sessions from their first chunk', async () => {
    const source = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')

    expect(source).toContain('buildBrowserSessionFile')
    expect(source).toContain('selectBrowserSessionPrefix')
    expect(source).toContain('protectSegmentReads')
    expect(source).toContain('activeSegmentReadCounts.has(segment.path)')
    expect(source).toContain('writeFile(sessionPath, await readFile(firstSegment.path))')
    expect(source).toContain('appendFile(sessionPath')
    expect(source).toContain('cleanup: true')
  })

  it('includes the WebM header chunk when a replay selection begins in the middle of a browser session', () => {
    const chunks = [0, 1, 2, 3, 4, 5].map((sequence) => ({
      backend: 'browser' as const,
      sessionId: 'target-session',
      sequence,
      marker: `chunk-${sequence}`
    }))
    const unrelated = { backend: 'browser' as const, sessionId: 'other-session', sequence: 0, marker: 'other' }

    expect(selectBrowserSessionPrefix([...chunks.slice(3), unrelated, ...chunks.slice(0, 3)], 'target-session', 4))
      .toEqual(chunks.slice(0, 5))
    expect(selectBrowserSessionPrefix(chunks.slice(1), 'target-session', 4)).toBeUndefined()
  })

  it('pins every reconstructed browser session to its wall-clock duration in the concat manifest', () => {
    expect(buildReplayConcatManifest([
      {
        path: 'C:/cache/session-1.webm',
        startedAtMs: 1_000,
        endedAtMs: 61_010
      },
      {
        path: "C:/cache/session-'2'.webm",
        startedAtMs: 61_011,
        endedAtMs: 121_014
      }
    ])).toBe([
      'ffconcat version 1.0',
      "file 'C:/cache/session-1.webm'",
      'duration 60.010',
      "file 'C:/cache/session-'\\''2'\\''.webm'",
      'duration 60.003',
      ''
    ].join('\n'))
  })

  it('rejects a reconstructed browser session without positive wall-clock duration', () => {
    expect(() => buildReplayConcatManifest([{
      path: 'C:/cache/broken.webm',
      startedAtMs: 10_000,
      endedAtMs: 10_000
    }])).toThrow('Сессия встроенной записи имеет некорректную длительность')
  })

  it('plans three browser sessions on absolute wall time without accumulating gap offsets', () => {
    const plan = planBrowserSessionTimeline([
      { startedAtMs: 1_000, endedAtMs: 11_000 },
      { startedAtMs: 12_500, endedAtMs: 22_500 },
      { startedAtMs: 23_000, endedAtMs: 33_000 }
    ])

    expect(plan).toEqual({
      timelineStartMs: 1_000,
      timelineEndMs: 33_000,
      durationSeconds: 32,
      slices: [
        { inputIndex: 0, sourceStartSeconds: 0, contentDurationSeconds: 10, gapAfterSeconds: 1.5, outputDurationSeconds: 11.5 },
        { inputIndex: 1, sourceStartSeconds: 0, contentDurationSeconds: 10, gapAfterSeconds: 0.5, outputDurationSeconds: 10.5 },
        { inputIndex: 2, sourceStartSeconds: 0, contentDurationSeconds: 10, gapAfterSeconds: 0, outputDurationSeconds: 10 }
      ]
    })
    expect(plan.slices.reduce((sum, slice) => sum + slice.outputDurationSeconds, 0)).toBe(plan.durationSeconds)
  })

  it('trims overlapping browser sessions by absolute wall time and skips fully covered inputs', () => {
    expect(planBrowserSessionTimeline([
      { startedAtMs: 1_000, endedAtMs: 11_000 },
      { startedAtMs: 10_500, endedAtMs: 12_000 },
      { startedAtMs: 9_000, endedAtMs: 15_000 }
    ])).toEqual({
      timelineStartMs: 1_000,
      timelineEndMs: 15_000,
      durationSeconds: 14,
      slices: [
        { inputIndex: 0, sourceStartSeconds: 0, contentDurationSeconds: 10, gapAfterSeconds: 0, outputDurationSeconds: 10 },
        { inputIndex: 2, sourceStartSeconds: 2, contentDurationSeconds: 4, gapAfterSeconds: 0, outputDurationSeconds: 4 }
      ]
    })
  })

  it('rejects a browser session when 60 seconds of wall time contain only 40 seconds of video', () => {
    const sessionFiles = [{
      path: 'C:/cache/truncated.webm',
      startedAtMs: 1_000,
      endedAtMs: 61_000,
      ...browserVideoMetadata(40)
    }]

    expect(() => assertBrowserSessionVideoCoverage(
      sessionFiles,
      planBrowserSessionTimeline(sessionFiles)
    )).toThrow('доступно 40.000с, нужно 60.000с')
  })

  it('allows only the bounded browser video timestamp drift observed in valid sessions', () => {
    const sessionFiles = [{
      path: 'C:/cache/valid.webm',
      startedAtMs: 1_000,
      endedAtMs: 61_004,
      ...browserVideoMetadata(59.343, 0.044, 0.174)
    }]

    expect(() => assertBrowserSessionVideoCoverage(
      sessionFiles,
      planBrowserSessionTimeline(sessionFiles)
    )).not.toThrow()
  })

  it('sorts browser packets and treats N/A packet duration as zero', () => {
    const metadata = parseBrowserSessionVideoPacketMetadata(JSON.stringify({
      packets: [
        { pts_time: '0.034000', duration_time: 'N/A' },
        { pts_time: '0.000000', duration_time: '0.017000' },
        { pts_time: '0.017000', duration_time: 'N/A' }
      ]
    }))

    expect(metadata?.firstVideoPacketSeconds).toBe(0)
    expect(metadata?.videoDurationSeconds).toBeCloseTo(0.034)
    expect(metadata?.maxVideoPacketGapSeconds).toBeCloseTo(0.017)
  })

  it('rejects a browser session that contains a large internal packet gap', () => {
    const metadata = parseBrowserSessionVideoPacketMetadata(JSON.stringify({
      packets: [
        { pts_time: '60.000000', duration_time: 'N/A' },
        { pts_time: '0.000000', duration_time: 'N/A' }
      ]
    }))
    expect(metadata).toBeDefined()
    const sessionFiles = [{
      path: 'C:/cache/internal-gap.webm',
      startedAtMs: 1_000,
      endedAtMs: 61_000,
      ...metadata!
    }]

    expect(() => assertBrowserSessionVideoCoverage(
      sessionFiles,
      planBrowserSessionTimeline(sessionFiles)
    )).toThrow('разрыв 60.000с')
  })

  it('rejects a browser session whose first video packet is delayed by more than two seconds', () => {
    const sessionFiles = [{
      path: 'C:/cache/delayed-start.webm',
      startedAtMs: 1_000,
      endedAtMs: 61_000,
      ...browserVideoMetadata(60, 2.001, 0.1)
    }]

    expect(() => assertBrowserSessionVideoCoverage(
      sessionFiles,
      planBrowserSessionTimeline(sessionFiles)
    )).toThrow('первый кадр появился через 2.001с')
  })

  it('concatenates browser session streams on their wall-clock timeline', () => {
    expect(buildBrowserSessionConcatFilter({
      sessionFiles: [
        { path: 'C:/cache/session-1.webm', startedAtMs: 1_000, endedAtMs: 61_000, ...browserVideoMetadata(59.343, 0, 0.174), hasAudio: true },
        { path: 'C:/cache/session-2.webm', startedAtMs: 62_500, endedAtMs: 122_500, ...browserVideoMetadata(59.907, 0.044, 0.105), hasAudio: true }
      ],
      startSeconds: 50,
      durationSeconds: 20,
      hasAudio: true
    })).toBe([
      '[0:v:0]setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=2.000,trim=start=0.000:duration=60.000,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=1.500,trim=duration=61.500,setpts=PTS-STARTPTS[v0]',
      '[0:a:0]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS,apad=pad_dur=60.000,atrim=start=0.000:duration=60.000,asetpts=PTS-STARTPTS,apad=pad_dur=61.500,atrim=duration=61.500,asetpts=PTS-STARTPTS[a0]',
      '[1:v:0]setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=2.000,trim=start=0.000:duration=60.000,setpts=PTS-STARTPTS,trim=duration=60.000,setpts=PTS-STARTPTS[v1]',
      '[1:a:0]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS,apad=pad_dur=60.000,atrim=start=0.000:duration=60.000,asetpts=PTS-STARTPTS,apad=pad_dur=60.000,atrim=duration=60.000,asetpts=PTS-STARTPTS[a1]',
      '[v0][a0][v1][a1]concat=n=2:v=1:a=1[vcat][acat]',
      '[vcat]trim=start=50.000:duration=20.000,setpts=PTS-STARTPTS[vout]',
      '[acat]atrim=start=50.000:duration=20.000,asetpts=PTS-STARTPTS[aout]'
    ].join(';'))

    const overlapFilter = buildBrowserSessionConcatFilter({
      sessionFiles: [
        { path: 'C:/cache/session-1.webm', startedAtMs: 1_000, endedAtMs: 11_000, ...browserVideoMetadata(9.5) },
        { path: 'C:/cache/session-2.webm', startedAtMs: 10_000, endedAtMs: 21_000, ...browserVideoMetadata(10.5) }
      ],
      startSeconds: 0,
      durationSeconds: 15,
      hasAudio: false
    })
    expect(overlapFilter).toContain('[1:v:0]setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=2.000,trim=start=1.000:duration=10.000')
    expect(overlapFilter).toContain('[v0][v1]concat=n=2:v=1:a=0[vcat]')
  })

  it('keeps requested browser concat audio when some reconstructed sessions are silent', async () => {
    expect(shouldConcatBrowserAudio([{ hasAudio: true }, { hasAudio: true }], true)).toBe(true)
    expect(shouldConcatBrowserAudio([{ hasAudio: true }, { hasAudio: false }], true)).toBe(true)
    expect(shouldConcatBrowserAudio([{ hasAudio: false }, { hasAudio: false }], true)).toBe(true)
    expect(shouldConcatBrowserAudio([{ hasAudio: true }, {}], true)).toBe(true)
    expect(shouldConcatBrowserAudio([{ hasAudio: true }, { hasAudio: true }], false)).toBe(false)
    expect(shouldConcatBrowserAudio([], true)).toBe(false)

    const source = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')
    expect(source).toContain("'-select_streams',\n        'a:0'")
    expect(source).toContain('probeBrowserSessionHasAudio(path)')
    expect(source).toContain('hasAudio,')
    expect(source).toContain('shouldConcatBrowserAudio(sessionFiles, browserAudioEnabled(settings))')
  })

  it('waits for ffprobe output streams to close before parsing browser sessions', async () => {
    const source = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')
    const probeStart = source.indexOf('const probeBrowserSessionHasAudio')
    const probeEnd = source.indexOf('const probeBrowserSessionMedia')
    const probeSource = source.slice(probeStart, probeEnd)

    expect(probeStart).toBeGreaterThanOrEqual(0)
    expect(probeEnd).toBeGreaterThan(probeStart)
    expect(probeSource.match(/child\.once\('close'/g)).toHaveLength(2)
    expect(probeSource).not.toContain("child.on('exit'")
  })

  it('fills missing browser session audio with timeline-sized silence', () => {
    const mixedFilter = buildBrowserSessionConcatFilter({
      sessionFiles: [
        { path: 'C:/cache/session-1.webm', startedAtMs: 1_000, endedAtMs: 11_000, ...browserVideoMetadata(9.5), hasAudio: true },
        { path: 'C:/cache/session-2.webm', startedAtMs: 12_500, endedAtMs: 22_500, ...browserVideoMetadata(9.5), hasAudio: false }
      ],
      startSeconds: 0,
      durationSeconds: 21.5,
      hasAudio: true
    })
    expect(mixedFilter).toContain('[0:a:0]aformat=sample_rates=48000:channel_layouts=stereo')
    expect(mixedFilter).toContain('anullsrc=r=48000:cl=stereo,atrim=duration=10.000,asetpts=PTS-STARTPTS[a1]')
    expect(mixedFilter).not.toContain('[1:a:0]')
    expect(mixedFilter).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[vcat][acat]')

    const silentFilter = buildBrowserSessionConcatFilter({
      sessionFiles: [
        { path: 'C:/cache/session-1.webm', startedAtMs: 1_000, endedAtMs: 11_000, ...browserVideoMetadata(9.5), hasAudio: false },
        { path: 'C:/cache/session-2.webm', startedAtMs: 12_500, endedAtMs: 22_500, ...browserVideoMetadata(9.5), hasAudio: false }
      ],
      startSeconds: 0,
      durationSeconds: 21.5,
      hasAudio: true
    })
    expect(silentFilter.match(/anullsrc=r=48000:cl=stereo/g)).toHaveLength(2)
    expect(silentFilter).not.toContain(':a:0]')
    expect(silentFilter).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[vcat][acat]')
    expect(silentFilter).toContain('[acat]atrim=start=0.000:duration=21.500,asetpts=PTS-STARTPTS[aout]')

    const disabledFilter = buildBrowserSessionConcatFilter({
      sessionFiles: [
        { path: 'C:/cache/session-1.webm', startedAtMs: 1_000, endedAtMs: 11_000, ...browserVideoMetadata(9.5), hasAudio: false },
        { path: 'C:/cache/session-2.webm', startedAtMs: 12_500, endedAtMs: 22_500, ...browserVideoMetadata(9.5), hasAudio: false }
      ],
      startSeconds: 0,
      durationSeconds: 21.5,
      hasAudio: false
    })
    expect(disabledFilter).not.toContain('anullsrc')
    expect(disabledFilter).toContain('[v0][v1]concat=n=2:v=1:a=0[vcat]')
    expect(disabledFilter).not.toContain('[aout]')
  })

  it('treats a muted browser video track as unusable and restarts the capture session', async () => {
    expect(browserVideoTrackIsUsable({ readyState: 'live', muted: false })).toBe(true)
    expect(browserVideoTrackIsUsable({ readyState: 'live', muted: true })).toBe(false)
    expect(browserVideoTrackIsUsable({ readyState: 'ended', muted: false })).toBe(false)
    expect(shouldPersistBrowserRecorderChunk(1)).toBe(true)
    expect(shouldPersistBrowserRecorderChunk(0)).toBe(false)

    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')
    expect(controllerSource).toContain('some(browserVideoTrackIsUsable)')
    expect(controllerSource).toContain('if (!browserVideoTrackIsUsable(videoTrack)) markSessionDead(session)')
    expect(controllerSource).toContain('if (!shouldPersistBrowserRecorderChunk(event.data.size)) return')
    expect(controllerSource).not.toContain('event.data.size <= 0 || session.dead || videoTrack.muted')
  })

  it('reports a readable message when a needed browser segment file is gone', async () => {
    const source = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')

    expect(source).toContain('assertSegmentFile')
    expect(source).toContain('Часть буфера встроенной записи уже очищена')
    expect(source).toContain('getErrorCode(error) ===')
  })

  it('keeps one MediaRecorder running while it emits chunks for a bounded session', async () => {
    const serviceSource = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')

    expect(controllerSource).toContain('const browserRecordingSessionDurationMs = 60_000')
    expect(controllerSource).toContain('recorder.start(chunkDurationMs)')
    expect(controllerSource).not.toContain('}, chunkDurationMs)')
    expect(serviceSource).toContain('cleanup?: boolean')
    expect(serviceSource).toContain('appendFile(sessionPath')
  })

  it('reports each browser source ready immediately after MediaRecorder starts', async () => {
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')
    const sessionSource = controllerSource.slice(
      controllerSource.indexOf('const startRecordingSession ='),
      controllerSource.indexOf('      } catch (error)', controllerSource.indexOf('const startRecordingSession ='))
    )

    expect(sessionSource).toContain('chunkStartedAtMs = Date.now()')
    expect(sessionSource.indexOf('recorder.start(chunkDurationMs)')).toBeLessThan(sessionSource.indexOf('api.recording.browserStarted({'))
    expect(sessionSource).toContain('sourceId: source.id')
    expect(sessionSource).toContain('sourceName: source.name')
    expect(sessionSource).toContain('captureEpochId: session.captureEpochId')
    expect(sessionSource).toContain('startedAtMs: chunkStartedAtMs')
    expect(preloadSource).toContain("ipcRenderer.invoke('recording:browser-started', input)")
  })

  it('starts browser video before optional audio and keeps one stable Web Audio track', async () => {
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')
    const sessionSource = controllerSource.slice(
      controllerSource.indexOf('const startRecordingSession ='),
      controllerSource.indexOf('session.sessionTimer = window.setTimeout', controllerSource.indexOf('const startRecordingSession ='))
    )

    expect(sessionSource.indexOf('recorder.start(chunkDurationMs)')).toBeLessThan(sessionSource.indexOf('startOptionalAudioCaptures({'))
    expect(sessionSource).toContain('optionalAudioEnabled && !session.optionalAudioCaptureStarted')
    expect(sessionSource).toContain('session.optionalAudioCaptureStarted = true')
    expect(sessionSource).not.toContain('await captureSystemAudioStream()')
    expect(sessionSource).not.toContain("await navigator.mediaDevices.getUserMedia({ audio: true, video: false })")
    expect(controllerSource).toContain('audioContext.createMediaStreamDestination()')
    expect(controllerSource).toContain('...destination.stream.getAudioTracks()')
    expect(controllerSource).toContain('source.connect(destination)')
    expect(controllerSource).toContain('createRecordingStream(session.browserVideoStream.stream, optionalAudioEnabled)')
    expect(controllerSource).toContain("reportStatus(createLocalStatus(latestSettings, message, true))")
  })

  it('replaces readiness on capture reconnect but keeps it across MediaRecorder chunk sessions', async () => {
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')

    expect(controllerSource).toContain('captureEpochId: `${source.id}-${Date.now()}-')
    expect(controllerSource).toContain('captureEpochId: session.captureEpochId')
    expect(controllerSource).toContain('recording.browserStopped({')
    expect(appSource).toContain('current.captureEpochId !== captureEpochId || startedAtMs < current.startedAtMs')
    expect(appSource).toContain("ipcMain.handle('recording:browser-stopped'")
    expect(appSource).toContain('current?.captureEpochId !== captureEpochId')
    expect(appSource).toContain('browserRecordingStartedBySourceId.delete(sourceId)')
    expect(preloadSource).toContain("ipcRenderer.invoke('recording:browser-stopped', input)")
  })

  it('keeps a browser segment on disk while another recorder is still registering it', async () => {
    const serviceSource = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')

    expect(serviceSource).toContain('const pendingSegmentPaths = new Set<string>()')
    expect(serviceSource).toContain('pendingSegmentPaths.add(path)')
    expect(serviceSource).toContain('pendingSegmentPaths.delete(path)')
    expect(serviceSource).toContain('new Set([...segments.map((segment) => segment.path), ...pendingSegmentPaths, ...activeSegmentReadCounts.keys()])')
  })

  it('records the Chromium fallback directly with preset-aware bitrate', async () => {
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')

    expect(controllerSource).toContain('createBrowserVideoStream')
    expect(controllerSource).toContain('sampleFrameTimer')
    expect(controllerSource.indexOf("'video/webm;codecs=vp9,opus'")).toBeLessThan(controllerSource.indexOf("'video/webm;codecs=vp8,opus'"))
    expect(browserVideoBitrate('1080p', 60)).toBe(12_000_000)
    expect(browserVideoBitrate('1440p', 60)).toBe(24_000_000)
    expect(browserVideoBitrate('native', 30)).toBe(60_000_000)
    expect(browserVideoBitrate('native', 60)).toBe(90_000_000)
    expect(browserCaptureFrameRate(59.94)).toBe(59.94)
    expect(browserCaptureFrameRate(5)).toBe(10)
    expect(browserCaptureFrameRate(120)).toBe(60)
    expect(browserCaptureFrameRate(Number.NaN)).toBe(30)
    expect(controllerSource).toContain('videoBitsPerSecond: browserVideoBitrate')
    expect(controllerSource).not.toContain('canvas.captureStream')
    expect(controllerSource).not.toContain('window.setInterval(drawFrame')
  })

  it('reports black window capture without switching recording settings to another monitor', async () => {
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')

    expect(controllerSource).toContain('Окно записи отдаёт чёрный кадр')
    expect(controllerSource).not.toContain("sourceType: 'screen'")
    expect(controllerSource).not.toContain('Переключаемся на запись экрана')
  })

  it('filters built-in replay segments by the requested capture target', async () => {
    const serviceSource = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')

    expect(serviceSource).toContain('captureTarget?: CaptureTargetRef')
    expect(serviceSource).toContain('targetMatchesSegment')
    expect(serviceSource).toContain('terminalTitleMatchesTicker(segment.sourceName, captureTarget.symbol)')
    expect(controllerSource).toContain('terminalTitleMatchesTicker(source.name, target.symbol)')
    expect(serviceSource).toContain('relevantSegments(settings, captureTarget')
    expect(serviceSource).toContain('waitForSegmentsUntil(settings, replayEndMs, timeoutMs, captureTarget)')
    expect(serviceSource).toContain('exportReplay(settings, trade, captureTarget')
  })

  it('lets the renderer run one Chromium recorder per selected capture target', async () => {
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')

    expect(controllerSource).toContain('resolveRecordingTargets')
    expect(controllerSource).toContain('settings.recording.captureTargets')
    expect(controllerSource).toContain('startBrowserRecorder')
    expect(controllerSource).toContain('browserRecorders')
    expect(controllerSource).toContain('targets.length > 1')
  })

  it('refreshes active browser status from persisted segments instead of publishing a zero buffer', async () => {
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')
    const activeStatusStart = controllerSource.indexOf('const activeSources = targets.filter')
    const activeStatusEnd = controllerSource.indexOf('      } else {', activeStatusStart)
    const activeStatusSource = controllerSource.slice(activeStatusStart, activeStatusEnd)

    expect(activeStatusSource).toContain('const status = await api.recording.getStatus()')
    expect(activeStatusSource).toContain('mergeBrowserRecorderStatus')
    expect(activeStatusSource).not.toContain('createLocalStatus')
  })

  it('keeps persisted buffer metrics when a saved source temporarily disappears', async () => {
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')
    const missingTargetStart = controllerSource.indexOf('if (targets.length === 0) {')
    const missingTargetEnd = controllerSource.indexOf('      if (sourceRetryTimer', missingTargetStart)
    const missingTargetSource = controllerSource.slice(missingTargetStart, missingTargetEnd)

    expect(missingTargetSource).toContain('const status = await api.recording.getStatus()')
    expect(missingTargetSource).toContain('mergeBrowserRecorderStatus(status, activeSources, message)')
    expect(missingTargetSource).not.toContain('createLocalStatus')
  })

  it('never persists an auto-detected terminal over a concurrent explicit selection', async () => {
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')

    expect(controllerSource).not.toContain('findPreferredTerminalSource')
    expect(controllerSource).not.toContain('Автоматически выбрали окно терминала')
  })

  it('uses native ddagrab for screen capture targets instead of black Chromium screen streams or flickery GDI capture', async () => {
    const serviceSource = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(appSource).toContain('getDisplayBounds')
    expect(serviceSource).toContain('ScreenCaptureBounds')
    expect(serviceSource).toContain('nativeScreenTargets')
    expect(serviceSource).toContain("inputBackend: 'ddagrab'")
    expect(serviceSource).toContain('screenOutputIndex')
    expect(serviceSource).toContain('ddagrab=output_idx=${target.outputIndex ?? 0}:framerate=${frameRate}:draw_mouse=0')
    expect(serviceSource).toContain("'lavfi'")
    expect(serviceSource).not.toContain('Запись экрана идёт через Chromium')
    expect(controllerSource.indexOf('const optimizedStatus = await api.recording.start()')).toBeLessThan(controllerSource.indexOf('targetsToStart.length > 0 && targets.length > 1'))
    expect(controllerSource).toContain('screenTargetsNeedSync')
    expect(controllerSource).toContain('!target.displayId')
    expect(controllerSource).toContain('expectedRecordingSourceRevision: recordingSourceRevision(currentSettings.recording)')
    expect(controllerSource).not.toContain('...currentSettings.recording')
  })

  it('records native screens at their source resolution and the exact selected frame rate', () => {
    const defaults = createDefaultSettings('C:/app-data')
    const settings = {
      ...defaults,
      recording: {
        ...defaults.recording,
        mode: 'window' as const,
        sourceType: 'screen' as const,
        resolutionPreset: 'native' as const,
        frameRate: 60,
        segmentSeconds: 10,
        videoEncoder: 'gpu:nvidia:1' as const
      }
    }
    const args = buildNativeRecorderArgs(settings, 'C:/segments/out-%06d.mp4', 'C:/segments/list.csv', {
      sourceId: 'screen:0:0',
      sourceName: '3440x1440 monitor',
      inputBackend: 'ddagrab',
      inputName: 'ddagrab',
      outputIndex: 0,
      bounds: { displayId: 'display-1', x: 0, y: 0, width: 3440, height: 1440 }
    }, 'win32')

    expect(args[args.indexOf('-i') + 1]).toContain('framerate=60')
    expect(args).not.toContain('-vf')
    expect(args).toEqual(expect.arrayContaining([
      '-filter_threads', '1', '-threads', '1',
      '-c:v', 'h264_nvenc', '-gpu', '1', '-cq', '14', '-b:v', '60M',
      '-r', '60', '-g', '600'
    ]))
  })

  it('uses high-bitrate Chromium capture for terminal windows without cursor interference', async () => {
    const serviceSource = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(serviceSource).toContain('Окна терминалов пишутся через Chromium без захвата курсора')
    expect(serviceSource).not.toContain("'gdigrab'")
    expect(serviceSource).not.toContain('TRADETOOLS_ENABLE_GDIGRAB')
    expect(controllerSource).toContain("'video/webm;codecs=vp9'")
    expect(controllerSource).toContain('videoBitsPerSecond: browserVideoBitrate')
    expect(controllerSource).toContain('maxWidth: 2560')
    expect(controllerSource).toContain('maxHeight: 1440')
    expect(serviceSource).toContain('fallbackRequired')
    expect(controllerSource).toContain('recording.start()')
    expect(controllerSource).toContain('recording.stop()')
    expect(controllerSource).toContain('fallbackRequired')
    expect(preloadSource).toContain("ipcRenderer.invoke('recording:start'")
    expect(appSource).toContain("ipcMain.handle('recording:start'")
  })

  it('sets native recorder GOP to the segment length so ffmpeg segment lists keep advancing', async () => {
    const serviceSource = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')

    expect(serviceSource).toContain('const segmentFrameCount')
    expect(serviceSource).toContain("'-g'")
    expect(serviceSource).toContain('segmentFrameCount')
  })

  it('avoids cursor capture in both native screen recording and the Chromium fallback', async () => {
    const serviceSource = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')

    expect(serviceSource).toContain("settings.recording.sourceType === 'screen'")
    expect(serviceSource).toContain('draw_mouse=0')
    expect(controllerSource).toContain("cursor: 'never'")
  })

  it('marks a partial native multi-screen recorder set for restart instead of reporting it as healthy', async () => {
    const serviceSource = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')
    const settingsKeySource = serviceSource.slice(
      serviceSource.indexOf('const nativeSettingsKey'),
      serviceSource.indexOf('const screenOutputIndex')
    )

    expect(serviceSource).toContain('expectedNativeRecorderSettingsKeys')
    expect(serviceSource).toContain('activeNativeRecorderSettingsKeys')
    expect(serviceSource).toContain("settings.recording.sourceType === 'screen'")
    expect(settingsKeySource).toContain('settings.recording.videoEncoder')
    expect(settingsKeySource).toContain('settings.recording.resolutionPreset')
    expect(serviceSource).toContain('Часть ffmpeg-рекордеров экранов остановилась')
    expect(serviceSource).toContain('fallbackRequired: true')
  })

  it('does not auto-select every screen when screen capture has no selected targets', async () => {
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')

    expect(controllerSource).toContain('Выберите хотя бы один монитор в настройках записи.')
    expect(controllerSource).not.toContain("if (settings.recording.sourceType === 'screen') return sources.filter")
    expect(controllerSource).not.toContain('Автоматически выбрали экран')
  })

  it('throttles source retries and native status polling to avoid source-scan thread buildup', async () => {
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')

    expect(controllerSource).toContain('sourceRetryDelayMs')
    expect(controllerSource).toContain('15_000')
    expect(controllerSource).toContain('nativeStatusPollMs')
    expect(controllerSource).toContain('5_000')
    expect(controllerSource).not.toContain('}, 2_000)')
  })

  it('uses Chromium capture for audio-enabled built-in recording and keeps audio in browser exports', async () => {
    const serviceSource = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')

    expect(serviceSource).toContain('settings.recording.systemAudioEnabled || settings.recording.microphoneEnabled')
    expect(serviceSource).toContain('Звук встроен в видео через Chromium')
    expect(serviceSource).not.toContain('Звук пишется через Chromium')
    expect(serviceSource).toContain("'0:a?'")
    expect(serviceSource).toContain("'-c:a'")
    expect(serviceSource).toContain("'aac'")
    expect(controllerSource).toContain('chromeMediaSourceId: sourceId')
    expect(controllerSource).toContain('getAudioTracks()')
  })

  it('keeps free recording segments and exports a stocks-book recording file', async () => {
    const serviceSource = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(serviceSource).toContain('FreeRecordingStatus')
    expect(serviceSource).toContain('freeRecording?.startedAtMs')
    expect(serviceSource).toContain('startFreeRecording')
    expect(serviceSource).toContain('pauseFreeRecording')
    expect(serviceSource).toContain('resumeFreeRecording')
    expect(serviceSource).toContain('finishFreeRecording')
    expect(serviceSource).toContain('Запись стаканов')
    expect(serviceSource).toContain('sessionFiles = await buildSessionFiles')
    expect(serviceSource).toContain('await trimReplayFile(sessionFiles')
    expect(preloadSource).toContain("ipcRenderer.invoke('recording:free-status'")
    expect(appSource).toContain("ipcMain.handle('recording:free-start'")
  })

  it('marks free recording stopped before waiting for export segments so Finish never looks like Pause', async () => {
    const serviceSource = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const finishStart = serviceSource.indexOf('const finishFreeRecording = async')
    const finishSource = serviceSource.slice(finishStart, serviceSource.indexOf('const getWindowRecorderStatus', finishStart))

    expect(finishSource.indexOf('freeRecording = undefined')).toBeGreaterThan(-1)
    expect(finishSource.indexOf('freeRecording = undefined')).toBeLessThan(finishSource.indexOf('waitForSegmentsUntil(settings, targetEndMs'))
    expect(finishSource).toContain('freeRecordingExportProtectedSinceMs')
    expect(dashboardSource).toContain("active: false, paused: false, message: 'Сохраняем свободную запись...'")
  })
})
