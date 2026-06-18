import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, Notification, screen as electronScreen, session, shell, type OpenDialogOptions } from 'electron'
import { basename, dirname, extname, isAbsolute, join, sep } from 'node:path'
import { listProxyPaymentReminders } from './services/notifications/proxyPaymentReminders'
import { inspectProxyNetworkEnvironment, type NetworkDiagnosticStatus, type NetworkEnvironmentSnapshot } from './services/proxies/networkEnvironment'
import { createObsService } from './services/obs/obsService'
import { setupProxyChainOnServers, type ProxyChainRuntimeConfig } from './services/proxies/proxyChainSetup'
import { createWindowRecorderService, type WindowCaptureSource, type WindowRecordingSegmentInput } from './services/recording/windowRecorderService'
import { checkSshConnection, parseSshEndpoint, type SshConnectionCheckResult } from './services/proxies/sshConnectionCheck'
import { configureVpnBypassRoutes, type VpnBypassRouteResult } from './services/proxies/vpnBypassRoutes'
import { setupLocalXrayRuntime, stopLocalXrayRuntime } from './services/proxies/xrayLocalRuntime'
import { createSecretStore } from './services/security/secretStore'
import { type AppSettings, type CaptureTargetRef, type ProxyRecord, type SettingsUpdateInput } from './services/settings/settings'
import { createSettingsStore } from './services/settings/settingsStore'
import type { ClosedTrade } from './services/trades/simulatedTradePipeline'
import { createTerminalTradeWatcher, type TerminalPositionEvent, type TerminalTradeSource } from './services/trades/terminalTradeRecorder'
import { createTradeClipPipeline, type ClipProcessingStatus, type ClipQueueItem } from './services/trades/tradeClipPipeline'
import { createAppUpdateService } from './services/updates/appUpdateService'
import { defaultLocalProxyPort } from '../shared/defaults'
import { createAppLogService } from './services/logging/appLogService'

const isAllowedDevUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return ['localhost', '127.0.0.1'].includes(parsed.hostname)
  } catch {
    return false
  }
}

const getIconPath = (): string => join(__dirname, '../../build/icon.png')
const obsReplayEnsureIntervalMs = 30_000
const proxyPaymentReminderIntervalMs = 6 * 60 * 60 * 1000
const previewVideoExtensions = new Set(['.mp4', '.mkv', '.mov', '.flv', '.ts'])
const windowsAppUserModelId = 'com.tradetools.desktop'
const windowsDesktopCaptureFallbackFeatures = [
  'AllowWgcWindowCapturer',
  'AllowWgcWindowZeroHz',
  'AllowWgcScreenCapturer',
  'AllowWgcScreenZeroHz'
]
const macLoopbackAudioFeatures = [
  'MacLoopbackAudioForScreenShare',
  'MacSckSystemAudioLoopbackOverride'
]

if (process.platform === 'win32') {
  app.setAppUserModelId(windowsAppUserModelId)
  app.commandLine.appendSwitch('disable-features', windowsDesktopCaptureFallbackFeatures.join(','))
}
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('enable-features', macLoopbackAudioFeatures.join(','))
}

const getErrorMessage = (error: unknown): string => error instanceof Error ? error.message : 'неизвестная ошибка'

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

const isTrustedRendererUrl = (url: string): boolean => url.startsWith('file://') || (!app.isPackaged && isAllowedDevUrl(url))

type DesktopCaptureSource = Awaited<ReturnType<typeof desktopCapturer.getSources>>[number]
type WindowBounds = { x: number, y: number, width: number, height: number }

const listDesktopCaptureSources = (): Promise<DesktopCaptureSource[]> => desktopCapturer.getSources({
  types: ['window', 'screen'],
  thumbnailSize: { width: 1, height: 1 },
  fetchWindowIcons: false
})

const desktopSourceWindowId = (sourceId: string): string => /^window:(\d+):/.exec(sourceId)?.[1] ?? ''

const listWindowBounds = (windowIds: string[]): Map<string, WindowBounds> => {
  if (process.platform !== 'win32') return new Map()

  const handles = [...new Set(windowIds
    .map((windowId) => Number(windowId))
    .filter((windowId) => Number.isInteger(windowId) && windowId > 0)
  )]
  if (handles.length === 0) return new Map()

  const script = `
$source = @"
using System;
using System.Runtime.InteropServices;
public static class TradeToolsWindowBounds {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  public static string Bounds(long handle) {
    RECT rect;
    if (!GetWindowRect(new IntPtr(handle), out rect)) return "";
    int width = rect.Right - rect.Left;
    int height = rect.Bottom - rect.Top;
    if (width <= 0 || height <= 0) return "";
    return String.Format("{0},{1},{2},{3}", rect.Left, rect.Top, width, height);
  }
}
"@
Add-Type $source
foreach ($handle in @(${handles.join(',')})) {
  $bounds = [TradeToolsWindowBounds]::Bounds([Int64]$handle)
  if ($bounds) { "{0}:{1}" -f $handle, $bounds }
}
`

  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true
    })
    if (result.status !== 0) return new Map()

    return new Map(String(result.stdout)
      .split(/\r?\n/)
      .flatMap((line) => {
        const separatorIndex = line.indexOf(':')
        if (separatorIndex <= 0) return []
        const windowId = line.slice(0, separatorIndex).trim()
        const [x, y, width, height] = line.slice(separatorIndex + 1).split(',').map(Number)
        return windowId && [x, y, width, height].every((value) => Number.isFinite(value))
          ? [[windowId, { x, y, width, height }] as const]
          : []
      }))
  } catch {
    return new Map()
  }
}

const listWindowProcessIds = (windowIds: string[]): Map<string, number> => {
  if (process.platform !== 'win32') return new Map()

  const handles = [...new Set(windowIds
    .map((windowId) => Number(windowId))
    .filter((windowId) => Number.isInteger(windowId) && windowId > 0)
  )]
  if (handles.length === 0) return new Map()

  const script = `
$source = @"
using System;
using System.Runtime.InteropServices;
public static class TradeToolsWindowProcess {
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  public static string ProcessId(long handle) {
    uint processId;
    GetWindowThreadProcessId(new IntPtr(handle), out processId);
    return processId > 0 ? processId.ToString() : "";
  }
}
"@
Add-Type $source
foreach ($handle in @(${handles.join(',')})) {
  $processId = [TradeToolsWindowProcess]::ProcessId([Int64]$handle)
  if ($processId) { "{0}:{1}" -f $handle, $processId }
}
`

  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true
    })
    if (result.status !== 0) return new Map()

    return new Map(String(result.stdout)
      .split(/\r?\n/)
      .flatMap((line) => {
        const [windowId, processIdText] = line.trim().split(':')
        const processId = Number(processIdText)
        return windowId && Number.isInteger(processId) && processId > 0 ? [[windowId, processId] as const] : []
      }))
  } catch {
    return new Map()
  }
}

const getForegroundWindowId = (): string => {
  if (process.platform !== 'win32') return ''

  const script = `
$source = @"
using System;
using System.Runtime.InteropServices;
public static class TradeToolsForegroundWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public static long Handle() { return GetForegroundWindow().ToInt64(); }
}
"@
Add-Type $source
[TradeToolsForegroundWindow]::Handle()
`

  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true
    })
    if (result.status !== 0) return ''

    const windowId = String(result.stdout).trim()
    return /^\d+$/.test(windowId) && windowId !== '0' ? windowId : ''
  } catch {
    return ''
  }
}

const resolveWindowDisplayId = (source: DesktopCaptureSource, windowBounds: Map<string, WindowBounds>): string => {
  const bounds = windowBounds.get(desktopSourceWindowId(source.id))
  if (!bounds) return ''

  try {
    return String(electronScreen.getDisplayMatching(bounds).id)
  } catch {
    return ''
  }
}

const toWindowCaptureSource = (
  source: DesktopCaptureSource,
  windowProcessIds = new Map<string, number>(),
  windowBounds = new Map<string, WindowBounds>()
): WindowCaptureSource => {
  const type = source.id.startsWith('screen:') ? 'screen' : 'window'
  const fallbackName = type === 'screen' ? `Экран ${source.display_id || source.id}` : `Окно ${source.id}`
  const windowId = desktopSourceWindowId(source.id)
  const bounds = windowBounds.get(windowId)
  const processId = type === 'window' ? windowProcessIds.get(windowId) : undefined
  const displayId = source.display_id || (type === 'window' ? resolveWindowDisplayId(source, windowBounds) : '')

  return {
    id: source.id,
    name: source.name.trim() || fallbackName,
    displayId,
    type,
    ...(processId ? { processId } : {}),
    ...(bounds ? { bounds } : {})
  }
}

const listWindowCaptureSources = async (): Promise<WindowCaptureSource[]> => {
  const sources = await listDesktopCaptureSources()
  const windowIds = sources.map((source) => desktopSourceWindowId(source.id)).filter(Boolean)
  const windowProcessIds = listWindowProcessIds(windowIds)
  const windowBounds = listWindowBounds(windowIds)
  return sources.map((source) => toWindowCaptureSource(source, windowProcessIds, windowBounds))
}

const toCaptureTargetRef = (source: WindowCaptureSource): CaptureTargetRef => ({
  id: source.id,
  name: source.name,
  type: source.type,
  ...(source.displayId ? { displayId: source.displayId } : {})
})

const legacyCaptureTargetFromSettings = (settings: AppSettings): CaptureTargetRef | undefined => (
  settings.recording.windowSourceId
    ? {
        id: settings.recording.windowSourceId,
        name: settings.recording.windowSourceName || (settings.recording.sourceType === 'screen' ? 'Экран' : 'Окно'),
        type: settings.recording.sourceType
      }
    : undefined
)

const configuredCaptureTargets = (settings: AppSettings): CaptureTargetRef[] => (
  settings.recording.captureTargets.length > 0
    ? settings.recording.captureTargets
    : legacyCaptureTargetFromSettings(settings) ? [legacyCaptureTargetFromSettings(settings)!] : []
)

const terminalWindowPatterns: Record<TerminalTradeSource, RegExp[]> = {
  vataga: [/vataga/i, /ватага/i],
  tigertrade: [/tiger/i, /тигр/i],
  metascalp: [/metascalp/i, /metatrader/i, /mt4/i, /mt5/i]
}

const windowContainsPoint = (source: WindowCaptureSource, point: { x: number, y: number }): boolean => {
  const bounds = source.bounds
  return Boolean(bounds) &&
    point.x >= bounds!.x &&
    point.x < bounds!.x + bounds!.width &&
    point.y >= bounds!.y &&
    point.y < bounds!.y + bounds!.height
}

const terminalSourceLog = (source: WindowCaptureSource) => ({
  id: source.id,
  name: source.name,
  processId: source.processId,
  displayId: source.displayId,
  bounds: source.bounds
})

const selectTerminalSource = (
  event: TerminalPositionEvent,
  terminalSources: WindowCaptureSource[]
): { source?: WindowCaptureSource, candidates: WindowCaptureSource[], reason: 'process' | 'foreground' | 'cursor' | 'first' | 'ambiguous' | 'none' } => {
  const processCandidates = event.processId
    ? terminalSources.filter((candidate) => candidate.processId === event.processId)
    : []
  const candidates = processCandidates.length > 0 ? processCandidates : terminalSources
  if (candidates.length === 0) return { candidates, reason: 'none' }
  if (candidates.length === 1) return { source: candidates[0], candidates, reason: processCandidates.length > 0 ? 'process' : 'first' }

  const foregroundWindowId = getForegroundWindowId()
  const foregroundSource = foregroundWindowId
    ? candidates.find((candidate) => desktopSourceWindowId(candidate.id) === foregroundWindowId)
    : undefined
  if (foregroundSource) return { source: foregroundSource, candidates, reason: 'foreground' }

  const cursorPoint = electronScreen.getCursorScreenPoint()
  const cursorSource = candidates.find((candidate) => windowContainsPoint(candidate, cursorPoint))
  if (cursorSource) return { source: cursorSource, candidates, reason: 'cursor' }

  return { candidates, reason: 'ambiguous' }
}

const isCurrentWindowSourceAvailable = async (input: { sourceId: string, sourceName: string }): Promise<boolean> => {
  const sources = await listWindowCaptureSources()
  return sources.some((source) => (
    source.type === 'window' &&
    ((input.sourceId && source.id === input.sourceId) || (input.sourceName && source.name === input.sourceName))
  ))
}

const getPackagedUpdateConfigPaths = (): string[] => {
  const candidates = [
    join(process.resourcesPath, 'app-update.yml'),
    join(dirname(process.execPath), 'resources', 'app-update.yml')
  ]
  return [...new Set(candidates)]
}

const hasPackagedUpdateConfig = (): boolean => getPackagedUpdateConfigPaths().some((filePath) => existsSync(filePath))

const hasPackagedAppArchive = (): boolean => (
  existsSync(join(process.resourcesPath, 'app.asar')) ||
  existsSync(join(dirname(process.execPath), 'resources', 'app.asar'))
)

const isInstalledUpdateBuild = (): boolean => {
  if (app.isPackaged) return true
  if (process.defaultApp) return false

  const executableName = basename(process.execPath).toLowerCase()
  if (process.platform === 'win32') {
    const executablePath = process.execPath.toLowerCase()
    return executableName === 'tradetools.exe' && (
      hasPackagedAppArchive() ||
      hasPackagedUpdateConfig() ||
      executablePath.includes(`${sep}programs${sep}tradetools${sep}`.toLowerCase())
    )
  }

  if (process.platform === 'darwin') {
    return process.execPath.includes('.app/Contents/MacOS/') && (
      hasPackagedAppArchive() ||
      hasPackagedUpdateConfig()
    )
  }

  return false
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

const applyAlwaysOnTop = (settings: AppSettings): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.setAlwaysOnTop(settings.system.alwaysOnTop)
  }
}

let keepProxyRunningAfterClose = false

const applyProxyQuitPreference = (settings: AppSettings): void => {
  keepProxyRunningAfterClose = settings.system.keepProxyRunningAfterClose
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
  const appLog = createAppLogService({ appDataDir: app.getPath('userData') })
  const settingsStore = createSettingsStore(app.getPath('userData'))
  const secretStore = createSecretStore()
  const obsService = createObsService({
    getSettings: () => settingsStore.load(),
    getPassword: () => secretStore.getObsPassword()
  })
  const windowRecorderService = createWindowRecorderService({
    appDataDir: app.getPath('userData'),
    isWindowSourceAvailable: isCurrentWindowSourceAvailable,
    getDisplayBounds: () => electronScreen.getAllDisplays().map((display) => ({
      displayId: String(display.id),
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    }))
  })
  const clipPipeline = createTradeClipPipeline({
    getSettings: () => settingsStore.load(),
    saveReplayBuffer: (input) => input.settings.recording.mode === 'window'
      ? windowRecorderService.saveReplayBuffer(input)
      : obsService.testReplaySave()
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

  const notifyWindowRecordingNeeded = () => {
    const windows = BrowserWindow.getAllWindows()
    const targets = windows.length > 0 ? windows : [createMainWindow()]

    for (const window of targets) {
      const send = () => window.webContents.send('recording:ensure-window')
      if (window.webContents.isLoading()) {
        window.webContents.once('did-finish-load', send)
      } else {
        send()
      }
    }
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

  const appUpdateService = createAppUpdateService({
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    isInstalledBuild: isInstalledUpdateBuild(),
    hasUpdateConfig: hasPackagedUpdateConfig(),
    platform: process.platform,
    broadcast: (status) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('updates:status', status)
      }
    },
    onUpdateAvailable: (status) => {
      const version = status.version ? ` ${status.version}` : ''
      const notification = showSystemNotification({
        title: 'Вышла новая версия TradeTools',
        body: `Доступна версия${version}. Откройте TradeTools, чтобы скачать обновление.`,
        onClick: focusMainWindow
      })
      if (!notification.ok) console.warn(`Update notification failed: ${notification.message}`)
    }
  })

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

  type ClipRenderJob = {
    id: string
    trade?: ClosedTrade
    manualBuffer?: boolean
    requestedAtMs?: number
    captureTarget?: CaptureTargetRef
    title: string
    queuedAtMs: number
    protectedSinceMs: number
    abortController: AbortController
    cancelled: boolean
    resolve?: (clip: ClipQueueItem) => void
    reject?: (error: unknown) => void
  }

  const emptyClipProcessingStatus = (): ClipProcessingStatus => ({
    active: false,
    title: '',
    message: '',
    progressPercent: 0
  })

  let clipProcessingClearTimer: NodeJS.Timeout | undefined
  let clipProcessingStatus: ClipProcessingStatus = emptyClipProcessingStatus()
  let watcherProtectedSinceMs = 0
  const clipRenderQueue: ClipRenderJob[] = []
  let activeClipRenderJob: ClipRenderJob | undefined
  let clipRenderWorkerRunning = false

  const normalizeProtectionTime = (value?: number): number => (
    Number.isFinite(value) && (value ?? 0) > 0 ? Math.trunc(value as number) : 0
  )

  const applyWindowRecorderProtection = () => {
    const protectedTimes = [
      watcherProtectedSinceMs,
      activeClipRenderJob?.protectedSinceMs ?? 0,
      ...clipRenderQueue.map((job) => job.protectedSinceMs)
    ].filter((value) => value > 0)

    windowRecorderService.protectSince(protectedTimes.length ? Math.min(...protectedTimes) : undefined)
  }

  const setWatcherProtectedSince = (timeMs?: number) => {
    watcherProtectedSinceMs = normalizeProtectionTime(timeMs)
    applyWindowRecorderProtection()
  }

  const setClipProcessingStatus = (status: ClipProcessingStatus) => {
    if (clipProcessingClearTimer) {
      clearTimeout(clipProcessingClearTimer)
      clipProcessingClearTimer = undefined
    }
    clipProcessingStatus = status
  }

  const clearClipProcessingSoon = () => {
    if (clipProcessingClearTimer) clearTimeout(clipProcessingClearTimer)
    clipProcessingClearTimer = setTimeout(() => {
      clipProcessingStatus = {
        active: false,
        title: '',
        message: '',
        progressPercent: 0
      }
      clipProcessingClearTimer = undefined
    }, 1_500)
  }

  const currentClipProcessingStatus = (): ClipProcessingStatus => {
    const queuedCount = clipRenderQueue.length
    const queuedJobs = clipRenderQueue.map((job) => ({ id: job.id, title: job.title }))
    if (!clipProcessingStatus.active) {
      return queuedCount > 0
        ? {
            active: true,
            title: 'Очередь клипов',
            message: `Ждём обработки: ${queuedCount}`,
            progressPercent: 10,
            queuedCount,
            queuedJobs
          }
        : clipProcessingStatus
    }

    const elapsedSeconds = clipProcessingStatus.startedAtMs
      ? Math.max(0, Math.floor((Date.now() - clipProcessingStatus.startedAtMs) / 1000))
      : 0
    const dynamicProgress = clipProcessingStatus.progressPercent > 0 && clipProcessingStatus.progressPercent < 95
      ? Math.min(88, Math.max(clipProcessingStatus.progressPercent, 35 + Math.floor(elapsedSeconds / 2)))
      : clipProcessingStatus.progressPercent
    const queueSuffix = queuedCount > 0 ? ` В очереди ещё ${queuedCount}.` : ''
    const elapsedSuffix = elapsedSeconds >= 5 && dynamicProgress < 95 ? ` Идёт ${elapsedSeconds}с.` : ''

    return {
      ...clipProcessingStatus,
      message: `${clipProcessingStatus.message}${queueSuffix}${elapsedSuffix}`,
      progressPercent: dynamicProgress,
      queuedCount,
      activeJobId: activeClipRenderJob?.id,
      queuedJobs
    }
  }

  const clipJobLogContext = (job: ClipRenderJob) => ({
    jobId: job.id,
    tradeId: job.trade?.id,
    symbol: job.trade?.symbol,
    side: job.trade?.side,
    entryTimeMs: job.trade?.entryTimeMs,
    exitTimeMs: job.trade?.exitTimeMs,
    manualBuffer: job.manualBuffer === true,
    captureTarget: job.captureTarget,
    queuedCount: clipRenderQueue.length
  })

  const runClipRenderQueue = () => {
    if (clipRenderWorkerRunning) return
    clipRenderWorkerRunning = true

    void (async () => {
      try {
        while (clipRenderQueue.length > 0) {
          const job = clipRenderQueue.shift()
          if (!job) continue
          if (job.cancelled) continue

          activeClipRenderJob = job
          applyWindowRecorderProtection()
          const startedAtMs = Date.now()
          void appLog.info('clip-queue', 'Clip render started', clipJobLogContext(job))
          setClipProcessingStatus({
            active: true,
            title: job.title,
            message: job.manualBuffer ? 'Сохраняем последний буфер' : 'Сохраняем replay и собираем клип сделки',
            progressPercent: 35,
            startedAtMs,
            queuedCount: clipRenderQueue.length,
            activeJobId: job.id,
            queuedJobs: clipRenderQueue.map((queuedJob) => ({ id: queuedJob.id, title: queuedJob.title }))
          })

          try {
            const clip = job.manualBuffer
              ? await clipPipeline.createManualBufferClip({
                  requestedAtMs: job.requestedAtMs,
                  captureTarget: job.captureTarget,
                  signal: job.abortController.signal
                })
              : await clipPipeline.createClipForClosedTrade(job.trade!, {
                  captureTarget: job.captureTarget,
                  signal: job.abortController.signal
                })
            setClipProcessingStatus({
              active: true,
              title: clip.title,
              message: 'Клип сохранён, обновляем очередь',
              progressPercent: 95,
              startedAtMs,
              queuedCount: clipRenderQueue.length,
              activeJobId: job.id
            })
            void appLog.info('clip-queue', 'Clip render finished', {
              ...clipJobLogContext(job),
              videoPath: clip.videoPath,
              metadataPath: clip.metadataPath
            })
            await notifyClipCreated(clip)
            job.resolve?.(clip)
          } catch (error) {
            if (job.cancelled || job.abortController.signal.aborted) {
              void appLog.info('clip-queue', 'Clip render cancelled', clipJobLogContext(job))
            } else {
              void appLog.error('clip-queue', 'Clip render failed', error, clipJobLogContext(job))
            }
            setClipProcessingStatus({
              active: false,
              title: job.title,
              message: job.cancelled || job.abortController.signal.aborted ? 'Сохранение отменено' : getErrorMessage(error),
              progressPercent: 0,
              queuedCount: clipRenderQueue.length
            })
            job.reject?.(error)
            if (!job.reject && !job.cancelled) console.warn(`Clip render failed: ${getErrorMessage(error)}`)
          } finally {
            activeClipRenderJob = undefined
            applyWindowRecorderProtection()
          }
        }
      } finally {
        clipRenderWorkerRunning = false
        if (clipRenderQueue.length > 0) {
          runClipRenderQueue()
        } else if (clipProcessingStatus.active) {
          clearClipProcessingSoon()
        }
      }
    })()
  }

  const targetSuffix = (captureTarget?: CaptureTargetRef): string => captureTarget ? ` - ${captureTarget.name}` : ''

  const enqueueClipRender = async (
    trade: ClosedTrade,
    options: { waitForCompletion: boolean, captureTarget?: CaptureTargetRef }
  ): Promise<ClipQueueItem | void> => {
    const title = `${trade.symbol} ${trade.side}${targetSuffix(options.captureTarget)}`
    const settings = await settingsStore.load()
    const protectedSinceMs = settings.recording.mode === 'window'
      ? Math.max(1, trade.entryTimeMs - settings.clip.paddingBeforeSeconds * 1000 - 5_000)
      : 0
    const queuedAtMs = Date.now()
    let resolveCompletion: ((clip: ClipQueueItem) => void) | undefined
    let rejectCompletion: ((error: unknown) => void) | undefined
    const completion = options.waitForCompletion
      ? new Promise<ClipQueueItem>((resolve, reject) => {
          resolveCompletion = resolve
          rejectCompletion = reject
        })
      : undefined

    const job: ClipRenderJob = {
      id: `${trade.id}-${queuedAtMs}`,
      trade,
      title,
      queuedAtMs,
      protectedSinceMs,
      captureTarget: options.captureTarget,
      abortController: new AbortController(),
      cancelled: false,
      resolve: resolveCompletion,
      reject: rejectCompletion
    }
    clipRenderQueue.push(job)
    void appLog.info('clip-queue', 'Clip render queued', clipJobLogContext(job))
    applyWindowRecorderProtection()
    setClipProcessingStatus({
      active: true,
      title,
      message: activeClipRenderJob || clipRenderWorkerRunning
        ? `Клип поставлен в очередь. Перед ним задач: ${Math.max(0, clipRenderQueue.length - 1)}`
        : 'Клип поставлен в очередь обработки',
      progressPercent: 10,
      startedAtMs: queuedAtMs,
      queuedCount: clipRenderQueue.length,
      queuedJobs: clipRenderQueue.map((queuedJob) => ({ id: queuedJob.id, title: queuedJob.title }))
    })
    runClipRenderQueue()

    return completion
  }

  const enqueueManualBufferRender = async (
    options: { waitForCompletion: boolean, requestedAtMs: number, captureTarget?: CaptureTargetRef }
  ): Promise<ClipQueueItem | void> => {
    const settings = await settingsStore.load()
    const title = `Буфер TradeTools${targetSuffix(options.captureTarget)}`
    const protectedSinceMs = settings.recording.mode === 'window'
      ? Math.max(1, options.requestedAtMs - settings.clip.replayBufferSeconds * 1000 - 5_000)
      : 0
    const queuedAtMs = Date.now()
    let resolveCompletion: ((clip: ClipQueueItem) => void) | undefined
    let rejectCompletion: ((error: unknown) => void) | undefined
    const completion = options.waitForCompletion
      ? new Promise<ClipQueueItem>((resolve, reject) => {
          resolveCompletion = resolve
          rejectCompletion = reject
        })
      : undefined
    const job: ClipRenderJob = {
      id: `manual-buffer-${options.requestedAtMs}-${options.captureTarget?.id ?? 'default'}-${queuedAtMs}`,
      manualBuffer: true,
      requestedAtMs: options.requestedAtMs,
      captureTarget: options.captureTarget,
      title,
      queuedAtMs,
      protectedSinceMs,
      abortController: new AbortController(),
      cancelled: false,
      resolve: resolveCompletion,
      reject: rejectCompletion
    }

    clipRenderQueue.push(job)
    void appLog.info('clip-queue', 'Clip render queued', clipJobLogContext(job))
    applyWindowRecorderProtection()
    setClipProcessingStatus({
      active: true,
      title,
      message: activeClipRenderJob || clipRenderWorkerRunning
        ? `Буфер поставлен в очередь. Перед ним задач: ${Math.max(0, clipRenderQueue.length - 1)}`
        : 'Буфер поставлен в очередь обработки',
      progressPercent: 10,
      startedAtMs: queuedAtMs,
      queuedCount: clipRenderQueue.length,
      queuedJobs: clipRenderQueue.map((queuedJob) => ({ id: queuedJob.id, title: queuedJob.title }))
    })
    runClipRenderQueue()

    return completion
  }

  const tradeDisplayOnlyWithoutResolvedTarget = (settings: AppSettings, trade: ClosedTrade): boolean => (
    settings.recording.mode === 'window' &&
    settings.recording.sourceType === 'screen' &&
    settings.recording.saveTradeDisplayOnly &&
    !trade.recordingTarget
  )

  const cancelClipRender = (jobId?: string): { ok: true, cancelledCount: number } => {
    let cancelledCount = 0
    if ((!jobId || activeClipRenderJob?.id === jobId) && activeClipRenderJob) {
      activeClipRenderJob.cancelled = true
      activeClipRenderJob.abortController.abort()
      cancelledCount += 1
    }

    for (let index = clipRenderQueue.length - 1; index >= 0; index -= 1) {
      const job = clipRenderQueue[index]
      if (!job || (jobId && job.id !== jobId)) continue

      clipRenderQueue.splice(index, 1)
      job.cancelled = true
      job.abortController.abort()
      job.reject?.(new Error('Сохранение клипа отменено'))
      cancelledCount += 1
    }

    if (cancelledCount > 0) {
      setClipProcessingStatus({
        active: Boolean(activeClipRenderJob && !activeClipRenderJob.cancelled),
        title: activeClipRenderJob?.title ?? '',
        message: 'Сохранение отменено',
        progressPercent: 0,
        activeJobId: activeClipRenderJob?.id,
        queuedCount: clipRenderQueue.length,
        queuedJobs: clipRenderQueue.map((job) => ({ id: job.id, title: job.title }))
      })
      applyWindowRecorderProtection()
      void appLog.info('clip-queue', 'Clip render cancel requested', { jobId, cancelledCount })
    }

    return { ok: true, cancelledCount }
  }

  const selectClipRenderTargets = (settings: AppSettings, preferredTarget?: CaptureTargetRef): Array<CaptureTargetRef | undefined> => {
    if (settings.recording.mode !== 'window') return [undefined]
    if (preferredTarget) return [preferredTarget]

    const targets = configuredCaptureTargets(settings)
    if (settings.recording.sourceType === 'screen' && settings.recording.saveTargetMode === 'all') {
      const screenTargets = targets.filter((target) => target.type === 'screen')
      return screenTargets.length > 0 ? screenTargets : [undefined]
    }

    if (settings.recording.saveTargetMode === 'selected' && settings.recording.saveTargetId) {
      return [targets.find((target) => target.id === settings.recording.saveTargetId) ?? targets[0]]
    }

    return [targets[0]]
  }

  const selectManualBufferTargets = (settings: AppSettings, captureTargetId?: string): Array<CaptureTargetRef | undefined> => {
    const targets = selectClipRenderTargets(settings)
    if (!captureTargetId) return targets
    return [configuredCaptureTargets(settings).find((target) => target.id === captureTargetId) ?? targets[0]]
  }

  let lastObsReplayEnsureAtMs = 0
  let obsReplayBufferReady = false
  let backgroundWindowRecordingEnabled = true

  const ensureObsReplayBufferActive = async (force = false): Promise<boolean> => {
    const checkedAtMs = Date.now()
    if (!force && obsReplayBufferReady && checkedAtMs - lastObsReplayEnsureAtMs < obsReplayEnsureIntervalMs) return true

    lastObsReplayEnsureAtMs = checkedAtMs
    const status = await obsService.ensureReplayBufferActive()
    obsReplayBufferReady = status.connected && status.replayBufferActive
    return obsReplayBufferReady
  }

  const ensureVideoRecordingReady = async (force = false): Promise<boolean> => {
    const settings = await settingsStore.load()
    if (settings.recording.mode === 'obs') {
      return ensureObsReplayBufferActive(force)
    }
    if (!backgroundWindowRecordingEnabled) return false

    const status = await windowRecorderService.getStatus(settings)
    if (!status.active || status.fallbackRequired) {
      notifyWindowRecordingNeeded()
      const started = await windowRecorderService.start(settings)
      return started.active || started.fallbackRequired === true
    }

    return true
  }

  const resolveTerminalRecordingTarget = async (event: TerminalPositionEvent): Promise<CaptureTargetRef | undefined> => {
    const settings = await settingsStore.load()
    if (settings.recording.mode !== 'window') return undefined

    const sources = await listWindowCaptureSources()
    const patterns = terminalWindowPatterns[event.source]
    const terminalSources = sources.filter((candidate) => (
      candidate.type === 'window' && patterns.some((pattern) => pattern.test(candidate.name))
    ))
    const selection = selectTerminalSource(event, terminalSources)
    const source = selection.source
    const targets = configuredCaptureTargets(settings)

    if (event.processId && terminalSources.length > 1 && selection.candidates.length === 0) {
      void appLog.warn('recording', 'Terminal process id did not match any captured window; using first matching terminal window', {
        source: event.source,
        symbol: event.symbol,
        processId: event.processId,
        candidates: terminalSources.map(terminalSourceLog)
      })
    } else if (event.processId && selection.candidates.length > 1) {
      void appLog.info('recording', 'Terminal process has multiple matching windows; using focused or cursor window', {
        source: event.source,
        symbol: event.symbol,
        processId: event.processId,
        selectionReason: selection.reason,
        selected: source ? terminalSourceLog(source) : undefined,
        candidates: selection.candidates.map(terminalSourceLog)
      })
    }

    if (settings.recording.sourceType === 'screen' && settings.recording.saveTradeDisplayOnly) {
      if (!source) {
        void appLog.warn('recording', 'Terminal trade display monitor could not be resolved', {
          source: event.source,
          symbol: event.symbol,
          processId: event.processId,
          selectionReason: selection.reason,
          candidates: selection.candidates.map(terminalSourceLog)
        })
        return undefined
      }

      const matchingScreenTarget = targets.find((candidate) => (
        candidate.type === 'screen' && Boolean(candidate.displayId) && candidate.displayId === source.displayId
      ))
      if (matchingScreenTarget) {
        void appLog.info('recording', 'Terminal trade display matched screen capture target', {
          source: event.source,
          symbol: event.symbol,
          displayId: source.displayId,
          captureTarget: matchingScreenTarget
        })
        return matchingScreenTarget
      }

      void appLog.warn('recording', 'Terminal trade window found but display has no selected screen capture target', {
        source: event.source,
        symbol: event.symbol,
        displayId: source.displayId,
        selected: terminalSourceLog(source),
        captureTargets: targets
      })
      return undefined
    }

    if (settings.recording.sourceType === 'screen') return undefined

    if (source) {
      const target = toCaptureTargetRef(source)
      const nextCaptureTargets = [
        target,
        ...targets.filter((candidate) => candidate.type === 'window' && candidate.id !== target.id)
      ]

      if (settings.recording.windowSourceId !== target.id || !targets.some((candidate) => candidate.id === target.id)) {
        await settingsStore.update({
          recording: {
            ...settings.recording,
            sourceType: 'window',
            windowSourceId: target.id,
            windowSourceName: target.name,
            captureTargets: nextCaptureTargets,
            saveTargetMode: 'selected',
            saveTargetId: target.id
          }
        })
        notifyWindowRecordingNeeded()
      }

      return target
    }

    const fallback = configuredCaptureTargets(settings).find((target) => target.type === 'window') ?? configuredCaptureTargets(settings)[0]
    if (fallback) {
      void appLog.warn('recording', 'Terminal capture window not found; using configured capture target', {
        source: event.source,
        symbol: event.symbol,
        captureTarget: fallback
      })
    }
    return fallback
  }

  const queueClipForClosedTrade = async (trade: ClosedTrade): Promise<void> => {
    const settings = await settingsStore.load()
    if (tradeDisplayOnlyWithoutResolvedTarget(settings, trade)) {
      void appLog.warn('clip-queue', 'Clip render skipped because trade monitor was not resolved', {
        tradeId: trade.id,
        symbol: trade.symbol,
        side: trade.side,
        entryTimeMs: trade.entryTimeMs,
        exitTimeMs: trade.exitTimeMs
      })
      return
    }
    const targets = selectClipRenderTargets(settings, trade.recordingTarget)
    await Promise.all(targets.map((target) => enqueueClipRender(
      target ? { ...trade, recordingTarget: target } : trade,
      { waitForCompletion: false, captureTarget: target }
    )))
  }

  const terminalTradeWatcher = createTerminalTradeWatcher({
    getSettings: () => settingsStore.load(),
    ensureVideoRecordingReady,
    protectSince: setWatcherProtectedSince,
    createClipForClosedTrade: queueClipForClosedTrade,
    resolveRecordingTarget: resolveTerminalRecordingTarget,
    onStatusChange: (status) => {
      if (status.lastError) {
        console.warn(`Terminal trade watcher: ${status.lastError}`)
        void appLog.warn('terminal-trade', status.lastError, {
          source: status.source,
          activeTradeCount: status.activeTradeCount,
          lastEventAtMs: status.lastEventAtMs
        })
      }
    }
  })

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedCapturePermission = permission === 'media' || permission === 'display-capture'
    callback(allowedCapturePermission && isTrustedRendererUrl(webContents.getURL()))
  })
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (!isTrustedRendererUrl(request.securityOrigin)) {
        callback({})
        return
      }

      const settings = await settingsStore.load()
      const sources = await listDesktopCaptureSources()
      const hasSavedCaptureSource = Boolean(settings.recording.windowSourceId || settings.recording.windowSourceName)
      const source = sources.find((source) => source.id === settings.recording.windowSourceId) ??
        sources.find((source) => source.name === settings.recording.windowSourceName) ??
        (hasSavedCaptureSource ? undefined : sources.find((source) => settings.recording.sourceType === 'screen'
          ? source.id.startsWith('screen:')
          : !source.id.startsWith('screen:')))

      if (!source) {
        if (hasSavedCaptureSource) {
          void appLog.warn('recording', 'Saved capture source is missing; not falling back to another window', {
            sourceType: settings.recording.sourceType,
            sourceId: settings.recording.windowSourceId,
            sourceName: settings.recording.windowSourceName
          })
        }
        callback({})
        return
      }

      callback({
        video: source,
        audio: settings.recording.systemAudioEnabled ? 'loopback' : undefined
      })
    } catch (error) {
      console.warn('Display media request failed:', error)
      callback({})
    }
  })
  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('logs:get', () => appLog.getSnapshot())
  ipcMain.handle('logs:show-file', async () => {
    await appLog.info('diagnostics', 'Log file requested')
    shell.showItemInFolder(appLog.getPath())
  })
  ipcMain.handle('updates:get-status', () => appUpdateService.getStatus())
  ipcMain.handle('updates:check', () => appUpdateService.checkForUpdates())
  ipcMain.handle('updates:download', () => appUpdateService.downloadUpdate())
  ipcMain.handle('updates:install', () => appUpdateService.installUpdate())
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

    let updatedSettings = await settingsStore.update(patch)
    if (patch.proxies) updatedSettings = await clearProxyRuntimeConfig()
    applyLaunchAtLogin(updatedSettings)
    applyAlwaysOnTop(updatedSettings)
    applyProxyQuitPreference(updatedSettings)

    void notifyProxyPaymentsDue().catch((error) => console.error('Proxy payment notification failed:', error))
    return updatedSettings
  })
  ipcMain.handle('obs:get-status', () => obsService.getStatus())
  ipcMain.handle('obs:test-replay-save', () => obsService.testReplaySave())
  ipcMain.handle('recording:list-window-sources', async () => {
    return listWindowCaptureSources()
  })
  ipcMain.handle('recording:get-status', async () => windowRecorderService.getStatus(await settingsStore.load()))
  ipcMain.handle('recording:free-status', async () => windowRecorderService.getFreeRecordingStatus(await settingsStore.load()))
  ipcMain.handle('recording:start', async () => {
    backgroundWindowRecordingEnabled = true
    return windowRecorderService.start(await settingsStore.load())
  })
  ipcMain.handle('recording:free-start', async () => windowRecorderService.startFreeRecording(await settingsStore.load()))
  ipcMain.handle('recording:free-pause', async () => windowRecorderService.pauseFreeRecording(await settingsStore.load()))
  ipcMain.handle('recording:free-resume', async () => windowRecorderService.resumeFreeRecording(await settingsStore.load()))
  ipcMain.handle('recording:free-finish', async () => {
    const result = await windowRecorderService.finishFreeRecording(await settingsStore.load())
    await clipPipeline.addFreeRecordingToQueue(result)
    return result
  })
  ipcMain.handle('recording:stop', async () => {
    backgroundWindowRecordingEnabled = false
    return windowRecorderService.stop()
  })
  ipcMain.handle('recording:append-segment', async (_event, input: WindowRecordingSegmentInput) => (
    windowRecorderService.appendSegment(input, await settingsStore.load())
  ))
  ipcMain.handle('clipboard:write-text', (_event, text: string) => {
    if (typeof text !== 'string') throw new Error('Некорректный текст для буфера обмена')
    clipboard.writeText(text)
  })
  ipcMain.handle('links:open-external', async (_event, url: string) => {
    await shell.openExternal(assertHttpUrl(asString(url)))
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
  ipcMain.handle('terminal-trade:get-status', () => terminalTradeWatcher.getStatus())
  ipcMain.handle('clips:list-pending', () => clipPipeline.listPendingClips())
  ipcMain.handle('clips:get-processing-status', () => currentClipProcessingStatus())
  ipcMain.handle('clips:create-buffer', async (_event, input?: { captureTargetId?: string }) => {
    const settings = await settingsStore.load()
    const requestedAtMs = Date.now()
    const targets = selectManualBufferTargets(settings, asString(input?.captureTargetId))
    const clips = await Promise.all(targets.map((target) => enqueueManualBufferRender({
      waitForCompletion: true,
      requestedAtMs,
      captureTarget: target
    })))
    return clips.filter((clip): clip is ClipQueueItem => clip !== undefined)
  })
  ipcMain.handle('clips:create-test', async () => {
    const settings = await settingsStore.load()
    const [clip] = await Promise.all(selectManualBufferTargets(settings).map((target) => enqueueManualBufferRender({
      waitForCompletion: true,
      requestedAtMs: Date.now(),
      captureTarget: target
    })))
    if (!clip) throw new Error('Буфер не был обработан')
    return clip
  })
  ipcMain.handle('clips:cancel-render', (_event, jobId?: string) => cancelClipRender(asString(jobId)))
  ipcMain.handle('clips:clear-queue', () => clipPipeline.clearQueue())
  ipcMain.handle('clips:delete-queue-files', () => clipPipeline.deleteQueueFiles())
  ipcMain.handle('clips:open-output-folder', async () => {
    const settings = await settingsStore.load()
    mkdirSync(settings.clip.outputDir, { recursive: true })
    const openError = await shell.openPath(settings.clip.outputDir)
    if (openError) throw new Error(`Не удалось открыть папку с видео: ${openError}`)
  })
  ipcMain.handle('clips:delete-from-queue', (_event, metadataPath: string) => clipPipeline.deleteClipFromQueue(metadataPath))
  ipcMain.handle('clips:delete-file', (_event, metadataPath: string) => clipPipeline.deleteClipFile(metadataPath))
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
  appUpdateService.startBackgroundCheck()
  terminalTradeWatcher.start()
  app.on('before-quit', () => terminalTradeWatcher.stop())
  app.on('before-quit', () => {
    void windowRecorderService.stop()
  })

  void settingsStore.load().then((settings) => {
    applyLaunchAtLogin(settings)
    applyAlwaysOnTop(settings)
    applyProxyQuitPreference(settings)
    void startStoredProxyRuntime(settings).catch((error) => {
      const message = error instanceof Error ? error.message : 'неизвестная ошибка'
      console.error('Proxy runtime autostart failed:', error)
      showSystemNotification({
        title: 'TradeTools',
        body: `Локальный proxy не запустился после старта: ${message}`
      })
    })
    void notifyProxyPaymentsDue().catch((error) => console.error('Proxy payment notification failed:', error))
  })
  setInterval(() => void notifyProxyPaymentsDue().catch((error) => console.error('Proxy payment notification failed:', error)), proxyPaymentReminderIntervalMs)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
      void settingsStore.load().then(applyAlwaysOnTop)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (!keepProxyRunningAfterClose) void stopLocalXrayRuntime()
})
