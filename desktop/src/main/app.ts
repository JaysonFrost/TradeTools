import { stat } from 'node:fs/promises'
import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell, type OpenDialogOptions } from 'electron'
import { extname, isAbsolute, join } from 'node:path'
import { createBinanceFuturesClient } from './services/exchanges/binanceFuturesClient'
import { createBinanceFuturesClipWatcher, type BinanceFuturesWatchStatus } from './services/exchanges/binanceFuturesClipWatcher'
import { createObsService } from './services/obs/obsService'
import { createSecretStore } from './services/security/secretStore'
import { type SettingsUpdateInput } from './services/settings/settings'
import { createSettingsStore } from './services/settings/settingsStore'
import { createSimulatedClosedTrade } from './services/trades/simulatedTradePipeline'
import { createTradeClipPipeline } from './services/trades/tradeClipPipeline'

const isAllowedDevUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return ['localhost', '127.0.0.1'].includes(parsed.hostname)
  } catch {
    return false
  }
}

const getIconPath = (): string => join(__dirname, '../../build/icon.png')
const binanceFuturesPollIntervalMs = 2_000
const obsReplayEnsureIntervalMs = 30_000
const previewVideoExtensions = new Set(['.mp4', '.mkv', '.mov', '.flv', '.ts'])

const extractSettingsPatch = (input: SettingsUpdateInput): SettingsUpdateInput => {
  const {
    obsPassword: _obsPassword,
    binanceFuturesApiKey: _binanceFuturesApiKey,
    binanceFuturesApiSecret: _binanceFuturesApiSecret,
    ...patch
  } = input
  return patch
}

const assertPreviewVideoPath = async (videoPath: string): Promise<void> => {
  if (!isAbsolute(videoPath)) throw new Error('Некорректный путь к клипу')
  if (!previewVideoExtensions.has(extname(videoPath).toLowerCase())) throw new Error('Предпросмотр доступен только для видеофайлов')

  const fileStat = await stat(videoPath).catch(() => undefined)
  if (!fileStat?.isFile()) throw new Error('Файл клипа не найден')
}

const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#08090A',
    title: 'TradeCut',
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
  const clipPipeline = createTradeClipPipeline({
    getSettings: () => settingsStore.load(),
    saveReplayBuffer: () => obsService.testReplaySave()
  })
  const getBinanceFuturesClient = async () => {
    const [settings, credentials] = await Promise.all([
      settingsStore.load(),
      secretStore.getBinanceFuturesCredentials()
    ])

    if (!settings.exchange.binanceFutures.enabled || !credentials) return undefined

    return createBinanceFuturesClient({
      credentials,
      testnet: settings.exchange.binanceFutures.testnet
    })
  }
  const binanceFuturesClipWatcher = createBinanceFuturesClipWatcher({
    async listPositions() {
      return (await getBinanceFuturesClient())?.listPositions() ?? []
    },
    async listRecentClosedTrades(input) {
      return (await getBinanceFuturesClient())?.listRecentClosedTrades(input) ?? []
    },
    async getHistoryLookbackMs() {
      const settings = await settingsStore.load()
      return (settings.clip.replayBufferSeconds + settings.clip.paddingBeforeSeconds + settings.clip.paddingAfterSeconds + 60) * 1000
    },
    createClipForClosedTrade: (trade) => clipPipeline.createClipForClosedTrade(trade)
  })
  let binanceFuturesPollInterval: NodeJS.Timeout | undefined
  let binanceFuturesWatchStatus: BinanceFuturesWatchStatus = {
    configured: false,
    running: false,
    message: 'Binance watcher ещё не запущен'
  }
  let lastObsReplayEnsureAtMs = 0
  let obsReplayBufferReady = false

  const isBinanceFuturesConfigured = async (): Promise<boolean> => {
    const [settings, credentials] = await Promise.all([
      settingsStore.load(),
      secretStore.getBinanceFuturesCredentials()
    ])

    return Boolean(
      settings.exchange.binanceFutures.enabled &&
      settings.exchange.binanceFutures.apiKeyConfigured &&
      settings.exchange.binanceFutures.apiSecretConfigured &&
      credentials
    )
  }

  const getBinanceFuturesWatchStatus = async (): Promise<BinanceFuturesWatchStatus> => {
    const configured = await isBinanceFuturesConfigured()
    if (!configured) {
      return {
        ...binanceFuturesWatchStatus,
        configured,
        running: false,
        message: 'Binance Futures API ключи не настроены'
      }
    }

    return {
      ...binanceFuturesWatchStatus,
      configured,
      running: Boolean(binanceFuturesPollInterval)
    }
  }

  const ensureObsReplayBufferActive = async (force = false): Promise<void> => {
    const checkedAtMs = Date.now()
    if (!force && obsReplayBufferReady && checkedAtMs - lastObsReplayEnsureAtMs < obsReplayEnsureIntervalMs) return

    lastObsReplayEnsureAtMs = checkedAtMs
    const status = await obsService.ensureReplayBufferActive()
    obsReplayBufferReady = status.connected && status.replayBufferActive

    if (!obsReplayBufferReady) {
      binanceFuturesWatchStatus = {
        ...binanceFuturesWatchStatus,
        configured: true,
        running: Boolean(binanceFuturesPollInterval),
        lastError: status.message,
        message: `OBS: ${status.message}`
      }
      return
    }

    if (binanceFuturesWatchStatus.lastError?.startsWith('OBS')) {
      binanceFuturesWatchStatus = {
        ...binanceFuturesWatchStatus,
        lastError: undefined,
        message: status.message
      }
    }
  }

  const pollBinanceFuturesOnce = async () => {
    try {
      await ensureObsReplayBufferActive()
      const closedTrades = await binanceFuturesClipWatcher.pollOnce()
      binanceFuturesWatchStatus = {
        configured: true,
        running: true,
        lastPollAtMs: Date.now(),
        ...(closedTrades.length > 0 ? { lastClosedTradeAtMs: Math.max(...closedTrades.map((trade) => trade.exitTimeMs)) } : {}),
        message: closedTrades.length > 0
          ? `Найдены закрытые сделки: ${closedTrades.map((trade) => trade.symbol).join(', ')}`
          : 'Binance watcher работает, новых закрытых сделок нет'
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'неизвестная ошибка'
      binanceFuturesWatchStatus = {
        ...binanceFuturesWatchStatus,
        configured: true,
        running: true,
        lastPollAtMs: Date.now(),
        lastError: message,
        message: `Binance watcher: ${message}`
      }
      console.error('Binance Futures polling failed:', error)
    }
  }

  const startBinanceFuturesPolling = () => {
    if (binanceFuturesPollInterval) return
    binanceFuturesWatchStatus = {
      ...binanceFuturesWatchStatus,
      configured: true,
      running: true,
      message: 'Binance watcher запускается'
    }
    binanceFuturesPollInterval = setInterval(() => void pollBinanceFuturesOnce(), binanceFuturesPollIntervalMs)
    void ensureObsReplayBufferActive(true).finally(() => void pollBinanceFuturesOnce())
  }

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('dialog:select-directory', async (event, defaultPath?: string) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      title: 'Выберите папку',
      defaultPath,
      properties: ['openDirectory', 'createDirectory']
    }
    const result = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options)

    return result.canceled ? undefined : result.filePaths[0]
  })
  ipcMain.handle('settings:get', () => settingsStore.load())
  ipcMain.handle('settings:update', async (_event, input: SettingsUpdateInput) => {
    const obsPassword = input.obsPassword?.trim()
    const binanceFuturesApiKey = input.binanceFuturesApiKey?.trim()
    const binanceFuturesApiSecret = input.binanceFuturesApiSecret?.trim()
    let patch = extractSettingsPatch(input)

    if (obsPassword) {
      await secretStore.setObsPassword(obsPassword)
      patch = {
        ...patch,
        obs: {
          ...(input.obs ?? {}),
          passwordConfigured: true
        }
      }
    }

    if (binanceFuturesApiKey || binanceFuturesApiSecret) {
      if (!binanceFuturesApiKey || !binanceFuturesApiSecret) {
        throw new Error('Для Binance Futures укажите и API Key, и API Secret')
      }

      await secretStore.setBinanceFuturesCredentials({
        apiKey: binanceFuturesApiKey,
        apiSecret: binanceFuturesApiSecret
      })
      patch = {
        ...patch,
        exchange: {
          ...(patch.exchange ?? {}),
          binanceFutures: {
            ...(patch.exchange?.binanceFutures ?? {}),
            enabled: true,
            apiKeyConfigured: true,
            apiSecretConfigured: true
          }
        }
      }
    }

    const updatedSettings = await settingsStore.update(patch)
    if (
      updatedSettings.exchange.binanceFutures.enabled &&
      updatedSettings.exchange.binanceFutures.apiKeyConfigured &&
      updatedSettings.exchange.binanceFutures.apiSecretConfigured
    ) {
      startBinanceFuturesPolling()
    }

    return settingsStore.load()
  })
  ipcMain.handle('obs:get-status', () => obsService.getStatus())
  ipcMain.handle('obs:test-replay-save', () => obsService.testReplaySave())
  ipcMain.handle('clipboard:write-text', (_event, text: string) => {
    if (typeof text !== 'string') throw new Error('Некорректный текст для буфера обмена')
    clipboard.writeText(text)
  })
  ipcMain.handle('binance:test-futures-connection', async () => {
    const [settings, credentials] = await Promise.all([
      settingsStore.load(),
      secretStore.getBinanceFuturesCredentials()
    ])

    if (!credentials) {
      return {
        ok: false,
        message: 'Binance Futures API Key и Secret не сохранены'
      }
    }

    return createBinanceFuturesClient({
      credentials,
      testnet: settings.exchange.binanceFutures.testnet
    }).testConnection()
  })
  ipcMain.handle('binance:get-watch-status', () => getBinanceFuturesWatchStatus())
  ipcMain.handle('clips:list-pending', () => clipPipeline.listPendingClips())
  ipcMain.handle('clips:create-test', () => clipPipeline.createClipForClosedTrade(createSimulatedClosedTrade(Date.now())))
  ipcMain.handle('clips:delete-from-queue', (_event, metadataPath: string) => clipPipeline.deleteClipFromQueue(metadataPath))
  ipcMain.handle('clips:open-preview', async (_event, videoPath: string) => {
    await assertPreviewVideoPath(videoPath)
    const openError = await shell.openPath(videoPath)
    if (openError) throw new Error(`Не удалось открыть предпросмотр: ${openError}`)
  })
  ipcMain.handle('clips:show-in-folder', async (_event, videoPath: string) => {
    await assertPreviewVideoPath(videoPath)
    shell.showItemInFolder(videoPath)
  })
  createMainWindow()

  void settingsStore.load().then((settings) => {
    if (
      settings.exchange.binanceFutures.enabled &&
      settings.exchange.binanceFutures.apiKeyConfigured &&
      settings.exchange.binanceFutures.apiSecretConfigured
    ) {
      startBinanceFuturesPolling()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
