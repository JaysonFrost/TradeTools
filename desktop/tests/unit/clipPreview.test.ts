import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('clip preview', () => {
  it('exposes a safe Electron IPC for opening local clip previews', async () => {
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')

    expect(appSource).toContain("ipcMain.handle('clips:open-preview'")
    expect(appSource).toContain('shell.openPath')
    expect(appSource).toContain('isPathInside(resolve(outputDir), resolve(videoPath))')
    expect(preloadSource).toContain('openPreview')
    expect(preloadSource).toContain("ipcRenderer.invoke('clips:open-preview'")
  })

  it('wires the preview button to the clip video path', async () => {
    const source = await readFile(resolve('src/renderer/components/trade/ClipCard.tsx'), 'utf8')

    expect(source).toContain('openPreview')
    expect(source).toContain('clip.videoPath')
    expect(source).toContain('Предпросмотр')
  })
})
