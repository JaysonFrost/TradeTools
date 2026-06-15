import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('windowRecorderService', () => {
  it('reports buffered and required seconds when replay export is requested too early', async () => {
    const source = await readFile(resolve('src/main/services/recording/windowRecorderService.ts'), 'utf8')

    expect(source).toContain('const formatRoundedSeconds')
    expect(source).toContain('const bufferedSeconds')
    expect(source).toContain('const requiredSeconds')
    expect(source).toContain('Накоплено ${formatRoundedSeconds(bufferedSeconds)}')
    expect(source).toContain('нужно примерно ${formatRoundedSeconds(requiredSeconds)}')
    expect(source).toContain('Осталось примерно ${formatRoundedSeconds(remainingSeconds)}')
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

  it('uses ffmpeg gdigrab for Windows window capture before falling back to browser capture', async () => {
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
    expect(serviceSource).not.toContain('TRADETOOLS_ENABLE_GDIGRAB')
    expect(serviceSource).not.toContain('Фоновый GDI-захват отключён')
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
