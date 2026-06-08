import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('main app lifecycle', () => {
  it('prepares the selected video recorder before Binance watcher polls trades', async () => {
    const source = await readFile(resolve('src/main/app.ts'), 'utf8')
    const startWatcherIndex = source.indexOf('const startBinanceFuturesPolling')
    const ensureVideoIndex = source.indexOf('ensureVideoRecordingReady(true)', startWatcherIndex)
    const pollIndex = source.indexOf('pollBinanceFuturesOnce()', ensureVideoIndex)

    expect(source).toContain('const ensureObsReplayBufferActive')
    expect(source).toContain('const ensureVideoRecordingReady')
    expect(ensureVideoIndex).toBeGreaterThan(startWatcherIndex)
    expect(pollIndex).toBeGreaterThan(ensureVideoIndex)
    expect(source).toContain('if (!videoReady) return')
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
})
