import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('main app lifecycle', () => {
  it('disables Windows Graphics Capture to avoid stale desktop frames', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).toContain('windowsDesktopCaptureFallbackFeatures')
    expect(source).toContain('AllowWgcWindowCapturer')
    expect(source).toContain('AllowWgcScreenCapturer')
    expect(source).toContain("app.commandLine.appendSwitch('disable-features'")
  })

  it('passes video readiness into the automatic terminal trade watcher', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).toContain('const ensureObsReplayBufferActive')
    expect(source).toContain('const ensureVideoRecordingReady')
    expect(source).toContain('createTerminalTradeWatcher')
    expect(source).toContain('ensureVideoRecordingReady,')
    expect(source).toContain('terminalTradeWatcher.start()')
  })

  it('does not wake the renderer recorder when background window recording is stopped', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).toContain('let backgroundWindowRecordingEnabled = true')
    expect(source).toContain('if (!backgroundWindowRecordingEnabled) return false')
    expect(source).toContain('backgroundWindowRecordingEnabled = true')
    expect(source).toContain('backgroundWindowRecordingEnabled = false')
    expect(source).toContain('notifyWindowRecordingNeeded')
    expect(source).toContain("webContents.send('recording:ensure-window')")
    expect(source).toContain('await windowRecorderService.start(settings)')
    expect(source).toContain('started.fallbackRequired')
  })

  it('restarts built-in recording when the recorder status asks for recovery', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).toContain('if (!status.active || status.fallbackRequired)')
    expect(source).toContain('notifyWindowRecordingNeeded()')
    expect(source).toContain('await windowRecorderService.start(settings)')
  })

  it('routes macOS system audio through display media loopback into the selected capture source', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')
    const packageJson = await readFile(resolve('package.json'), 'utf8')

    expect(source).toContain('setDisplayMediaRequestHandler')
    expect(source).toContain("audio: settings.recording.systemAudioEnabled ? 'loopback' : undefined")
    expect(source).toContain('source.id === settings.recording.windowSourceId')
    expect(packageJson).toContain('NSAudioCaptureUsageDescription')
  })

  it('does not fall back to another terminal window when a saved capture window is missing', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).toContain('const hasSavedCaptureSource = Boolean(settings.recording.windowSourceId || settings.recording.windowSourceName)')
    expect(source).toContain('hasSavedCaptureSource ? undefined : sources.find')
  })

  it('keeps unnamed desktop capture windows selectable instead of dropping them', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).toContain('source.name.trim() ||')
    expect(source).not.toContain("filter((source) => source.name.trim().length > 0)")
  })

  it('does not keep Binance API polling code in the main process', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).not.toContain('createBinanceFuturesClient')
    expect(source).not.toContain('createBinanceFuturesClipWatcher')
    expect(source).not.toContain('startBinanceFuturesPolling')
    expect(source).not.toContain("ipcMain.handle('binance:")
  })

  it('protects built-in recording segments while a terminal trade is open', async () => {
    const source = await readFile(resolve('src/main/services/trades/terminalTradeRecorder.ts'), 'utf8')

    expect(source).toContain('protectSince()')
    expect(source).toContain('protectActiveTrades')
    expect(source).toContain('earliestEntryTimeMs - settings.clip.paddingBeforeSeconds * 1000')
  })

  it('queues clip rendering jobs without blocking terminal trade event processing', async () => {
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')
    const watcherSource = await readFile(resolve('src/main/services/trades/terminalTradeRecorder.ts'), 'utf8')

    expect(appSource).toContain('clipRenderQueue')
    expect(appSource).toContain('enqueueClipRender')
    expect(appSource).toContain('runClipRenderQueue')
    expect(appSource).toContain('activeClipRenderJob')
    expect(appSource).toContain('applyWindowRecorderProtection')
    expect(appSource).toContain('watcherProtectedSinceMs')
    expect(appSource).toContain('createClipForClosedTrade: queueClipForClosedTrade')
    expect(appSource).toContain("ipcMain.handle('clips:get-processing-status', () => currentClipProcessingStatus())")
    expect(watcherSource).toContain('поставлен в очередь')
    expect(watcherSource).not.toContain('клип ${closedTrade.symbol} сохранён')
  })

  it('expands built-in multi-monitor trades into target-specific render jobs', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).toContain('selectClipRenderTargets')
    expect(source).toContain("settings.recording.saveTargetMode === 'all'")
    expect(source).toContain('captureTarget: target')
    expect(source).toContain('recordingTarget: target')
    expect(source).toContain('queueClipForClosedTrade')
    expect(source).toContain('createClipForClosedTrade: queueClipForClosedTrade')
    expect(source).toContain("if (settings.recording.sourceType === 'screen') return undefined")
  })

  it('routes screen-mode terminal trades to the selected monitor that owns the terminal window when Electron exposes display id', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).toContain("settings.recording.sourceType === 'screen' && settings.recording.saveTradeDisplayOnly")
    expect(source).toContain('listWindowBounds')
    expect(source).toContain('electronScreen.getDisplayMatching(bounds).id')
    expect(source).toContain('listWindowProcessIds')
    expect(source).toContain('event.processId')
    expect(source).toContain('candidate.processId === event.processId')
    expect(source).toContain('const matchingScreenTarget = targets.find')
    expect(source).toContain("candidate.type === 'screen' && Boolean(candidate.displayId) && candidate.displayId === source.displayId")
    expect(source).toContain('Terminal trade display matched screen capture target')
    expect(source).toContain('Terminal trade window found but display has no selected screen capture target')
  })

  it('distinguishes multiple terminal windows from the same Windows process before choosing a trade monitor', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).toContain('GetWindowThreadProcessId')
    expect(source).toContain('listWindowProcessIds(windowIds)')
    expect(source).toContain('const foregroundWindowId = getForegroundWindowId()')
    expect(source).toContain('const cursorPoint = electronScreen.getCursorScreenPoint()')
    expect(source).toContain('selectTerminalSource')
    expect(source).toContain("reason: 'ambiguous'")
    expect(source).toContain('Terminal process has multiple matching windows; using focused or cursor window')
  })

  it('does not save an arbitrary screen when trade display matching is unavailable', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')
    const branch = source.slice(
      source.indexOf("if (settings.recording.sourceType === 'screen' && settings.recording.saveTradeDisplayOnly)"),
      source.indexOf("if (settings.recording.sourceType === 'screen') return undefined")
    )

    expect(source).toContain('tradeDisplayOnlyWithoutResolvedTarget')
    expect(source).toContain("appLog.warn('clip-queue', 'Clip render skipped because trade monitor was not resolved'")
    expect(branch).toContain('return undefined')
    expect(branch).not.toContain('return screenFallbackTarget')
    expect(source).not.toContain('saving selected screen target instead of all screens')
  })

  it('updates built-in window recording targets when a terminal trade comes from another window', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).toContain('resolveTerminalRecordingTarget')
    expect(source).toContain('nextCaptureTargets')
    expect(source).toContain('notifyWindowRecordingNeeded()')
    expect(source).toContain('captureTargets: nextCaptureTargets')
  })

  it('can cancel queued and active clip render jobs', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')

    expect(source).toContain('abortController: AbortController')
    expect(source).toContain('activeJobId')
    expect(source).toContain('queuedJobs')
    expect(source).toContain('abortController.abort()')
    expect(source).toContain("ipcMain.handle('clips:cancel-render'")
    expect(preloadSource).toContain("ipcRenderer.invoke('clips:cancel-render'")
  })

  it('creates manual buffer clips without routing through the fake BTC test trade', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')

    expect(source).toContain("ipcMain.handle('clips:create-buffer'")
    expect(source).toContain('createManualBufferClip')
    expect(source).not.toContain('createSimulatedClosedTrade(Date.now()')
    expect(preloadSource).toContain("ipcRenderer.invoke('clips:create-buffer'")
  })

  it('records clip render failures and queue activity in the user diagnostics log', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).toContain('createAppLogService')
    expect(source).toContain("appLog.info('clip-queue', 'Clip render queued'")
    expect(source).toContain("appLog.error('clip-queue', 'Clip render failed'")
    expect(source).toContain("ipcMain.handle('logs:get'")
    expect(source).toContain("ipcMain.handle('logs:show-file'")
  })

  it('reports live clip processing progress instead of leaving the UI parked at 35 percent', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).toContain('const currentClipProcessingStatus')
    expect(source).toContain('Math.min(88')
    expect(source).toContain('elapsedSeconds')
    expect(source).toContain('queuedCount')
  })

  it('exposes a system notification test and notifies when a clip enters the queue', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).toContain("ipcMain.handle('notifications:test'")
    expect(source).toContain('const notifyClipCreated')
    expect(source).toContain('await notifyClipCreated(clip)')
    expect(source).toContain('Клип сделки готов')
  })

  it('uses a Windows notification fallback when native Electron toasts are silent', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).toContain('showWindowsBalloonNotification')
    expect(source).toContain('powershell.exe')
    expect(source).toContain('ShowBalloonTip')
  })

  it('registers a Windows AppUserModelID shortcut so toast notifications can appear', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).toContain('windowsAppUserModelId')
    expect(source).toContain('ensureWindowsNotificationShortcut')
    expect(source).toContain('shell.writeShortcutLink')
    expect(source).toContain('appUserModelId: windowsAppUserModelId')
    expect(source).toContain("app.getPath('appData')")
  })

  it('reports when Windows toast notifications are disabled globally', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).toContain('areWindowsToastNotificationsDisabled')
    expect(source).toContain('ToastEnabled')
    expect(source).toContain('Уведомления Windows выключены')
  })

  it('passes explicit Windows login item path and args for autostart', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).toContain('path: process.execPath')
    expect(source).toContain('args: getWindowsLaunchArgs()')
    expect(source).toContain("name: 'TradeTools'")
  })

  it('applies the always-on-top system preference to app windows', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')

    expect(source).toContain('applyAlwaysOnTop')
    expect(source).toContain('window.setAlwaysOnTop(settings.system.alwaysOnTop)')
    expect(source).toContain('for (const window of BrowserWindow.getAllWindows())')
    expect(source).toContain('applyAlwaysOnTop(updatedSettings)')
    expect(source).toContain('applyAlwaysOnTop(settings)')
  })

  it('can leave the local proxy running after app close without spawning duplicates next launch', async () => {
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')
    const xraySource = await readFile(resolve('src/main/services/proxies/xrayLocalRuntime.ts'), 'utf8')

    expect(appSource).toContain('keepProxyRunningAfterClose')
    expect(appSource).toContain('applyProxyQuitPreference')
    expect(appSource).toContain('if (!keepProxyRunningAfterClose) void stopLocalXrayRuntime()')
    expect(xraySource).toContain('isReusableLocalXrayOwner')
    expect(xraySource).toContain('storedLocalXrayConfigMatches')
    expect(xraySource).toContain('Локальный proxy уже запущен')
  })
})
