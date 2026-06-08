import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, session, shell, type OpenDialogOptions } from 'electron'
import { dirname, extname, isAbsolute, join } from 'node:path'
import { createBinanceFuturesClient } from './services/exchanges/binanceFuturesClient'
import { createBinanceFuturesClipWatcher, type BinanceFuturesWatchStatus } from './services/exchanges/binanceFuturesClipWatcher'
import { listProxyPaymentReminders } from './services/notifications/proxyPaymentReminders'
import { inspectProxyNetworkEnvironment, type NetworkDiagnosticStatus, type NetworkEnvironmentSnapshot } from './services/proxies/networkEnvironment'
import { createObsService } from './services/obs/obsService'
import { setupProxyChainOnServers, type ProxyChainRuntimeConfig } from './services/proxies/proxyChainSetup'
import { checkSshConnection, parseSshEndpoint, type SshConnectionCheckResult } from './services/proxies/sshConnectionCheck'
import { configureVpnBypassRoutes, type VpnBypassRouteResult } from './services/proxies/vpnBypassRoutes'
import { setupLocalXrayRuntime, stopLocalXrayRuntime } from './services/proxies/xrayLocalRuntime'
import { createSecretStore } from './services/security/secretStore'
import { type AppSettings, type ProxyRecord, type SettingsUpdateInput } from './services/settings/settings'
import { createSettingsStore } from './services/settings/settingsStore'
import { createSimulatedClosedTrade, type ClosedTrade } from './services/trades/simulatedTradePipeline'
import { createTradeClipPipeline, type ClipQueueItem } from './services/trades/tradeClipPipeline'
import { defaultLocalProxyPort } from '../shared/defaults'

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
const proxyPaymentReminderIntervalMs = 6 * 60 * 60 * 1000
const previewVideoExtensions = new Set(['.mp4', '.mkv', '.mov', '.flv', '.ts'])
const windowsAppUserModelId = 'com.tradetools.desktop'

if (process.platform === 'win32') app.setAppUserModelId(windowsAppUserModelId)

type ProxySaveInput = {
  id?: string
  name?: string
  server?: string
  login?: string
  password?: string
  nextProxyId?: string
  localProxyPort?: number
  paymentDueDay?: number
  paymentDueDate?: string
  dashboardUrl?: string
  notes?: string
}

type ProxyChainInstructionResult = {
  chain: Array<Pick<ProxyRecord, 'id' | 'name' | 'server' | 'login' | 'passwordConfigured'>>
  sshChecks: SshConnectionCheckResult[]
  network: NetworkEnvironmentSnapshot
  route: string
  terminal: string[]
}

type ProxyChainSetupRequest = {
  proxyId?: string
}

type ProxyVpnBypassRequest = {
  proxyId?: string
}

type ProxyChainProgressInput = {
  proxyId?: string
  proxyName?: string
  step: string
  status: 'running' | 'success' | 'error' | 'info'
  message: string
}

type SystemNotificationResult = {
  ok: boolean
  message: string
}

const windowsBalloonNotificationScript = `
$title = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($args[0]))
$body = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($args[1]))
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
$notify.BalloonTipTitle = $title
$notify.BalloonTipText = $body
$notify.Visible = $true
$notify.ShowBalloonTip(7000)
Start-Sleep -Seconds 8
$notify.Dispose()
`

const showWindowsBalloonNotification = (input: { title: string, body: string }): boolean => {
  if (process.platform !== 'win32') return false

  try {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-STA',
      '-WindowStyle',
      'Hidden',
      '-Command',
      windowsBalloonNotificationScript,
      Buffer.from(input.title, 'utf16le').toString('base64'),
      Buffer.from(input.body, 'utf16le').toString('base64')
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.on('error', (error) => console.warn(`Windows notification fallback failed: ${error.message}`))
    child.unref()
    return true
  } catch (error) {
    console.warn('Windows notification fallback failed:', error)
    return false
  }
}

let windowsNotificationShortcutReady = process.platform !== 'win32'

const quoteWindowsShortcutArg = (value: string): string => `"${value.replace(/"/g, '\\"')}"`

const getWindowsLaunchArgs = (): string[] => process.defaultApp ? [app.getAppPath()] : []

const getWindowsNotificationShortcutPath = (): string => join(
  app.getPath('appData'),
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'TradeTools.lnk'
)

const ensureWindowsNotificationShortcut = (): boolean => {
  if (windowsNotificationShortcutReady) return true
  if (process.platform !== 'win32') return true

  try {
    const shortcutPath = getWindowsNotificationShortcutPath()
    mkdirSync(dirname(shortcutPath), { recursive: true })
    windowsNotificationShortcutReady = shell.writeShortcutLink(shortcutPath, 'replace', {
      target: process.execPath,
      args: getWindowsLaunchArgs().map(quoteWindowsShortcutArg).join(' '),
      cwd: app.getAppPath(),
      description: 'TradeTools',
      appUserModelId: windowsAppUserModelId,
      icon: process.execPath,
      iconIndex: 0
    })
    if (!windowsNotificationShortcutReady) console.warn('Windows notification shortcut was not created')
    return windowsNotificationShortcutReady
  } catch (error) {
    console.warn('Windows notification shortcut failed:', error)
    return false
  }
}

const areWindowsToastNotificationsDisabled = (): boolean => {
  if (process.platform !== 'win32') return false

  try {
    const result = spawnSync('reg', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications',
      '/v',
      'ToastEnabled'
    ], {
      encoding: 'utf8',
      windowsHide: true
    })
    return /\bToastEnabled\b[\s\S]*0x0\b/i.test(`${result.stdout}\n${result.stderr}`)
  } catch {
    return false
  }
}

const windowsNotificationsDisabledMessage = 'Уведомления Windows выключены на уровне системы. Включите: Параметры Windows -> Система -> Уведомления.'

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

const asString = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

const assertHttpUrl = (url: string): string => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString()
  } catch {
    // Fall through to the user-facing error below.
  }

  throw new Error('Ссылка должна начинаться с http:// или https://')
}

const normalizePaymentDueDay = (value: unknown, legacyDate?: unknown): number => {
  const directDay = Number(value)
  if (Number.isFinite(directDay) && directDay >= 1 && directDay <= 31) return Math.trunc(directDay)

  const textDay = asString(value)
  if (/^\d{1,2}$/.test(textDay)) {
    const day = Number(textDay)
    if (day >= 1 && day <= 31) return day
  }

  const date = asString(legacyDate)
  if (!date) return 0
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new Error('День оплаты должен быть числом от 1 до 31')

  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  const parsed = new Date(year, monthIndex, day)
  if (parsed.getFullYear() !== year || parsed.getMonth() !== monthIndex || parsed.getDate() !== day) {
    throw new Error('День оплаты некорректен')
  }

  return day
}

const normalizePort = (value: unknown, fallback = 0): number => {
  const port = Number(value)
  return Number.isFinite(port) && port > 0 && port <= 65535 ? Math.trunc(port) : fallback
}

type NormalizedProxyInput = Required<Omit<ProxySaveInput, 'id' | 'password' | 'paymentDueDate'>> & Pick<ProxySaveInput, 'id' | 'password'>

const normalizeProxyInput = (input: unknown): NormalizedProxyInput => {
  if (typeof input !== 'object' || input === null) throw new Error('Некорректные данные прокси')

  const candidate = input as ProxySaveInput
  const dashboardUrl = asString(candidate.dashboardUrl)
  const normalized = {
    id: asString(candidate.id) || undefined,
    name: asString(candidate.name),
    server: asString(candidate.server),
    login: asString(candidate.login) || 'root',
    password: typeof candidate.password === 'string' ? candidate.password : undefined,
    nextProxyId: asString(candidate.nextProxyId),
    localProxyPort: normalizePort(candidate.localProxyPort, defaultLocalProxyPort),
    paymentDueDay: normalizePaymentDueDay(candidate.paymentDueDay, candidate.paymentDueDate),
    dashboardUrl: dashboardUrl ? assertHttpUrl(dashboardUrl) : '',
    notes: asString(candidate.notes)
  }

  if (!normalized.name && !normalized.server) {
    throw new Error('Укажите название или IP сервера')
  }

  return normalized
}

const isSameProxyId = (proxy: ProxyRecord, proxyId: string): boolean => proxy.id === proxyId

const proxyDisplayName = (proxy: ProxyRecord): string => proxy.name || proxy.server || 'сервер'
const emptyProxyRuntime = () => ({
  activeStartProxyId: '',
  route: '',
  entryHost: '',
  entryPort: 443,
  localPort: defaultLocalProxyPort,
  entryUuidConfigured: false,
  configuredAtMs: 0
})

const resolveProxyChain = (settings: AppSettings, startProxyId: string): ProxyRecord[] => {
  const startProxy = settings.proxies.find((proxy) => isSameProxyId(proxy, startProxyId))
  if (!startProxy) throw new Error('Стартовый сервер связки не найден')

  const byId = new Map(settings.proxies.map((proxy) => [proxy.id, proxy]))
  const visited = new Set<string>()
  const chain: ProxyRecord[] = []
  let current: ProxyRecord | undefined = startProxy

  while (current) {
    if (visited.has(current.id)) throw new Error('В связке найден цикл. Проверьте порядок серверов на странице прокси.')
    visited.add(current.id)
    chain.push(current)
    current = current.nextProxyId ? byId.get(current.nextProxyId) : undefined
  }

  return chain
}

const networkStatusToProgressStatus = (status: NetworkDiagnosticStatus): ProxyChainProgressInput['status'] => {
  if (status === 'ok') return 'success'
  if (status === 'warning') return 'info'
  return 'info'
}

const buildProxyChainInstructions = (
  chain: ProxyRecord[],
  sshChecks: SshConnectionCheckResult[],
  network: NetworkEnvironmentSnapshot
): ProxyChainInstructionResult => {
  const firstProxy = chain[0]
  if (!firstProxy) throw new Error('Связка пустая')

  const localPort = firstProxy.localProxyPort || defaultLocalProxyPort
  const route = chain.map((proxy) => `${proxyDisplayName(proxy)} (${proxy.server})`).join(' -> ')

  return {
    chain: chain.map((proxy) => ({
      id: proxy.id,
      name: proxy.name,
      server: proxy.server,
      login: proxy.login,
      passwordConfigured: proxy.passwordConfigured
    })),
    sshChecks,
    network,
    route,
    terminal: [
      'TradeTools поднимает локальный HTTP proxy для торгового терминала.',
      'В терминале включите proxy для торгового подключения.',
      'Host: 127.0.0.1',
      `Port: ${localPort}`,
      'Type: HTTP. Логин и пароль оставьте пустыми.',
      ...network.advice
    ]
  }
}

const applyLaunchAtLogin = (settings: AppSettings): void => {
  app.setLoginItemSettings({
    openAtLogin: settings.system.launchAtLogin,
    ...(process.platform === 'win32'
      ? {
          path: process.execPath,
          args: getWindowsLaunchArgs(),
          name: 'TradeTools',
          enabled: settings.system.launchAtLogin
        }
      : {}),
    ...(process.platform === 'darwin' ? { openAsHidden: true } : {})
  })
}

const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#08090A',
    title: 'TradeTools',
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
  ensureWindowsNotificationShortcut()
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

  const saveProxyRuntimeConfig = async (config: ProxyChainRuntimeConfig): Promise<void> => {
    await secretStore.setProxyRuntimeEntryUuid(config.entryUuid)
    await settingsStore.update({
      proxyRuntime: {
        activeStartProxyId: config.activeStartProxyId,
        route: config.route,
        entryHost: config.entryHost,
        entryPort: config.entryPort,
        localPort: config.localPort,
        entryUuidConfigured: true,
        configuredAtMs: config.configuredAtMs
      }
    })
  }

  const clearProxyRuntimeConfig = async () => {
    await secretStore.clearProxyRuntimeEntryUuid()
    return settingsStore.update({ proxyRuntime: emptyProxyRuntime() })
  }

  const startStoredProxyRuntime = async (settings: AppSettings): Promise<void> => {
    const runtime = settings.proxyRuntime
    if (!runtime.entryUuidConfigured || !runtime.activeStartProxyId || !runtime.entryHost || !runtime.localPort) return

    const uuid = await secretStore.getProxyRuntimeEntryUuid()
    if (!uuid) {
      await clearProxyRuntimeConfig()
      return
    }

    await setupLocalXrayRuntime({
      appDataDir: app.getPath('userData'),
      localPort: runtime.localPort,
      entryHost: runtime.entryHost,
      entryPort: runtime.entryPort,
      entryUuid: uuid,
      onProgress: (progress) => console.log(`[proxy-autostart] ${progress.status} ${progress.step}: ${progress.message}`)
    })
  }

  const focusMainWindow = () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  const showSystemNotification = (input: { title: string, body: string, onClick?: () => void }): SystemNotificationResult => {
    const windowsShortcutReady = ensureWindowsNotificationShortcut()

    if (areWindowsToastNotificationsDisabled()) {
      return {
        ok: false,
        message: windowsNotificationsDisabledMessage
      }
    }

    if (!Notification.isSupported()) {
      const windowsFallbackSent = showWindowsBalloonNotification(input)
      return {
        ok: windowsFallbackSent,
        message: windowsFallbackSent
          ? 'Windows-уведомление отправлено'
          : 'Системные уведомления недоступны в этой среде'
      }
    }

    try {
      const notification = new Notification({
        title: input.title,
        body: input.body,
        icon: getIconPath()
      })
      notification.on('click', input.onClick ?? focusMainWindow)
      notification.show()
      return {
        ok: true,
        message: windowsShortcutReady
          ? 'Системное уведомление отправлено'
          : 'Системное уведомление отправлено, но Windows-ярлык для toast создать не удалось'
      }
    } catch (error) {
      const windowsFallbackSent = showWindowsBalloonNotification(input)
      return {
        ok: windowsFallbackSent,
        message: windowsFallbackSent
          ? 'Windows-уведомление отправлено'
          : error instanceof Error ? error.message : 'Не удалось отправить системное уведомление'
      }
    }
  }

  const notifyProxyPaymentsDue = async () => {
    const settings = await settingsStore.load()
    const reminders = listProxyPaymentReminders(settings)
    if (reminders.length === 0) return

    for (const reminder of reminders) {
      showSystemNotification({
        title: reminder.title,
        body: reminder.body,
        onClick: () => {
          if (reminder.proxy.dashboardUrl) void shell.openExternal(reminder.proxy.dashboardUrl)
        }
      })
    }

    const reminderByProxyId = new Map(reminders.map((reminder) => [reminder.proxy.id, reminder]))
    await settingsStore.update({
      proxies: settings.proxies.map((proxy) => {
        const reminder = reminderByProxyId.get(proxy.id)
        return reminder
          ? {
              ...proxy,
              lastPaymentReminderKey: reminder.key,
              lastPaymentReminderAtMs: Date.now()
            }
          : proxy
      })
    })
  }

  const notifyClipCreated = async (clip: ClipQueueItem) => {
    const settings = await settingsStore.load()
    if (!settings.system.clipSuccessNotificationsEnabled) return

    const notification = showSystemNotification({
      title: 'Клип сделки готов',
      body: `${clip.symbol} ${clip.side}: запись сохранена в очередь проверки`,
      onClick: () => shell.showItemInFolder(clip.videoPath)
    })
    if (!notification.ok) console.warn(`Clip notification failed: ${notification.message}`)
  }

  const createClipAndNotify = async (trade: ClosedTrade) => {
    const clip = await clipPipeline.createClipForClosedTrade(trade)
    await notifyClipCreated(clip)
    return clip
  }

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
    createClipForClosedTrade: createClipAndNotify
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

    let updatedSettings = await settingsStore.update(patch)
    if (patch.proxies) updatedSettings = await clearProxyRuntimeConfig()
    applyLaunchAtLogin(updatedSettings)
    if (
      updatedSettings.exchange.binanceFutures.enabled &&
      updatedSettings.exchange.binanceFutures.apiKeyConfigured &&
      updatedSettings.exchange.binanceFutures.apiSecretConfigured
    ) {
      startBinanceFuturesPolling()
    }

    void notifyProxyPaymentsDue().catch((error) => console.error('Proxy payment notification failed:', error))
    return updatedSettings
  })
  ipcMain.handle('obs:get-status', () => obsService.getStatus())
  ipcMain.handle('obs:test-replay-save', () => obsService.testReplaySave())
  ipcMain.handle('clipboard:write-text', (_event, text: string) => {
    if (typeof text !== 'string') throw new Error('Некорректный текст для буфера обмена')
    clipboard.writeText(text)
  })
  ipcMain.handle('notifications:test', () => showSystemNotification({
    title: 'TradeTools',
    body: 'Системные уведомления работают'
  }))
  ipcMain.handle('proxies:save', async (_event, input: ProxySaveInput) => {
    const proxyInput = normalizeProxyInput(input)
    const settings = await settingsStore.load()
    const proxyId = proxyInput.id ?? randomUUID()
    const existingProxy = settings.proxies.find((proxy) => isSameProxyId(proxy, proxyId))
    const password = typeof proxyInput.password === 'string' && proxyInput.password.length > 0 ? proxyInput.password : undefined

    if (password) await secretStore.setProxyPassword(proxyId, password)

    const nextProxy: ProxyRecord = {
      id: proxyId,
      name: proxyInput.name,
      server: proxyInput.server,
      login: proxyInput.login,
      passwordConfigured: Boolean(password) || existingProxy?.passwordConfigured === true,
      nextProxyId: proxyInput.nextProxyId === proxyId ? '' : proxyInput.nextProxyId,
      localProxyPort: proxyInput.localProxyPort,
      paymentDueDay: proxyInput.paymentDueDay,
      dashboardUrl: proxyInput.dashboardUrl,
      notes: proxyInput.notes,
      ...(existingProxy?.paymentDueDay === proxyInput.paymentDueDay && existingProxy.lastPaymentReminderKey
        ? { lastPaymentReminderKey: existingProxy.lastPaymentReminderKey }
        : {}),
      ...(existingProxy?.paymentDueDay === proxyInput.paymentDueDay && existingProxy.lastPaymentReminderAtMs
        ? { lastPaymentReminderAtMs: existingProxy.lastPaymentReminderAtMs }
        : {})
    }
    const nextProxies = existingProxy
      ? settings.proxies.map((proxy) => isSameProxyId(proxy, proxyId) ? nextProxy : proxy)
      : [...settings.proxies, nextProxy]
    let updatedSettings = await settingsStore.update({ proxies: nextProxies })
    updatedSettings = await clearProxyRuntimeConfig()
    void notifyProxyPaymentsDue().catch((error) => console.error('Proxy payment notification failed:', error))

    return updatedSettings
  })
  ipcMain.handle('proxies:delete', async (_event, proxyId: string) => {
    const id = asString(proxyId)
    if (!id) throw new Error('Некорректный ID прокси')

    const settings = await settingsStore.load()
    const nextProxies = settings.proxies
      .filter((proxy) => !isSameProxyId(proxy, id))
      .map((proxy) => proxy.nextProxyId === id ? { ...proxy, nextProxyId: '' } : proxy)
    await settingsStore.update({ proxies: nextProxies })
    const clearedSettings = await clearProxyRuntimeConfig()
    await secretStore.clearProxyPassword(id)

    return clearedSettings
  })
  ipcMain.handle('proxies:copy-password', async (_event, proxyId: string) => {
    const id = asString(proxyId)
    if (!id) throw new Error('Некорректный ID прокси')

    const password = await secretStore.getProxyPassword(id)
    if (!password) throw new Error('Пароль прокси не найден в keychain')

    clipboard.writeText(password)
  })
  ipcMain.handle('proxies:open-dashboard', async (_event, proxyId: string) => {
    const id = asString(proxyId)
    if (!id) throw new Error('Некорректный ID прокси')

    const settings = await settingsStore.load()
    const proxy = settings.proxies.find((candidate) => isSameProxyId(candidate, id))
    if (!proxy?.dashboardUrl) throw new Error('Ссылка на личный кабинет не задана')

    await shell.openExternal(assertHttpUrl(proxy.dashboardUrl))
  })
  ipcMain.handle('proxies:configure-chain', async (event, proxyId: string): Promise<ProxyChainInstructionResult> => {
    const id = asString(proxyId)
    if (!id) throw new Error('Некорректный ID сервера')

    const progress = (input: ProxyChainProgressInput) => {
      event.sender.send('proxies:configure-chain-progress', {
        ...input,
        timestampMs: Date.now()
      })
    }

    const settings = await settingsStore.load()
    const chain = resolveProxyChain(settings, id)
    const passwords = new Map<string, string>()

    progress({
      step: 'validate',
      status: 'running',
      message: `Проверяем данные серверов в связке: ${chain.map(proxyDisplayName).join(' -> ')}`
    })

    for (const proxy of chain) {
      if (!proxy.server) {
        progress({
          proxyId: proxy.id,
          proxyName: proxyDisplayName(proxy),
          step: 'validate',
          status: 'error',
          message: 'Не указан IP или домен сервера'
        })
        throw new Error(`У сервера "${proxyDisplayName(proxy)}" не указан IP или домен`)
      }
      if (!proxy.login) {
        progress({
          proxyId: proxy.id,
          proxyName: proxyDisplayName(proxy),
          step: 'validate',
          status: 'error',
          message: 'Не указан SSH-логин'
        })
        throw new Error(`У сервера "${proxyDisplayName(proxy)}" не указан SSH-логин`)
      }
      const password = await secretStore.getProxyPassword(proxy.id)
      if (!password) {
        progress({
          proxyId: proxy.id,
          proxyName: proxyDisplayName(proxy),
          step: 'validate',
          status: 'error',
          message: 'SSH-пароль не сохранён. Откройте редактирование сервера и сохраните пароль ещё раз.'
        })
        throw new Error(`У сервера "${proxyDisplayName(proxy)}" не сохранён SSH-пароль`)
      }
      passwords.set(proxy.id, password)
    }
    progress({
      step: 'validate',
      status: 'success',
      message: 'Данные серверов заполнены'
    })

    const firstProxy = chain[0]
    const firstEndpoint = firstProxy ? parseSshEndpoint(firstProxy.server) : undefined
    const localPort = firstProxy?.localProxyPort || defaultLocalProxyPort

    progress({
      step: 'network',
      status: 'running',
      message: 'Проверяем VPN, системный proxy и маршрут к первому VPS'
    })
    const network = await inspectProxyNetworkEnvironment({
      entryHost: firstEndpoint?.host,
      localPort
    })
    for (const diagnostic of network.diagnostics) {
      progress({
        proxyId: firstProxy?.id,
        proxyName: firstProxy ? proxyDisplayName(firstProxy) : undefined,
        step: 'network',
        status: networkStatusToProgressStatus(diagnostic.status),
        message: `${diagnostic.name}: ${diagnostic.message}`
      })
    }

    const sshChecks = []
    for (const proxy of chain) {
      const password = passwords.get(proxy.id)
      if (!password) throw new Error(`У сервера "${proxyDisplayName(proxy)}" не сохранён SSH-пароль`)
      progress({
        proxyId: proxy.id,
        proxyName: proxyDisplayName(proxy),
        step: 'ssh',
        status: 'running',
        message: `Подключаемся по SSH к ${proxy.server} под логином ${proxy.login}`
      })
      const check = await checkSshConnection({
        server: proxy.server,
        login: proxy.login,
        password
      })
      sshChecks.push(check)
      if (!check.ok) {
        progress({
          proxyId: proxy.id,
          proxyName: proxyDisplayName(proxy),
          step: 'ssh',
          status: 'error',
          message: `${check.host}:${check.port} - ${check.message}`
        })
        throw new Error(`SSH-подключение не удалось: ${check.host}:${check.port} (${check.message})`)
      }
      progress({
        proxyId: proxy.id,
        proxyName: proxyDisplayName(proxy),
        step: 'ssh',
        status: 'success',
        message: check.serverInfo ? `${check.message}: ${check.serverInfo}` : check.message
      })
    }

    progress({
      step: 'done',
      status: 'success',
      message: 'SSH-проверка связки завершена, инструкция готова'
    })
    return buildProxyChainInstructions(chain, sshChecks, network)
  })
  ipcMain.handle('proxies:setup-chain', async (event, input: ProxyChainSetupRequest) => {
    const id = asString(input?.proxyId)
    if (!id) throw new Error('Некорректный ID сервера')

    const settings = await settingsStore.load()
    const chain = resolveProxyChain(settings, id)

    return setupProxyChainOnServers({
      chain,
      appDataDir: app.getPath('userData'),
      getSshPassword: (proxyId) => secretStore.getProxyPassword(proxyId),
      onRuntimeConfigured: saveProxyRuntimeConfig,
      onProgress: (progress) => {
        event.sender.send('proxies:setup-chain-progress', progress)
      }
    })
  })
  ipcMain.handle('proxies:configure-vpn-bypass', async (_event, input: ProxyVpnBypassRequest): Promise<VpnBypassRouteResult> => {
    const id = asString(input?.proxyId)
    if (!id) throw new Error('Некорректный ID сервера')

    const settings = await settingsStore.load()
    const chain = resolveProxyChain(settings, id)
    return configureVpnBypassRoutes({
      chain,
      appDataDir: app.getPath('userData')
    })
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
  ipcMain.handle('clips:create-test', () => createClipAndNotify(createSimulatedClosedTrade(Date.now())))
  ipcMain.handle('clips:delete-from-queue', (_event, metadataPath: string) => clipPipeline.deleteClipFromQueue(metadataPath))
  ipcMain.handle('clips:rename-file', (_event, input: { metadataPath?: string, fileName?: string }) => {
    const metadataPath = asString(input?.metadataPath)
    const fileName = asString(input?.fileName)
    if (!metadataPath) throw new Error('Некорректный путь метаданных клипа')
    if (!fileName) throw new Error('Укажите имя файла')

    return clipPipeline.renameClipFile({ metadataPath, fileName })
  })
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
    applyLaunchAtLogin(settings)
    void startStoredProxyRuntime(settings).catch((error) => {
      const message = error instanceof Error ? error.message : 'неизвестная ошибка'
      console.error('Proxy runtime autostart failed:', error)
      showSystemNotification({
        title: 'TradeTools',
        body: `Локальный proxy не запустился после старта: ${message}`
      })
    })
    if (
      settings.exchange.binanceFutures.enabled &&
      settings.exchange.binanceFutures.apiKeyConfigured &&
      settings.exchange.binanceFutures.apiSecretConfigured
    ) {
      startBinanceFuturesPolling()
    }
    void notifyProxyPaymentsDue().catch((error) => console.error('Proxy payment notification failed:', error))
  })
  setInterval(() => void notifyProxyPaymentsDue().catch((error) => console.error('Proxy payment notification failed:', error)), proxyPaymentReminderIntervalMs)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void stopLocalXrayRuntime()
})
