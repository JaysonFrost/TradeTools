import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('YouTube export feature wiring', () => {
  it('exposes Google authorization and YouTube upload IPC through preload', async () => {
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')

    expect(appSource).toContain("ipcMain.handle('youtube:authorize-google'")
    expect(appSource).toContain("ipcMain.handle('youtube:open-studio-upload'")
    expect(appSource).toContain("ipcMain.handle('clipboard:write-text'")
    expect(appSource).toContain("ipcMain.handle('clips:upload-youtube'")
    expect(appSource).toContain("ipcMain.handle('clips:delete-from-queue'")
    expect(appSource).toContain("ipcMain.handle('clips:show-in-folder'")
    expect(preloadSource).toContain('authorizeGoogle')
    expect(preloadSource).toContain('openStudioUpload')
    expect(preloadSource).toContain('writeText')
    expect(preloadSource).toContain('uploadToYouTube')
    expect(preloadSource).toContain('deleteFromQueue')
    expect(preloadSource).toContain('showInFolder')
  })

  it('shows YouTube settings and a red YouTube upload button', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const clipCardSource = await readFile(resolve('src/renderer/components/trade/ClipCard.tsx'), 'utf8')
    const youtubeSettingsSource = await readFile(resolve('src/renderer/components/settings/YouTubeSettingsPanel.tsx'), 'utf8')

    expect(dashboardSource).toContain('YouTubeSettingsPanel')
    expect(clipCardSource).toContain('Загрузить на YouTube')
    expect(clipCardSource).toContain('Открыть YouTube Studio')
    expect(clipCardSource).toContain('Открыть файл')
    expect(clipCardSource).toContain('Скопировать название')
    expect(clipCardSource).toContain('Скопировать описание')
    expect(clipCardSource).toContain('Убрать из очереди')
    expect(clipCardSource).toContain('bg-red-600')
    expect(clipCardSource).toContain('uploadToYouTube')
    expect(clipCardSource).toContain('deleteFromQueue')
    expect(youtubeSettingsSource).toContain('disabled={authorizing}')
    expect(youtubeSettingsSource).not.toContain('disabled={authorizing || !configured}')
    expect(youtubeSettingsSource).not.toContain('Google OAuth Client ID')
    expect(youtubeSettingsSource).not.toContain('Google OAuth Client Secret')
  })
})
