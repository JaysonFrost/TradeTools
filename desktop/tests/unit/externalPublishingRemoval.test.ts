import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const legacyProviderName = ['You', 'Tube'].join('')
const legacyProviderKey = ['you', 'tube'].join('')
const legacyAuthProvider = ['goo', 'gle'].join('')
const legacyStudioAction = ['open', 'Studio', 'Upload'].join('')

describe('external publishing removal', () => {
  it('removes legacy authorization and publishing IPC from main and preload', async () => {
    const appSource = await readFile(resolve('src/main/app.ts'), 'utf8')
    const preloadSource = await readFile(resolve('src/preload/index.ts'), 'utf8')

    expect(appSource).not.toContain(`ipcMain.handle('${legacyProviderKey}:authorize-${legacyAuthProvider}'`)
    expect(appSource).not.toContain(`ipcMain.handle('${legacyProviderKey}:open-studio-upload'`)
    expect(appSource).not.toContain(`ipcMain.handle('clips:upload-${legacyProviderKey}'`)
    expect(appSource).not.toContain(`create${legacyProviderName}Uploader`)
    expect(appSource).not.toContain(`authorize${legacyAuthProvider[0].toUpperCase()}${legacyAuthProvider.slice(1)}WithLoopback`)
    expect(appSource).toContain("ipcMain.handle('clipboard:write-text'")
    expect(appSource).toContain("ipcMain.handle('clips:delete-from-queue'")
    expect(appSource).toContain("ipcMain.handle('clips:show-in-folder'")
    expect(preloadSource).not.toContain(`authorize${legacyAuthProvider[0].toUpperCase()}${legacyAuthProvider.slice(1)}`)
    expect(preloadSource).not.toContain(legacyStudioAction)
    expect(preloadSource).not.toContain(`uploadTo${legacyProviderName}`)
    expect(preloadSource).not.toContain(`${legacyProviderKey}:`)
    expect(preloadSource).not.toContain(`upload-${legacyProviderKey}`)
    expect(preloadSource).toContain('writeText')
    expect(preloadSource).toContain('deleteFromQueue')
    expect(preloadSource).toContain('showInFolder')
  })

  it('keeps the local clip review UI without legacy publishing controls', async () => {
    const dashboardSource = await readFile(resolve('src/renderer/routes/Dashboard.tsx'), 'utf8')
    const clipCardSource = await readFile(resolve('src/renderer/components/trade/ClipCard.tsx'), 'utf8')

    expect(dashboardSource).not.toContain(`${legacyProviderName}SettingsPanel`)
    expect(dashboardSource).not.toContain(legacyProviderName)
    expect(clipCardSource).not.toContain(`Загрузить на ${legacyProviderName}`)
    expect(clipCardSource).not.toContain(`Открыть ${legacyProviderName} Studio`)
    expect(clipCardSource).not.toContain(`uploadTo${legacyProviderName}`)
    expect(clipCardSource).not.toContain(`${legacyProviderKey}Url`)
    expect(clipCardSource).toContain('Открыть файл')
    expect(clipCardSource).toContain('Скопировать название')
    expect(clipCardSource).toContain('Убрать из очереди')
    expect(clipCardSource).toContain('deleteFromQueue')
  })
})
