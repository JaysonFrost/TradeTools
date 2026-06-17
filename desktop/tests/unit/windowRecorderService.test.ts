import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createWindowRecorderService, selectAvailableReplayWindow } from '../../src/main/services/recording/windowRecorderService'
import { createDefaultSettings } from '../../src/main/services/settings/settings'

describe('windowRecorderService', () => {
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

  it('treats gdigrab missing-window exits as a closed terminal window instead of raw ffmpeg spam', async () => {
    const source = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')

    expect(source).toContain('isMissingNativeWindowError')
    expect(source).toContain("Can't find window")
    expect(source).toContain('markNativeMissingSource')
    expect(source).toContain('nativeLastError = \'\'')
    expect(source).not.toContain('ffmpeg-рекордер остановился: [gdigrab')
  })

  it('reports buffered and required seconds when replay export is requested too early', async () => {
    const source = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')

    expect(source).toContain('const formatRoundedSeconds')
    expect(source).toContain('const bufferedSeconds')
    expect(source).toContain('const requiredSeconds')
    expect(source).toContain('Накоплено ${formatRoundedSeconds(bufferedSeconds)}')
    expect(source).toContain('selectAvailableReplayWindow')
  })

  it('falls back to the nearest built-in segment when the requested trade window is not buffered', () => {
    const requestedStartMs = Date.parse('2026-06-17T17:47:04.000Z')
    const requestedEndMs = Date.parse('2026-06-17T17:47:10.000Z')
    const nearestSegment = {
      id: 'after-trade',
      startedAtMs: Date.parse('2026-06-17T17:47:20.000Z'),
      endedAtMs: Date.parse('2026-06-17T17:47:22.000Z')
    }

    const selection = selectAvailableReplayWindow([nearestSegment], requestedStartMs, requestedEndMs)

    expect(selection).toEqual({
      segments: [nearestSegment],
      replayStartMs: nearestSegment.startedAtMs,
      replayEndMs: nearestSegment.endedAtMs
    })
  })

  it('keeps active trade segments and exports the full trade range instead of capping to the idle buffer', async () => {
    const source = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')

    expect(source).toContain('protectSince')
    expect(source).toContain('protectedSinceMs')
    expect(source).toContain('const replayStartMs = trade.entryTimeMs - settings.clip.paddingBeforeSeconds * 1000')
    expect(source).not.toContain('maxReplayWindowMs')
    expect(source).not.toContain('Math.max(requestedReplayStartMs, replayEndMs - maxReplayWindowMs)')
  })

  it('marks built-in replay exports as ready clips and trims browser segments before the pipeline step', async () => {
    const source = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')

    expect(source).toContain('readyClip: true')
    expect(source).toContain('trimBrowserReplayFile')
    expect(source).toContain('replayStartMs')
    expect(source).toContain('replayEndMs')
  })

  it('does not read old browser session segments outside the requested replay range', async () => {
    const source = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')

    expect(source).toContain('buildSessionFiles = async (neededSegments')
    expect(source).not.toContain('sourceSegments: StoredSegment[], neededSegments')
    expect(source).not.toContain('firstSequence !== 0')
  })

  it('reports a readable message when a needed browser segment file is gone', async () => {
    const source = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')

    expect(source).toContain('assertSegmentFile')
    expect(source).toContain('Часть буфера встроенной записи уже очищена')
    expect(source).toContain('getErrorCode(error) ===')
  })

  it('keeps browser recorder chunks as standalone webm files for ffmpeg concat', async () => {
    const serviceSource = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')

    expect(controllerSource).toContain('recorder.start()')
    expect(controllerSource).not.toContain('recorder.start(chunkDurationMs)')
    expect(serviceSource).toContain('cleanup?: boolean')
    expect(serviceSource).toContain('neededSegments.map')
    expect(serviceSource).not.toContain('appendFile(sessionPath')
  })

  it('keeps the ffmpeg gdigrab recorder behind an explicit opt-in before falling back to browser capture', async () => {
    const serviceSource = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(serviceSource).toContain("'-f',")
    expect(serviceSource).toContain("'gdigrab'")
    expect(serviceSource).toMatch(/'-draw_mouse',\s*'0'/)
    expect(serviceSource).toContain("'-segment_list'")
    expect(serviceSource).toContain("backend: 'ffmpeg'")
    expect(serviceSource).toContain("buildH264VideoArgs({ platform: process.platform, purpose: 'recording' })")
    expect(serviceSource).toContain('TRADETOOLS_ENABLE_GDIGRAB')
    expect(serviceSource).toContain('Фоновый GDI-захват отключён')
    expect(serviceSource).toContain('fallbackRequired')
    expect(controllerSource).toContain('recording.start()')
    expect(controllerSource).toContain('recording.stop()')
    expect(controllerSource).toContain('fallbackRequired')
    expect(preloadSource).toContain("ipcRenderer.invoke('recording:start'")
    expect(appSource).toContain("ipcMain.handle('recording:start'")
  })

  it('avoids cursor capture in the Chromium fallback and avoids the gdigrab screen backend', async () => {
    const serviceSource = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')

    expect(serviceSource).toContain("settings.recording.sourceType === 'screen'")
    expect(serviceSource).toContain('не мигает курсор Windows')
    expect(controllerSource).toContain("cursor: 'never'")
  })

  it('auto-selects the first screen when screen capture has no saved source', async () => {
    const controllerSource = await readFile(resolve('src/renderer/components/recording/WindowRecorderController.tsx'), 'utf8')

    expect(controllerSource).toContain("candidate.type === 'screen'")
    expect(controllerSource).toContain('Автоматически выбрали экран')
    expect(controllerSource).not.toContain('Выбранный экран не найден. Обновите список источников.')
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
    expect(serviceSource).toContain('writeReplayFromSegments')
    expect(preloadSource).toContain("ipcRenderer.invoke('recording:free-status'")
    expect(appSource).toContain("ipcMain.handle('recording:free-start'")
  })
})
