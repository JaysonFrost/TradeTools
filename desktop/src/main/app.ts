import { app, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'node:path'
import { createObsService } from './services/obs/obsService'
import { createSecretStore } from './services/security/secretStore'
import { type SettingsUpdateInput } from './services/settings/settings'
import { createSettingsStore } from './services/settings/settingsStore'

const isAllowedDevUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return ['localhost', '127.0.0.1'].includes(parsed.hostname)
  } catch {
    return false
  }
}

const getIconPath = (): string => join(__dirname, '../../build/icon.png')

const extractSettingsPatch = (input: SettingsUpdateInput): SettingsUpdateInput => {
  const { obsPassword: _obsPassword, ...patch } = input
  return patch
}

const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#08090A',
    title: 'Trade Clipper',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    icon: getIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL && isAllowedDevUrl(process.env.ELECTRON_RENDERER_URL)) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(() => {
  const settingsStore = createSettingsStore(app.getPath('userData'))
  const secretStore = createSecretStore()
  const obsService = createObsService({
    getSettings: () => settingsStore.load(),
    getPassword: () => secretStore.getObsPassword()
  })

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('settings:get', () => settingsStore.load())
  ipcMain.handle('settings:update', async (_event, input: SettingsUpdateInput) => {
    const obsPassword = input.obsPassword?.trim()
    if (obsPassword) {
      await secretStore.setObsPassword(obsPassword)
      return settingsStore.update({
        ...extractSettingsPatch(input),
        obs: {
          ...(input.obs ?? {}),
          passwordConfigured: true
        }
      })
    }

    return settingsStore.update(extractSettingsPatch(input))
  })
  ipcMain.handle('obs:get-status', () => obsService.getStatus())
  ipcMain.handle('obs:test-replay-save', () => obsService.testReplaySave())
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
