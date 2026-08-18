import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, Notification, screen as electronScreen, session, shell, type OpenDialogOptions } from 'electron'
import { basename, dirname, extname, isAbsolute, join, sep } from 'node:path'
import { listProxyPaymentReminders } from './services/notifications/proxyPaymentReminders'
import { inspectProxyNetworkEnvironment, type NetworkDiagnosticStatus, type NetworkEnvironmentSnapshot } from './services/proxies/networkEnvironment'
import { reconnectStoredProxyRuntime, setupProxyChainOnServers, type ProxyChainRuntimeConfig } from './services/proxies/proxyChainSetup'
import { createWindowRecorderService, recorderStatusHasFreshSegments, type WindowCaptureSource, type WindowRecorderStatus, type WindowRecordingSegmentInput, type WindowRecordingStartedInput, type WindowRecordingStoppedInput } from './services/recording/windowRecorderService'
import { preferTerminalSourcesForSymbol, recordingSourceMatchesTarget } from './services/recording/terminalWindowSelection'
import { selectedWindowTradeTarget } from './services/recording/tradeCaptureTargetSelection'
import { checkSshConnection, parseSshEndpoint, type SshConnectionCheckResult } from './services/proxies/sshConnectionCheck'
import { configureVpnBypassRoutes, type VpnBypassRouteResult, type VpnBypassStatus } from './services/proxies/vpnBypassRoutes'
import { createVpnBypassMonitor, type VpnBypassMonitor } from './services/proxies/vpnBypassMonitor'
import { localXrayConfigPath } from './services/proxies/xrayBypassTargets'
import { isLocalXrayRuntimeRunning, setupLocalXrayRuntime, stopLocalXrayRuntime } from './services/proxies/xrayLocalRuntime'
import { createSecretStore } from './services/security/secretStore'
import { type AppSettings, type CaptureTargetRef, type LocalProxyType, type PartialSettings, type ProxyRecord, type SettingsUpdateInput } from './services/settings/settings'
import { createSettingsStore } from './services/settings/settingsStore'
import type { ClosedTrade } from './services/trades/simulatedTradePipeline'
import { createTerminalTradeWatcher, type TerminalPositionEvent, type TerminalTradeSource } from './services/trades/terminalTradeRecorder'
import { createTradeClipPipeline, type ClipProcessingStatus, type ClipQueueItem } from './services/trades/tradeClipPipeline'
import { recordingSourceRevision } from '../shared/recordingSourceRevision'
import { findTmmTradeUrl, findTmmTradeUrls, updateTmmTradeVideoPath } from './services/trades/tmmTradeMatcher'
import { createAppUpdateService } from './services/updates/appUpdateService'
import { listAvailableVideoEncoders } from './services/video/videoEncoderDevices'
import { defaultLocalProxyPort } from '../shared/defaults'
import { createAppLogService } from './services/logging/appLogService'
import { acquireAppDataInstanceLock } from './services/appDataInstanceLock'
import { recordingBufferSaveAccelerator, recordingToggleAccelerator, type RecordingControlStatus } from '../shared/recordingControl'
import { getRecordingWidgetPlacement } from './recordingWidgetPlacement'

const isAllowedDevUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return ['localhost', '127.0.0.1'].includes(parsed.hostname)
  } catch {
    return false
  }
}

const getIconPath = (): string => join(__dirname, '../../build/icon.png')
const proxyPaymentReminderIntervalMs = 6 * 60 * 60 * 1000
const previewVideoExtensions = new Set(['.mp4', '.mkv', '.mov', '.flv', '.ts'])
const windowsAppUserModelId = 'com.tradetools.desktop'
const windowsProxyRuntimeRunValueName = 'TradeTools Proxy Runtime'
const windowsRunKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const windowsLoginLaunchArg = '--windows-login'
const windowsProxyRuntimeStartupGraceMs = 8_000
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

const ownsElectronAppInstance = app.requestSingleInstanceLock()
const appDataInstanceLock = ownsElectronAppInstance
  ? acquireAppDataInstanceLock(app.getPath('userData'))
  : { acquired: false, release: () => undefined }
const ownsAppInstance = ownsElectronAppInstance && appDataInstanceLock.acquired
if (!ownsAppInstance) app.exit(0)
process.on('exit', appDataInstanceLock.release)

let mainWindow: BrowserWindow | undefined
let recordingWidgetWindow: BrowserWindow | undefined

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

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
  localProxyType?: LocalProxyType
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

const getWindowsLaunchArgs = (): string[] => [
  ...(process.defaultApp ? [app.getAppPath()] : []),
  windowsLoginLaunchArg
]

const isWindowsLoginLaunch = (): boolean => process.platform === 'win32' && process.argv.includes(windowsLoginLaunchArg)

const proxyAutostartRetryDelaysMs = [0, 5_000, 15_000]
const proxyRuntimeWatchdogIntervalMs = 5_000

const applyWindowsProxyRuntimeAutostart = (settings: AppSettings): void => {
  if (process.platform !== 'win32') return

  const runtime = settings.proxyRuntime
  const xrayPath = process.env.TRADETOOLS_XRAY_PATH || join(app.getPath('userData'), 'xray-core', 'xray.exe')
  const configPath = localXrayConfigPath(app.getPath('userData'))
  const enabled = settings.system.launchAtLogin && runtime.entryUuidConfigured && Boolean(runtime.activeStartProxyId) && Boolean(runtime.entryHost) && existsSync(xrayPath) && existsSync(configPath)

  try {
    const result = enabled
      ? spawnSync('reg', ['add', windowsRunKey, '/v', windowsProxyRuntimeRunValueName, '/t', 'REG_SZ', '/d', `"${xrayPath}" run -config "${configPath}"`, '/f'], { encoding: 'utf8', windowsHide: true })
      : spawnSync('reg', ['delete', windowsRunKey, '/v', windowsProxyRuntimeRunValueName, '/f'], { encoding: 'utf8', windowsHide: true })
    if (enabled && result.status !== 0) console.warn(`Windows proxy autostart registration failed: ${result.stderr || result.stdout}`)
  } catch (error) {
    console.warn('Windows proxy autostart registration failed:', error)
  }
}

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

const extractSettingsPatch = (input: SettingsUpdateInput): PartialSettings => {
  const {
    expectedRecordingSourceRevision: _expectedRecordingSourceRevision,
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
const asLocalProxyType = (value: unknown, fallback: LocalProxyType): LocalProxyType => value === 'HTTP' || value === 'SOCKS5' ? value : fallback

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
type WindowMetadata = { processId?: number, bounds?: WindowBounds }
type CachedWindowMetadata = WindowMetadata & { loadedAtMs: number }
type WindowMetadataResult = {
  metadataByWindowId: Map<string, WindowMetadata>
}

const listDesktopCaptureSources = (): Promise<DesktopCaptureSource[]> => desktopCapturer.getSources({
  types: ['window', 'screen'],
  thumbnailSize: { width: 1, height: 1 },
  fetchWindowIcons: false
})

const windowCaptureSourcesCacheMs = 5_000
const windowMetadataCacheMs = 5 * 60_000
const windowMetadataRetryMs = 30_000
const windowMetadataTimeoutMs = 45_000
const maxWindowMetadataOutputLength = 1024 * 1024
let windowCaptureSourcesCache: { loadedAtMs: number, sources: WindowCaptureSource[] } | undefined
const windowMetadataByWindowId = new Map<string, CachedWindowMetadata>()
const pendingWindowMetadataIds = new Set<string>()
let windowMetadataEnrichmentPromise: Promise<void> | undefined
let windowMetadataLastAttemptAtMs = 0

const desktopSourceWindowId = (sourceId: string): string => /^window:(\d+):/.exec(sourceId)?.[1] ?? ''

const sanitizedWindowHandles = (windowIds: string[]): number[] => [...new Set(windowIds
  .map((windowId) => Number(windowId))
  .filter((windowId) => Number.isSafeInteger(windowId) && windowId > 0)
)]

const parseWindowMetadata = (stdout: string, requestedWindowIds: Set<string>): WindowMetadataResult => {
  const metadataByWindowId = new Map<string, WindowMetadata>()

  for (const line of stdout.split(/\r?\n/)) {
    const [recordType, windowId, processIdText, xText, yText, widthText, heightText] = line.trim().split('|')
    if (recordType !== 'W' || !requestedWindowIds.has(windowId)) continue

    const processId = Number(processIdText)
    const x = Number(xText)
    const y = Number(yText)
    const width = Number(widthText)
    const height = Number(heightText)
    const bounds = [x, y, width, height].every((value) => Number.isFinite(value)) && width > 0 && height > 0
      ? { x, y, width, height }
      : undefined
    metadataByWindowId.set(windowId, {
      ...(Number.isInteger(processId) && processId > 0 ? { processId } : {}),
      ...(bounds ? { bounds } : {})
    })
  }

  return { metadataByWindowId }
}

const listWindowMetadata = (windowIds: string[]): Promise<WindowMetadataResult | undefined> => {
  if (process.platform !== 'win32') return Promise.resolve(undefined)

  const handles = sanitizedWindowHandles(windowIds)
  if (handles.length === 0) return Promise.resolve(undefined)
  const requestedWindowIds = new Set(handles.map(String))

  const script = `
$source = @"
using System;
using System.Runtime.InteropServices;
public static class TradeToolsWindowMetadata {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  public static string Describe(long handle) {
    uint processId;
    GetWindowThreadProcessId(new IntPtr(handle), out processId);
    RECT rect;
    if (!GetWindowRect(new IntPtr(handle), out rect)) return String.Format("W|{0}|{1}||||", handle, processId);
    int width = rect.Right - rect.Left;
    int height = rect.Bottom - rect.Top;
    if (width <= 0 || height <= 0) return String.Format("W|{0}|{1}||||", handle, processId);
    return String.Format("W|{0}|{1}|{2}|{3}|{4}|{5}", handle, processId, rect.Left, rect.Top, width, height);
  }
}
"@
Add-Type $source
foreach ($handle in @(${handles.join(',')})) {
  [TradeToolsWindowMetadata]::Describe([Int64]$handle)
}
`

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch {
      resolve(undefined)
      return
    }

    let stdout = ''
    let settled = false
    const finish = (result?: WindowMetadataResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }
    const timeout = setTimeout(() => {
      child.kill()
      finish()
    }, windowMetadataTimeoutMs)

    child.stdout?.on('data', (chunk) => {
      if (stdout.length >= maxWindowMetadataOutputLength) return
      stdout = `${stdout}${String(chunk)}`.slice(0, maxWindowMetadataOutputLength)
    })
    child.stderr?.resume()
    child.once('error', () => finish())
    child.once('close', (exitCode) => finish(exitCode === 0 ? parseWindowMetadata(stdout, requestedWindowIds) : undefined))
  })
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

const cachedWindowMetadataMaps = (windowIds: string[]): {
  windowProcessIds: Map<string, number>
  windowBounds: Map<string, WindowBounds>
} => {
  const windowProcessIds = new Map<string, number>()
  const windowBounds = new Map<string, WindowBounds>()
  for (const windowId of windowIds) {
    const metadata = windowMetadataByWindowId.get(windowId)
    if (metadata?.processId) windowProcessIds.set(windowId, metadata.processId)
    if (metadata?.bounds) windowBounds.set(windowId, metadata.bounds)
  }
  return { windowProcessIds, windowBounds }
}

const mergeCachedWindowMetadataIntoCaptureCache = (): void => {
  if (!windowCaptureSourcesCache) return
  windowCaptureSourcesCache = {
    ...windowCaptureSourcesCache,
    sources: windowCaptureSourcesCache.sources.map((source) => {
      if (source.type !== 'window') return source
      const metadata = windowMetadataByWindowId.get(desktopSourceWindowId(source.id))
      if (!metadata) return source

      const { processId: _previousProcessId, bounds: _previousBounds, ...baseSource } = source
      let displayId = source.displayId
      if (metadata.bounds) {
        try {
          displayId = String(electronScreen.getDisplayMatching(metadata.bounds).id)
        } catch {
          // Keep Electron's current display id when screen metadata is temporarily unavailable.
        }
      }
      return {
        ...baseSource,
        displayId,
        ...(metadata.processId ? { processId: metadata.processId } : {}),
        ...(metadata.bounds ? { bounds: metadata.bounds } : {})
      }
    })
  }
}

const scheduleWindowMetadataEnrichment = (windowIds: string[]): void => {
  if (process.platform !== 'win32') return

  const now = Date.now()
  const requestedWindowIds = sanitizedWindowHandles(windowIds).map(String)
  for (const windowId of requestedWindowIds) {
    const cached = windowMetadataByWindowId.get(windowId)
    if (!cached || now - cached.loadedAtMs >= windowMetadataCacheMs) {
      pendingWindowMetadataIds.add(windowId)
    } else {
      pendingWindowMetadataIds.delete(windowId)
    }
  }

  if (windowMetadataEnrichmentPromise || pendingWindowMetadataIds.size === 0) return
  if (now - windowMetadataLastAttemptAtMs < windowMetadataRetryMs) return

  const windowIdsToLoad = [...pendingWindowMetadataIds]
  windowIdsToLoad.forEach((windowId) => pendingWindowMetadataIds.delete(windowId))
  windowMetadataLastAttemptAtMs = now
  windowMetadataEnrichmentPromise = listWindowMetadata(windowIdsToLoad)
    .then((result) => {
      if (!result) return
      const loadedAtMs = Date.now()
      for (const windowId of windowIdsToLoad) {
        windowMetadataByWindowId.set(windowId, {
          loadedAtMs,
          ...result.metadataByWindowId.get(windowId)
        })
      }
      mergeCachedWindowMetadataIntoCaptureCache()
    })
    .catch(() => undefined)
    .finally(() => {
      windowMetadataEnrichmentPromise = undefined
      if (pendingWindowMetadataIds.size > 0) {
        scheduleWindowMetadataEnrichment([...pendingWindowMetadataIds])
      }
    })
}

const listWindowCaptureSources = async (forceRefresh = false): Promise<WindowCaptureSource[]> => {
  if (!forceRefresh && windowCaptureSourcesCache && Date.now() - windowCaptureSourcesCache.loadedAtMs < windowCaptureSourcesCacheMs) {
    return windowCaptureSourcesCache.sources
  }

  const sources = await listDesktopCaptureSources()
  const windowIds = sources.map((source) => desktopSourceWindowId(source.id)).filter(Boolean)
  const { windowProcessIds, windowBounds } = cachedWindowMetadataMaps(windowIds)
  const mappedSources = sources.map((source) => toWindowCaptureSource(source, windowProcessIds, windowBounds))
  windowCaptureSourcesCache = {
    loadedAtMs: Date.now(),
    sources: mappedSources
  }
  scheduleWindowMetadataEnrichment(windowIds)
  return mappedSources
}

const toCaptureTargetRef = (source: WindowCaptureSource): CaptureTargetRef => ({
  id: source.id,
  name: source.name,
  type: source.type,
  ...(source.processId ? { processId: source.processId } : {}),
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
): { source?: WindowCaptureSource, candidates: WindowCaptureSource[], reason: 'process' | 'symbol' | 'cursor' | 'first' | 'ambiguous' | 'none' } => {
  const processCandidates = event.processId
    ? terminalSources.filter((candidate) => candidate.processId === event.processId)
    : []
  const processScopedCandidates = processCandidates.length > 0 ? processCandidates : terminalSources
  const candidates = preferTerminalSourcesForSymbol(event.symbol, processScopedCandidates)
  if (candidates.length === 0) return { candidates, reason: 'none' }
  if (candidates.length === 1) {
    const reason = processScopedCandidates.length > candidates.length
      ? 'symbol'
      : processCandidates.length > 0
        ? 'process'
        : 'first'
    return { source: candidates[0], candidates, reason }
  }

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
  localProxyType: 'SOCKS5' as const,
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
      'TradeTools поднимает локальный proxy для торгового терминала.',
      'В терминале включите proxy для торгового подключения.',
      'Host: 127.0.0.1',
      `Port: ${localPort}`,
      'Выберите SOCKS5 или HTTP при запуске цепочки. Логин и пароль оставьте пустыми.',
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
  applyWindowsProxyRuntimeAutostart(settings)
}

const applyAlwaysOnTop = (settings: AppSettings): void => mainWindow?.setAlwaysOnTop(settings.system.alwaysOnTop)

let keepProxyRunningAfterClose = false

const applyProxyQuitPreference = (settings: AppSettings): void => {
  keepProxyRunningAfterClose = settings.system.keepProxyRunningAfterClose
}

const createMainWindow = (): BrowserWindow => {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 820,
    minHeight: 640,
    backgroundColor: '#0b1623',
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
  mainWindow = window
  window.on('closed', () => {
    mainWindow = undefined
    if (recordingWidgetWindow && !recordingWidgetWindow.isDestroyed()) recordingWidgetWindow.close()
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

const createRecordingWidgetWindow = (): BrowserWindow => {
  if (recordingWidgetWindow && !recordingWidgetWindow.isDestroyed()) return recordingWidgetWindow
  const { width, height, x, y } = getRecordingWidgetPlacement(electronScreen.getPrimaryDisplay(), process.platform === 'win32')
  const window = new BrowserWindow({
    width,
    height,
    x,
    y,
    useContentSize: true,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#0b1623',
    title: 'TradeTools Recording',
    icon: getIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  recordingWidgetWindow = window
  window.setContentProtection(true)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.once('ready-to-show', () => window.showInactive())
  window.on('closed', () => { recordingWidgetWindow = undefined })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL && isAllowedDevUrl(process.env.ELECTRON_RENDERER_URL)) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    url.searchParams.set('window', 'recording-widget')
    void window.loadURL(url.toString())
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: 'recording-widget' } })
  }

  return window
}

const repositionRecordingWidgetWindow = (): void => {
  if (!recordingWidgetWindow || recordingWidgetWindow.isDestroyed()) return
  const display = electronScreen.getDisplayMatching(recordingWidgetWindow.getBounds())
  recordingWidgetWindow.setBounds(getRecordingWidgetPlacement(
    display,
    process.platform === 'win32' && recordingWidgetWindow.isAlwaysOnTop()
  ))
}

const showRecordingWidget = (): void => {
  if (!recordingWidgetWindow || recordingWidgetWindow.isDestroyed()) {
    createRecordingWidgetWindow()
    return
  }
  if (recordingWidgetWindow.isAlwaysOnTop()) recordingWidgetWindow.showInactive()
  else recordingWidgetWindow.show()
}

app.whenReady().then(() => {
  if (!ownsAppInstance) return

  ensureWindowsNotificationShortcut()
  const appLog = createAppLogService({ appDataDir: app.getPath('userData') })
  const settingsStore = createSettingsStore(app.getPath('userData'))
  const secretStore = createSecretStore()
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
    saveReplayBuffer: (input) => windowRecorderService.saveReplayBuffer(input),
    findTmmTradeUrl: async (trade) => {
      const apiKey = await secretStore.getTmmApiKey()
      return apiKey ? findTmmTradeUrl({ apiKey, trade }) : undefined
    },
    findTmmTradeUrls: async (trades) => {
      const apiKey = await secretStore.getTmmApiKey()
      return apiKey ? findTmmTradeUrls({ apiKey, trades }) : trades.map(() => undefined)
    },
    updateTmmTradeVideoPath: async (tradeUrl, videoPath) => {
      const apiKey = await secretStore.getTmmApiKey()
      return apiKey ? updateTmmTradeVideoPath({ apiKey, tradeUrl, videoPath }) : false
    }
  })
  const saveProxyRuntimeConfig = async (config: ProxyChainRuntimeConfig): Promise<void> => {
    await secretStore.setProxyRuntimeEntryUuid(config.entryUuid)
    const updatedSettings = await settingsStore.update({
      proxyRuntime: {
        activeStartProxyId: config.activeStartProxyId,
        route: config.route,
        entryHost: config.entryHost,
        entryPort: config.entryPort,
        localPort: config.localPort,
        localProxyType: config.localProxyType,
        entryUuidConfigured: true,
        configuredAtMs: config.configuredAtMs
      }
    })
    applyLaunchAtLogin(updatedSettings)
  }

  const clearProxyRuntimeConfig = async () => {
    await secretStore.clearProxyRuntimeEntryUuid()
    const updatedSettings = await settingsStore.update({ proxyRuntime: emptyProxyRuntime() })
    applyLaunchAtLogin(updatedSettings)
    return updatedSettings
  }

  let vpnBypassMonitor: VpnBypassMonitor | undefined
  const idleVpnBypassStatus = (): VpnBypassStatus => ({
    state: 'idle',
    message: 'Локальный proxy ещё не подключён',
    fingerprint: '',
    targets: [],
    gateway: '',
    interfaceName: '',
    checkedAtMs: Date.now()
  })
  const startVpnBypassMonitor = async (): Promise<void> => {
    if (vpnBypassMonitor) vpnBypassMonitor.stop()
    vpnBypassMonitor = createVpnBypassMonitor({
      appDataDir: app.getPath('userData'),
      configPath: localXrayConfigPath(app.getPath('userData')),
      onStatus: (status) => {
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send('proxies:vpn-bypass-status', status)
      }
    })
    await vpnBypassMonitor.start()
  }

  const startStoredProxyRuntime = async (settings: AppSettings, onReady?: () => void): Promise<void> => {
    const runtime = settings.proxyRuntime
    if (!runtime.entryUuidConfigured || !runtime.activeStartProxyId || !runtime.entryHost || !runtime.localPort) {
      onReady?.()
      return
    }

    const uuid = await secretStore.getProxyRuntimeEntryUuid()
    if (!uuid) {
      throw new Error('Не удалось прочитать сохранённый ключ proxy. Повторяем запуск после входа в Windows.')
    }

    await setupLocalXrayRuntime({
      appDataDir: app.getPath('userData'),
      localPort: runtime.localPort,
      entryHost: runtime.entryHost,
      entryPort: runtime.entryPort,
      entryUuid: uuid,
      localProxyType: runtime.localProxyType,
      keepRunningAfterClose: settings.system.keepProxyRunningAfterClose,
      onReady,
      onProgress: (progress) => console.log(`[proxy-autostart] ${progress.status} ${progress.step}: ${progress.message}`)
    })
    await startVpnBypassMonitor()
  }

  const startStoredProxyRuntimeWithRetries = async (
    settings: AppSettings,
    onReady?: () => void,
    initialDelayMs = 0
  ): Promise<void> => {
    let lastError: unknown

    if (initialDelayMs) await new Promise<void>((resolve) => setTimeout(resolve, initialDelayMs))

    for (const delayMs of proxyAutostartRetryDelaysMs) {
      if (delayMs) await new Promise<void>((resolve) => setTimeout(resolve, delayMs))

      try {
        await startStoredProxyRuntime(settings, onReady)
        return
      } catch (error) {
        lastError = error
        void appLog.error('proxy-autostart', 'Автозапуск proxy не удался, будет повтор', error, {
          attempt: proxyAutostartRetryDelaysMs.indexOf(delayMs) + 1,
          localPort: settings.proxyRuntime.localPort
        })
      }
    }

    throw lastError
  }

  let proxyRuntimeWatchdog: ReturnType<typeof setInterval> | undefined
  let proxyRuntimeWatchdogEnabled = true
  let proxyRuntimeRecoveryRunning = false

  const recoverStoredProxyRuntime = async (): Promise<void> => {
    if (!proxyRuntimeWatchdogEnabled || proxyRuntimeRecoveryRunning) return
    proxyRuntimeRecoveryRunning = true

    try {
      const settings = await settingsStore.load()
      const runtime = settings.proxyRuntime
      if (!runtime.entryUuidConfigured || !runtime.activeStartProxyId || !runtime.entryHost || !runtime.localPort) return
      if (await isLocalXrayRuntimeRunning(runtime.localPort, app.getPath('userData'))) return

      void appLog.warn('proxy-watchdog', 'Локальный proxy пропал, перезапускаем', { localPort: runtime.localPort })
      await startStoredProxyRuntimeWithRetries(settings)
      void appLog.info('proxy-watchdog', 'Локальный proxy восстановлен', { localPort: runtime.localPort })
    } catch (error) {
      void appLog.error('proxy-watchdog', 'Не удалось восстановить локальный proxy', error)
    } finally {
      proxyRuntimeRecoveryRunning = false
    }
  }

  const startProxyRuntimeWatchdog = (): void => {
    if (proxyRuntimeWatchdog) return
    proxyRuntimeWatchdog = setInterval(() => void recoverStoredProxyRuntime(), proxyRuntimeWatchdogIntervalMs)
  }

  const stopProxyRuntimeWatchdog = (): void => {
    proxyRuntimeWatchdogEnabled = false
    if (proxyRuntimeWatchdog) clearInterval(proxyRuntimeWatchdog)
    proxyRuntimeWatchdog = undefined
  }

  const focusMainWindow = () => {
    const window = mainWindow ?? createMainWindow()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  const notifyWindowRecordingNeeded = () => {
    const window = mainWindow ?? createMainWindow()
    const send = () => window.webContents.send('recording:ensure-window')
    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', send)
    } else {
      send()
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
    },
    beforeInstall: () => stopBackgroundWorkForUpdate(),
    openManualDownload: () => shell.openExternal('https://github.com/JaysonFrost/TradeTools/releases/latest')
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
    parallelSafe: boolean
    settingsSnapshot: AppSettings
    paddingAfterSeconds?: number
    abortController: AbortController
    cancelled: boolean
    startedAtMs?: number
    progressPercent?: number
    processingMessage?: string
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
  const activeClipRenderJobs = new Map<string, ClipRenderJob>()
  const maxConcurrentClipRenders = 2

  const normalizeProtectionTime = (value?: number): number => (
    Number.isFinite(value) && (value ?? 0) > 0 ? Math.trunc(value as number) : 0
  )

  const applyWindowRecorderProtection = () => {
    const protectedTimes = [
      watcherProtectedSinceMs,
      ...[...activeClipRenderJobs.values()].map((job) => job.protectedSinceMs),
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
    const activeJobs = [...activeClipRenderJobs.values()].map((job) => {
      const startedAtMs = job.startedAtMs ?? job.queuedAtMs
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
      const baseProgress = job.progressPercent ?? 35
      const progressPercent = baseProgress > 0 && baseProgress < 95
        ? Math.min(88, Math.max(baseProgress, 35 + Math.floor(elapsedSeconds / 2)))
        : baseProgress
      const afterExitWaitSeconds = job.trade && job.paddingAfterSeconds
        ? Math.ceil((job.trade.exitTimeMs + job.paddingAfterSeconds * 1000 - Date.now()) / 1000)
        : 0
      const afterExitWaitSuffix = afterExitWaitSeconds > 0
        ? ` После выхода записываем ещё ${afterExitWaitSeconds}с: так выставлено в настройке "Секунд после выхода".`
        : ''
      const elapsedSuffix = elapsedSeconds >= 5 && progressPercent < 95 ? ` Идёт ${elapsedSeconds}с.` : ''

      return {
        id: job.id,
        title: job.title,
        message: `${job.processingMessage ?? 'Сохраняем replay и собираем клип сделки'}${afterExitWaitSuffix}${elapsedSuffix}`,
        progressPercent,
        startedAtMs
      }
    })

    if (activeJobs.length > 0) {
      const primary = activeJobs[0]!
      const progressPercent = activeJobs.reduce((sum, job) => sum + job.progressPercent, 0) / activeJobs.length
      return {
        active: true,
        title: activeJobs.length > 1 ? `Обрабатывается клипов: ${activeJobs.length}` : primary.title,
        message: queuedCount > 0
          ? `Параллельно обрабатывается ${activeJobs.length}, ожидает ${queuedCount}`
          : activeJobs.length > 1 ? `Параллельно обрабатывается ${activeJobs.length}` : primary.message,
        progressPercent,
        startedAtMs: Math.min(...activeJobs.map((job) => job.startedAtMs ?? Date.now())),
        queuedCount,
        activeJobId: primary.id,
        activeJobs,
        queuedJobs
      }
    }

    if (queuedCount > 0) {
      return {
        active: true,
        title: 'Очередь клипов',
        message: `Ждёт обработки: ${queuedCount}`,
        progressPercent: 10,
        queuedCount,
        queuedJobs
      }
    }

    return clipProcessingStatus
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

  const processClipRenderJob = async (job: ClipRenderJob): Promise<void> => {
    job.startedAtMs = Date.now()
    job.progressPercent = 35
    job.processingMessage = job.manualBuffer ? 'Сохраняем последний буфер' : 'Сохраняем replay и собираем клип сделки'
    void appLog.info('clip-queue', 'Clip render started', clipJobLogContext(job))

    try {
      const clip = job.manualBuffer
        ? await clipPipeline.createManualBufferClip({
            requestedAtMs: job.requestedAtMs,
            captureTarget: job.captureTarget,
            signal: job.abortController.signal,
            settings: job.settingsSnapshot
          })
        : await clipPipeline.createClipForClosedTrade(job.trade!, {
            captureTarget: job.captureTarget,
            signal: job.abortController.signal,
            settings: job.settingsSnapshot
          })
      job.progressPercent = 95
      job.processingMessage = 'Клип сохранён, обновляем очередь'
      setClipProcessingStatus({
        active: true,
        title: clip.title,
        message: job.processingMessage,
        progressPercent: job.progressPercent,
        startedAtMs: job.startedAtMs,
        queuedCount: clipRenderQueue.length,
        activeJobId: job.id
      })
      void appLog.info('clip-queue', 'Clip render finished', {
        ...clipJobLogContext(job),
        videoPath: clip.videoPath,
        metadataPath: clip.metadataPath
      })
      void notifyClipCreated(clip).catch((error) => {
        console.warn(`Clip notification failed: ${getErrorMessage(error)}`)
      })
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
      activeClipRenderJobs.delete(job.id)
      applyWindowRecorderProtection()
      runClipRenderQueue()
      if (activeClipRenderJobs.size === 0 && clipRenderQueue.length === 0 && clipProcessingStatus.active) {
        clearClipProcessingSoon()
      }
    }
  }

  const runClipRenderQueue = () => {
    while (activeClipRenderJobs.size < maxConcurrentClipRenders && clipRenderQueue.length > 0) {
      const nextJob = clipRenderQueue[0]
      if (!nextJob) break
      if (activeClipRenderJobs.size > 0 && (
        !nextJob.parallelSafe ||
        [...activeClipRenderJobs.values()].some((job) => !job.parallelSafe)
      )) break

      const job = clipRenderQueue.shift()
      if (!job || job.cancelled) continue

      activeClipRenderJobs.set(job.id, job)
      applyWindowRecorderProtection()
      void processClipRenderJob(job)
    }
  }

  const targetSuffix = (captureTarget?: CaptureTargetRef): string => captureTarget ? ` - ${captureTarget.name}` : ''

  const enqueueClipRender = async (
    trade: ClosedTrade,
    options: { waitForCompletion: boolean, captureTarget?: CaptureTargetRef }
  ): Promise<ClipQueueItem | void> => {
    const title = `${trade.symbol} ${trade.side}${targetSuffix(options.captureTarget)}`
    const settings = await settingsStore.load()
    const protectedSinceMs = Math.max(1, trade.entryTimeMs - settings.clip.paddingBeforeSeconds * 1000 - 5_000)
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
      id: `clip-${randomUUID()}`,
      trade,
      title,
      queuedAtMs,
      protectedSinceMs,
      parallelSafe: true,
      settingsSnapshot: settings,
      paddingAfterSeconds: settings.clip.paddingAfterSeconds,
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
      message: activeClipRenderJobs.size > 0
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
    if (recordingControlShuttingDown) throw new Error('Приложение завершает работу')
    const title = `Буфер TradeTools${targetSuffix(options.captureTarget)}`
    const protectedSinceMs = Math.max(1, options.requestedAtMs - settings.clip.replayBufferSeconds * 1000 - 5_000)
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
      id: `manual-buffer-${randomUUID()}`,
      manualBuffer: true,
      requestedAtMs: options.requestedAtMs,
      captureTarget: options.captureTarget,
      title,
      queuedAtMs,
      protectedSinceMs,
      parallelSafe: true,
      settingsSnapshot: settings,
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
      message: activeClipRenderJobs.size > 0
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

  const cancelClipRender = (jobId?: string): { ok: true, cancelledCount: number } => {
    let cancelledCount = 0
    const activeJobsToCancel = jobId
      ? [activeClipRenderJobs.get(jobId)].filter((job): job is ClipRenderJob => Boolean(job))
      : [...activeClipRenderJobs.values()]
    for (const job of activeJobsToCancel) {
      job.cancelled = true
      job.abortController.abort()
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
      const firstActiveJob = [...activeClipRenderJobs.values()].find((job) => !job.cancelled)
      setClipProcessingStatus({
        active: Boolean(firstActiveJob),
        title: firstActiveJob?.title ?? '',
        message: 'Сохранение отменено',
        progressPercent: 0,
        activeJobId: firstActiveJob?.id,
        queuedCount: clipRenderQueue.length,
        queuedJobs: clipRenderQueue.map((job) => ({ id: job.id, title: job.title }))
      })
      applyWindowRecorderProtection()
      void appLog.info('clip-queue', 'Clip render cancel requested', { jobId, cancelledCount })
    }

    return { ok: true, cancelledCount }
  }

  const waitForClipRenderIdle = async (timeoutMs = 5_000): Promise<void> => {
    const deadlineMs = Date.now() + timeoutMs
    while ((activeClipRenderJobs.size > 0 || clipRenderQueue.length > 0) && Date.now() < deadlineMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
    }
    if (activeClipRenderJobs.size > 0 || clipRenderQueue.length > 0) throw new Error('Не удалось остановить обработку клипа перед обновлением')
  }

  const selectClipRenderTargets = (settings: AppSettings, preferredTarget?: CaptureTargetRef): Array<CaptureTargetRef | undefined> => {
    if (preferredTarget) return [preferredTarget]

    const targets = configuredCaptureTargets(settings)
    if (settings.recording.sourceType === 'screen') {
      const screenTargets = targets.filter((target) => target.type === 'screen')
      return screenTargets
    }

    if (settings.recording.saveTargetMode === 'selected' && settings.recording.saveTargetId) {
      return [targets.find((target) => target.id === settings.recording.saveTargetId) ?? targets[0]]
    }

    return [targets[0]]
  }

  const selectManualBufferTargets = (settings: AppSettings): Array<CaptureTargetRef | undefined> => {
    const targets = selectClipRenderTargets(settings)
    if (settings.recording.sourceType === 'screen' && targets.length === 0) {
      throw new Error('Выберите хотя бы один монитор в настройках записи.')
    }
    return targets
  }

  let recordingBufferSavePromise: Promise<ClipQueueItem[]> | undefined
  const saveLatestRecordingBuffer = (): Promise<ClipQueueItem[]> => {
    if (recordingBufferSavePromise) return recordingBufferSavePromise

    const savePromise = recordingControlQueue.then(async () => {
      if (recordingControlShuttingDown || !recordingControlStatus.enabled) throw new Error('Фоновая запись остановлена')
      const settings = await settingsStore.load()
      if (recordingControlShuttingDown) throw new Error('Приложение завершает работу')
      const requestedAtMs = Date.now()
      const results = await Promise.allSettled(selectManualBufferTargets(settings).map((captureTarget) => enqueueManualBufferRender({
        waitForCompletion: true,
        requestedAtMs,
        captureTarget
      })))
      const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (firstFailure) throw firstFailure.reason
      return results.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : [])
    })
    recordingBufferSavePromise = savePromise
    void savePromise.finally(() => {
      if (recordingBufferSavePromise === savePromise) recordingBufferSavePromise = undefined
    }).catch(() => undefined)
    return savePromise
  }

  let recordingToggleHotkeyBusy = false
  let bufferHotkeySaving = false

  let backgroundWindowRecordingEnabled = true
  let backgroundWindowRecordingStartedAtMs = 0
  let nativeRecordingStartedAtMs = 0
  const browserRecordingStartedBySourceId = new Map<string, WindowRecordingStartedInput>()
  const knownTerminalRecordingTargetIds = new Set<string>()
  let recordingControlStatus: RecordingControlStatus = {
    enabled: true,
    operation: 'idle',
    active: false,
    protected: false,
    hotkey: recordingToggleAccelerator,
    hotkeyAvailable: true,
    bufferHotkey: recordingBufferSaveAccelerator,
    bufferHotkeyAvailable: true,
    message: 'Запускаем фоновую запись'
  }
  let recordingControlQueue = Promise.resolve(recordingControlStatus)
  let recordingControlShuttingDown = false
  let recordingGateRevision = 0
  let freeRecordingStartPending = false

  const recordingProtectionReason = async (): Promise<string | undefined> => {
    if (recordingBufferSavePromise) return 'Сохраняется буфер'
    if (freeRecordingStartPending) return 'Запускается свободная запись'
    let activeTradeCount = terminalTradeWatcher.getStatus().activeTradeCount
    if (activeTradeCount > 0) return `Идёт сделка, позиций: ${activeTradeCount}`
    const freeRecording = await windowRecorderService.getFreeRecordingStatus(await settingsStore.load())
    if (freeRecording.active) return 'Идёт свободная запись'
    if (freeRecording.exporting) return 'Сохраняется свободная запись'
    if (freeRecordingStartPending) return 'Запускается свободная запись'
    activeTradeCount = terminalTradeWatcher.getStatus().activeTradeCount
    if (activeTradeCount > 0) return `Идёт сделка, позиций: ${activeTradeCount}`
    if (watcherProtectedSinceMs > 0 || activeClipRenderJobs.size > 0 || clipRenderQueue.length > 0) return 'Сохраняется клип'
    return undefined
  }

  const broadcastRecordingControlStatus = (): RecordingControlStatus => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('recording:control-status', recordingControlStatus)
    }
    return recordingControlStatus
  }

  const updateRecordingControlStatus = (patch: Partial<RecordingControlStatus>): RecordingControlStatus => {
    recordingControlStatus = { ...recordingControlStatus, ...patch }
    mainWindow?.webContents.setBackgroundThrottling(!recordingControlStatus.enabled)
    return broadcastRecordingControlStatus()
  }

  const setBackgroundRecordingEnabled = (enabled: boolean): Promise<RecordingControlStatus> => {
    if (recordingControlShuttingDown) return Promise.resolve(recordingControlStatus)
    recordingControlQueue = recordingControlQueue.then(async () => {
      if (recordingControlShuttingDown) return recordingControlStatus
      if (recordingControlStatus.enabled === enabled && recordingControlStatus.operation === 'idle') return recordingControlStatus
      if (!enabled) {
        const protectionReason = await recordingProtectionReason()
        if (protectionReason) {
          return updateRecordingControlStatus({
            protected: true,
            protectionReason,
            operation: 'idle',
            lastError: undefined,
            message: `${protectionReason}. Остановить запись можно после завершения.`
          })
        }
      }

      const previousEnabled = recordingControlStatus.enabled
      // Close the start gate synchronously after the final protection check.
      // The watcher re-checks this transition immediately before registering a trade.
      recordingGateRevision += 1
      backgroundWindowRecordingEnabled = enabled
      updateRecordingControlStatus({
        enabled,
        operation: enabled ? 'starting' : 'stopping',
        protected: false,
        protectionReason: undefined,
        lastError: undefined,
        message: enabled ? 'Запускаем фоновую запись' : 'Останавливаем фоновую запись'
      })
      try {
        await settingsStore.update({ system: { backgroundRecordingEnabled: enabled } })
        if (!enabled) {
          nativeRecordingStartedAtMs = 0
          browserRecordingStartedBySourceId.clear()
          refreshBackgroundRecordingStartedAtMs()
          await windowRecorderService.stop()
        }
      } catch (error) {
        backgroundWindowRecordingEnabled = previousEnabled
        return updateRecordingControlStatus({
          enabled: previousEnabled,
          operation: 'idle',
          lastError: getErrorMessage(error),
          message: getErrorMessage(error)
        })
      }

      // The main renderer owns browser MediaRecorder and reacts to this broadcast.
      const settled = updateRecordingControlStatus({
        active: enabled ? recordingControlStatus.active : false,
        operation: 'idle',
        message: enabled ? 'Фоновая запись включена' : 'Фоновая запись остановлена'
      })
      if (enabled) notifyWindowRecordingNeeded()
      return settled
    }).catch((error) => updateRecordingControlStatus({
      operation: 'idle',
      lastError: getErrorMessage(error),
      message: getErrorMessage(error)
    }))
    return recordingControlQueue
  }

  const browserRecordingStartedAtMs = (target?: CaptureTargetRef): number => {
    const starts = [...browserRecordingStartedBySourceId.values()]
      .filter((started) => !target || recordingSourceMatchesTarget(started, target))
      .map((started) => started.startedAtMs)
    return starts.length > 0 ? Math.min(...starts) : 0
  }

  const refreshBackgroundRecordingStartedAtMs = (): void => {
    const browserStartedAtMs = browserRecordingStartedAtMs()
    const starts = [nativeRecordingStartedAtMs, browserStartedAtMs].filter((startedAtMs) => startedAtMs > 0)
    backgroundWindowRecordingStartedAtMs = starts.length > 0 ? Math.min(...starts) : 0
  }

  const ensureVideoRecordingReady = async (
    event: TerminalPositionEvent,
    recordingTarget?: CaptureTargetRef,
    _force = false
  ): Promise<boolean> => {
    const gateRevision = recordingGateRevision
    const settings = await settingsStore.load()
    if (gateRevision !== recordingGateRevision || recordingControlShuttingDown) return false
    if (!backgroundWindowRecordingEnabled) return false
    if (settings.recording.sourceType === 'window' && !recordingTarget) {
      notifyWindowRecordingNeeded()
      return false
    }

    const requiredStartMs = event.eventTimeMs - settings.clip.paddingBeforeSeconds * 1000
    const browserStartedAtMs = browserRecordingStartedAtMs(recordingTarget)
    if (browserStartedAtMs > 0) return browserStartedAtMs <= requiredStartMs

    const status = await windowRecorderService.getStatus(settings)
    if (gateRevision !== recordingGateRevision || !backgroundWindowRecordingEnabled || recordingControlShuttingDown) return false
    if (status.active && status.backend === 'ffmpeg' && !status.fallbackRequired) {
      return nativeRecordingStartedAtMs > 0 && nativeRecordingStartedAtMs <= requiredStartMs
    }

    notifyWindowRecordingNeeded()
    if (status.fallbackRequired) return false

    const started = await windowRecorderService.start(settings)
    if (gateRevision !== recordingGateRevision || !backgroundWindowRecordingEnabled || recordingControlShuttingDown) {
      await windowRecorderService.stop()
      return false
    }
    if (!started.active || started.fallbackRequired || started.backend !== 'ffmpeg') return false
    if (!nativeRecordingStartedAtMs) {
      nativeRecordingStartedAtMs = Date.now()
      refreshBackgroundRecordingStartedAtMs()
    }
    return nativeRecordingStartedAtMs <= requiredStartMs
  }

  const resolveTerminalRecordingTarget = async (event: TerminalPositionEvent): Promise<CaptureTargetRef | undefined> => {
    const settings = await settingsStore.load()
    if (settings.recording.sourceType === 'screen') return undefined

    const configuredTarget = selectedWindowTradeTarget(settings, event.symbol)
    if (configuredTarget) return configuredTarget

    const sources = await listWindowCaptureSources()
    const patterns = terminalWindowPatterns[event.source]
    const terminalSources = sources.filter((candidate) => (
      candidate.type === 'window' && patterns.some((pattern) => pattern.test(candidate.name))
    ))
    const selection = selectTerminalSource(event, terminalSources)
    const source = selection.source
    if (event.processId && terminalSources.length > 1 && selection.candidates.length === 0) {
      void appLog.warn('recording', 'Terminal process id and ticker did not identify a capture window; trade will wait for an exact window', {
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

    if (source) {
      const target: CaptureTargetRef = {
        ...toCaptureTargetRef(source),
        symbol: event.symbol
      }
      if (!knownTerminalRecordingTargetIds.has(target.id)) {
        knownTerminalRecordingTargetIds.add(target.id)
        notifyWindowRecordingNeeded()
      }

      return target
    }

    void appLog.warn('recording', 'Terminal capture window not found; skipping trade until its window is available', {
      source: event.source,
      symbol: event.symbol
    })
    return undefined
  }

  const queueClipForClosedTrade = async (trade: ClosedTrade): Promise<void> => {
    const settings = await settingsStore.load()
    const targets = selectClipRenderTargets(settings, trade.recordingTarget)
    await Promise.all(targets.map((target) => enqueueClipRender(
      target ? { ...trade, recordingTarget: target } : trade,
      { waitForCompletion: false, captureTarget: target }
    )))
  }

  const terminalTradeWatcher = createTerminalTradeWatcher({
    getSettings: () => settingsStore.load(),
    getRecordingStartedAtMs: () => backgroundWindowRecordingStartedAtMs,
    ensureVideoRecordingReady,
    getRecordingGateRevision: () => recordingGateRevision,
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

  const stopBackgroundWorkForUpdate = async (): Promise<void> => {
    backgroundWindowRecordingEnabled = false
    terminalTradeWatcher.stop()
    cancelClipRender()
    await Promise.all([
      windowRecorderService.stop(),
      waitForClipRenderIdle()
    ])
  }

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
  ipcMain.handle('app:show-main-window', () => focusMainWindow())
  ipcMain.handle('app:show-recording-widget', () => showRecordingWidget())
  ipcMain.handle('app:get-recording-widget-always-on-top', (event) => {
    if (event.sender !== recordingWidgetWindow?.webContents) throw new Error('Состояние закрепления доступно только виджету записи')
    return recordingWidgetWindow.isAlwaysOnTop()
  })
  ipcMain.handle('app:toggle-recording-widget-always-on-top', (event) => {
    if (event.sender !== recordingWidgetWindow?.webContents) throw new Error('Закреплением может управлять только виджет записи')
    recordingWidgetWindow.setAlwaysOnTop(!recordingWidgetWindow.isAlwaysOnTop())
    repositionRecordingWidgetWindow()
    return recordingWidgetWindow.isAlwaysOnTop()
  })
  ipcMain.handle('app:close-recording-widget', () => recordingWidgetWindow?.hide())
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
  ipcMain.handle('tmm:get-status', async () => ({ apiKeyConfigured: Boolean(await secretStore.getTmmApiKey()) }))
  ipcMain.handle('tmm:save-api-key', async (_event, apiKey: string) => {
    const value = asString(apiKey)
    if (!value) throw new Error('Укажите API-ключ TMM')
    await secretStore.setTmmApiKey(value)
    const sync = await clipPipeline.syncTmmTradeLinks()
    void appLog.info('tmm', 'TMM links synchronized after API key update', sync)
    return { apiKeyConfigured: true, sync }
  })
  ipcMain.handle('tmm:clear-api-key', async () => {
    await secretStore.clearTmmApiKey()
    return { apiKeyConfigured: false }
  })
  ipcMain.handle('settings:update', async (_event, input: SettingsUpdateInput) => {
    const expectedRecordingSourceRevision = input.expectedRecordingSourceRevision
    const patch = extractSettingsPatch(input)

    let updatedSettings = expectedRecordingSourceRevision
      ? await settingsStore.updateIf(
          patch,
          (current) => recordingSourceRevision(current.recording) === expectedRecordingSourceRevision
        )
      : await settingsStore.update(patch)
    if (patch.proxies) updatedSettings = await clearProxyRuntimeConfig()
    if (
      typeof patch.system?.backgroundRecordingEnabled === 'boolean'
      && patch.system.backgroundRecordingEnabled !== recordingControlStatus.enabled
    ) {
      updatedSettings = await settingsStore.update({
        system: { backgroundRecordingEnabled: recordingControlStatus.enabled }
      })
    }
    applyLaunchAtLogin(updatedSettings)
    applyAlwaysOnTop(updatedSettings)
    applyProxyQuitPreference(updatedSettings)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('settings:changed', updatedSettings)
    }

    void notifyProxyPaymentsDue().catch((error) => console.error('Proxy payment notification failed:', error))
    return updatedSettings
  })
  ipcMain.handle('recording:list-window-sources', async (event, forceRefresh = false) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Источники записи доступны только главному окну')
    return listWindowCaptureSources(forceRefresh === true)
  })
  ipcMain.handle('recording:list-video-encoders', async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Кодировщики доступны только главному окну')
    return listAvailableVideoEncoders()
  })
  ipcMain.handle('recording:get-control-status', async (event) => {
    if (event.sender !== mainWindow?.webContents && event.sender !== recordingWidgetWindow?.webContents) {
      throw new Error('Статус записи доступен только окнам TradeTools')
    }
    const protectionReason = await recordingProtectionReason()
    return updateRecordingControlStatus({
      protected: Boolean(protectionReason),
      protectionReason
    })
  })
  ipcMain.handle('recording:set-enabled', (event, enabled: boolean) => {
    if (event.sender !== mainWindow?.webContents && event.sender !== recordingWidgetWindow?.webContents) {
      throw new Error('Управлять записью могут только окна TradeTools')
    }
    if (typeof enabled !== 'boolean') throw new Error('Некорректное состояние записи')
    return setBackgroundRecordingEnabled(enabled)
  })
  ipcMain.handle('recording:report-status', (event, status: WindowRecorderStatus) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Статус записи принимается только от главного окна')
    if (!status || typeof status.active !== 'boolean' || typeof status.message !== 'string') {
      throw new Error('Некорректный статус записи')
    }
    if (!recordingControlStatus.enabled) return recordingControlStatus
    return updateRecordingControlStatus({
      active: status.active,
      operation: 'idle',
      lastError: status.fallbackRequired && !status.active ? status.message : undefined,
      message: status.message
    })
  })
  ipcMain.handle('recording:get-status', async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Статус движка доступен только главному окну')
    return windowRecorderService.getStatus(await settingsStore.load())
  })
  ipcMain.handle('recording:check', async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Проверить запись может только главное окно')

    const gateRevision = recordingGateRevision
    const checkStartedAtMs = Date.now()
    let settings = await settingsStore.load()
    let status = await windowRecorderService.getStatus(settings)
    if (!backgroundWindowRecordingEnabled || recordingControlShuttingDown) {
      return {
        ...status,
        active: false,
        message: 'Фоновая запись выключена. Сначала включите её.'
      }
    }
    if (gateRevision !== recordingGateRevision) {
      return { ...status, active: false, message: 'Состояние записи изменилось. Запустите проверку ещё раз.' }
    }
    if (recorderStatusHasFreshSegments(status, settings, checkStartedAtMs)) return { ...status, active: true }

    notifyWindowRecordingNeeded()
    const deadlineMs = Date.now() + Math.min(13_000, Math.max(4_000, settings.recording.segmentSeconds * 1_000 + 3_000))
    while (
      Date.now() < deadlineMs &&
      gateRevision === recordingGateRevision &&
      backgroundWindowRecordingEnabled &&
      !recordingControlShuttingDown
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, 500))
      if (gateRevision !== recordingGateRevision || !backgroundWindowRecordingEnabled || recordingControlShuttingDown) break
      settings = await settingsStore.load()
      if (gateRevision !== recordingGateRevision || !backgroundWindowRecordingEnabled || recordingControlShuttingDown) break
      status = await windowRecorderService.getStatus(settings)
      if (gateRevision !== recordingGateRevision || !backgroundWindowRecordingEnabled || recordingControlShuttingDown) break
      if (recorderStatusHasFreshSegments(status, settings, checkStartedAtMs)) return { ...status, active: true }
    }

    if (!backgroundWindowRecordingEnabled || recordingControlShuttingDown) {
      return { ...status, active: false, message: 'Фоновая запись выключена. Сначала включите её.' }
    }
    if (gateRevision !== recordingGateRevision) {
      return { ...status, active: false, message: 'Состояние записи изменилось. Запустите проверку ещё раз.' }
    }
    return {
      ...status,
      active: false,
      message: settings.recording.sourceType === 'window' && !settings.recording.windowSourceId
        ? 'Окно терминала не найдено. Откройте терминал или выберите источник записи.'
        : status.fallbackRequired || !status.active
          ? status.message || 'Запись не запустилась. Проверьте выбранный источник.'
          : 'Новый видеосегмент не появился. Проверьте выбранный источник записи.'
    }
  })
  ipcMain.handle('recording:free-status', async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Статус свободной записи доступен только главному окну')
    return windowRecorderService.getFreeRecordingStatus(await settingsStore.load())
  })
  ipcMain.handle('recording:start', async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Запустить движок может только главное окно')
    if (!backgroundWindowRecordingEnabled || recordingControlShuttingDown) return windowRecorderService.getStatus(await settingsStore.load())
    const gateRevision = recordingGateRevision
    const settings = await settingsStore.load()
    if (gateRevision !== recordingGateRevision) return windowRecorderService.getStatus(settings)
    const started = await windowRecorderService.start(settings)
    if (gateRevision !== recordingGateRevision || !backgroundWindowRecordingEnabled || recordingControlShuttingDown) {
      await windowRecorderService.stop()
      return windowRecorderService.getStatus(settings)
    }
    if (started.active && started.backend === 'ffmpeg' && !started.fallbackRequired && !nativeRecordingStartedAtMs) {
      nativeRecordingStartedAtMs = Date.now()
      refreshBackgroundRecordingStartedAtMs()
    } else {
      nativeRecordingStartedAtMs = 0
      refreshBackgroundRecordingStartedAtMs()
    }
    return started
  })
  ipcMain.handle('recording:clear-cache', async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Очистить кэш может только главное окно')
    const settings = await settingsStore.load()
    const result = await windowRecorderService.clearCache(settings)
    if (backgroundWindowRecordingEnabled) {
      nativeRecordingStartedAtMs = 0
      browserRecordingStartedBySourceId.clear()
      refreshBackgroundRecordingStartedAtMs()
      const started = await windowRecorderService.start(settings)
      if (!backgroundWindowRecordingEnabled || recordingControlShuttingDown) {
        await windowRecorderService.stop()
        return result
      }
      if (started.active && started.backend === 'ffmpeg' && !started.fallbackRequired) {
        nativeRecordingStartedAtMs = Date.now()
        refreshBackgroundRecordingStartedAtMs()
      } else {
        notifyWindowRecordingNeeded()
      }
    }
    return result
  })
  ipcMain.handle('recording:free-start', async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Свободную запись запускает только главное окно')
    if (!backgroundWindowRecordingEnabled || recordingControlShuttingDown) throw new Error('Сначала включите фоновую запись')
    freeRecordingStartPending = true
    try {
      const settings = await settingsStore.load()
      if (!backgroundWindowRecordingEnabled || recordingControlShuttingDown) throw new Error('Сначала включите фоновую запись')
      return await windowRecorderService.startFreeRecording(settings)
    } finally {
      freeRecordingStartPending = false
    }
  })
  ipcMain.handle('recording:free-pause', async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Свободной записью управляет только главное окно')
    return windowRecorderService.pauseFreeRecording(await settingsStore.load())
  })
  ipcMain.handle('recording:free-resume', async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Свободной записью управляет только главное окно')
    return windowRecorderService.resumeFreeRecording(await settingsStore.load())
  })
  ipcMain.handle('recording:free-finish', async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Свободную запись завершает только главное окно')
    const result = await windowRecorderService.finishFreeRecording(await settingsStore.load())
    await clipPipeline.addFreeRecordingToQueue(result)
    return result
  })
  ipcMain.handle('recording:stop-engine', (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Остановить движок может только главное окно')
    nativeRecordingStartedAtMs = 0
    refreshBackgroundRecordingStartedAtMs()
    return windowRecorderService.stop()
  })
  ipcMain.handle('recording:browser-started', (event, input: WindowRecordingStartedInput) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Подтвердить запись может только главное окно')
    if (!backgroundWindowRecordingEnabled) return

    const sourceId = asString(input?.sourceId)
    const sourceName = asString(input?.sourceName)
    const captureEpochId = asString(input?.captureEpochId)
    const startedAtMs = Math.trunc(Number(input?.startedAtMs))
    const processId = Math.trunc(Number(input?.processId))
    if (!sourceId || !sourceName || !captureEpochId || !Number.isFinite(startedAtMs) || startedAtMs <= 0) {
      throw new Error('Некорректное подтверждение старта записи окна')
    }

    const current = browserRecordingStartedBySourceId.get(sourceId)
    if (!current || current.captureEpochId !== captureEpochId || startedAtMs < current.startedAtMs) {
      browserRecordingStartedBySourceId.set(sourceId, {
        sourceId,
        sourceName,
        ...(Number.isFinite(processId) && processId > 0 ? { processId } : {}),
        captureEpochId,
        startedAtMs
      })
    }
    refreshBackgroundRecordingStartedAtMs()
  })
  ipcMain.handle('recording:browser-stopped', (event, input: WindowRecordingStoppedInput) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Остановку записи подтверждает только главное окно')
    const sourceId = asString(input?.sourceId)
    const captureEpochId = asString(input?.captureEpochId)
    const current = browserRecordingStartedBySourceId.get(sourceId)
    if (!sourceId || !captureEpochId || current?.captureEpochId !== captureEpochId) return
    browserRecordingStartedBySourceId.delete(sourceId)
    refreshBackgroundRecordingStartedAtMs()
  })
  ipcMain.handle('recording:append-segment', async (event, input: WindowRecordingSegmentInput) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Сегменты записи принимает только главное окно')
    return windowRecorderService.appendSegment(input, await settingsStore.load())
  })
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
    const localProxyType = asLocalProxyType(input?.localProxyType, settings.proxyRuntime.localProxyType)

    const result = await setupProxyChainOnServers({
      chain,
      appDataDir: app.getPath('userData'),
      localProxyType,
      keepRunningAfterClose: settings.system.keepProxyRunningAfterClose,
      getSshPassword: (proxyId) => secretStore.getProxyPassword(proxyId),
      onRuntimeConfigured: saveProxyRuntimeConfig,
      onProgress: (progress) => {
        event.sender.send('proxies:setup-chain-progress', progress)
      }
    })
    await startVpnBypassMonitor()
    proxyRuntimeWatchdogEnabled = true
    return result
  })
  ipcMain.handle('proxies:connect-chain', async (event, input: ProxyChainSetupRequest) => {
    const id = asString(input?.proxyId)
    if (!id) throw new Error('Некорректный ID сервера')

    const settings = await settingsStore.load()
    const runtime = settings.proxyRuntime
    const localProxyType = asLocalProxyType(input?.localProxyType, runtime.localProxyType)
    const entryUuid = runtime.activeStartProxyId === id && runtime.entryUuidConfigured
      ? await secretStore.getProxyRuntimeEntryUuid()
      : undefined
    const result = entryUuid
      ? await reconnectStoredProxyRuntime({
          appDataDir: app.getPath('userData'),
          runtime,
          entryUuid,
          localProxyType,
          keepRunningAfterClose: settings.system.keepProxyRunningAfterClose
        })
      : await setupProxyChainOnServers({
          chain: resolveProxyChain(settings, id),
          appDataDir: app.getPath('userData'),
          localProxyType,
          keepRunningAfterClose: settings.system.keepProxyRunningAfterClose,
          getSshPassword: (proxyId) => secretStore.getProxyPassword(proxyId),
          onRuntimeConfigured: saveProxyRuntimeConfig,
          onProgress: (progress) => event.sender.send('proxies:setup-chain-progress', progress)
        })
    if (entryUuid && runtime.localProxyType !== localProxyType) {
      await settingsStore.update({ proxyRuntime: { localProxyType } })
    }
    await startVpnBypassMonitor()
    proxyRuntimeWatchdogEnabled = true
    return result
  })
  ipcMain.handle('proxies:disconnect', async () => {
    proxyRuntimeWatchdogEnabled = false
    const settings = await settingsStore.load()
    await stopLocalXrayRuntime(settings.proxyRuntime.localPort, app.getPath('userData'))
    if (vpnBypassMonitor) vpnBypassMonitor.stop()
    const updatedSettings = await settingsStore.update({
      system: { keepProxyRunningAfterClose: false }
    })
    applyProxyQuitPreference(updatedSettings)
    return updatedSettings
  })
  ipcMain.handle('proxies:get-local-runtime-status', async () => {
    const settings = await settingsStore.load()
    return settings.proxyRuntime.entryUuidConfigured && settings.proxyRuntime.activeStartProxyId
      ? isLocalXrayRuntimeRunning(settings.proxyRuntime.localPort, app.getPath('userData'))
      : false
  })
  ipcMain.handle('proxies:configure-vpn-bypass', async (_event, input: ProxyVpnBypassRequest): Promise<VpnBypassRouteResult> => {
    const id = asString(input?.proxyId)
    if (!id) throw new Error('Некорректный ID сервера')

    return configureVpnBypassRoutes({
      appDataDir: app.getPath('userData')
    })
  })
  ipcMain.handle('proxies:get-vpn-bypass-status', () => vpnBypassMonitor?.getStatus() ?? idleVpnBypassStatus())
  ipcMain.handle('proxies:refresh-vpn-bypass', () => vpnBypassMonitor ? vpnBypassMonitor.refresh({ force: true }) : idleVpnBypassStatus())
  ipcMain.handle('terminal-trade:get-status', () => terminalTradeWatcher.getStatus())
  ipcMain.handle('clips:list-pending', () => clipPipeline.listPendingClips())
  ipcMain.handle('clips:get-processing-status', () => currentClipProcessingStatus())
  ipcMain.handle('clips:create-buffer', () => saveLatestRecordingBuffer())
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
  const startApp = async (): Promise<void> => {
    const settings = await settingsStore.load()
    backgroundWindowRecordingEnabled = settings.system.backgroundRecordingEnabled
    recordingControlStatus.enabled = backgroundWindowRecordingEnabled
    recordingControlStatus.message = backgroundWindowRecordingEnabled ? 'Запускаем фоновую запись' : 'Фоновая запись остановлена'
    applyLaunchAtLogin(settings)
    applyProxyQuitPreference(settings)
    createMainWindow()
    applyAlwaysOnTop(settings)
    createRecordingWidgetWindow()
    electronScreen.on('display-metrics-changed', repositionRecordingWidgetWindow)
    electronScreen.on('display-removed', repositionRecordingWidgetWindow)
    const hotkeyRegistered = globalShortcut.register(recordingToggleAccelerator, () => {
      if (recordingToggleHotkeyBusy) return
      recordingToggleHotkeyBusy = true
      void setBackgroundRecordingEnabled(!recordingControlStatus.enabled)
        .finally(() => { recordingToggleHotkeyBusy = false })
    })
    const bufferHotkeyRegistered = globalShortcut.register(recordingBufferSaveAccelerator, () => {
      if (bufferHotkeySaving) return
      bufferHotkeySaving = true
      void saveLatestRecordingBuffer()
        .catch((error) => {
          const message = getErrorMessage(error)
          void appLog.error('clip-queue', 'Buffer hotkey failed', error)
          showSystemNotification({ title: 'TradeTools', body: `Не удалось сохранить последний буфер: ${message}` })
        })
        .finally(() => { bufferHotkeySaving = false })
    })
    recordingControlStatus.hotkeyAvailable = hotkeyRegistered
    recordingControlStatus.bufferHotkeyAvailable = bufferHotkeyRegistered
    if (!hotkeyRegistered) {
      recordingControlStatus.message = 'Глобальный хоткей занят другим приложением'
    }
    if (!bufferHotkeyRegistered) {
      void appLog.warn('clip-queue', 'Buffer hotkey is unavailable', { accelerator: recordingBufferSaveAccelerator })
    }
    mainWindow?.webContents.setBackgroundThrottling(!recordingControlStatus.enabled)
    broadcastRecordingControlStatus()
    appUpdateService.startBackgroundCheck()
    terminalTradeWatcher.start()
    void secretStore.getTmmApiKey()
      .then((apiKey) => apiKey ? clipPipeline.syncTmmTradeLinks() : undefined)
      .then((sync) => sync ? appLog.info('tmm', 'TMM links synchronized on startup', sync) : undefined)
      .catch((error) => appLog.error('tmm', 'TMM startup synchronization failed', error))
    const initialProxyDelayMs = isWindowsLoginLaunch() ? windowsProxyRuntimeStartupGraceMs : 0
    void startStoredProxyRuntimeWithRetries(settings, undefined, initialProxyDelayMs)
      .then(() => {
        void appLog.info('proxy-autostart', 'Сохранённый proxy запущен', {
          windowsLoginLaunch: isWindowsLoginLaunch(),
          initialDelayMs: initialProxyDelayMs,
          localPort: settings.proxyRuntime.localPort
        })
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'неизвестная ошибка'
        console.error('Proxy runtime autostart failed:', error)
        showSystemNotification({
          title: 'TradeTools',
          body: `Локальный proxy не запустился после старта: ${message}`
        })
      })
      .finally(startProxyRuntimeWatchdog)
    let gracefulQuitStarted = false
    let gracefulQuitFinished = false
    app.on('before-quit', (event) => {
      if (gracefulQuitFinished) return
      event.preventDefault()
      if (gracefulQuitStarted) return
      gracefulQuitStarted = true
      recordingControlShuttingDown = true
      recordingGateRevision += 1
      terminalTradeWatcher.stop()
      stopProxyRuntimeWatchdog()
      globalShortcut.unregisterAll()
      if (vpnBypassMonitor) vpnBypassMonitor.stop()
      const pendingBufferSave = recordingBufferSavePromise
      cancelClipRender()
      void recordingControlQueue.catch(() => undefined).then(() => Promise.allSettled([
        pendingBufferSave?.catch(() => undefined) ?? Promise.resolve(),
        waitForClipRenderIdle(30_000),
        windowRecorderService.stop()
      ])).finally(() => {
        gracefulQuitFinished = true
        app.quit()
      })
    })
    void notifyProxyPaymentsDue().catch((error) => console.error('Proxy payment notification failed:', error))
  }
  void startApp()
  setInterval(() => void notifyProxyPaymentsDue().catch((error) => console.error('Proxy payment notification failed:', error)), proxyPaymentReminderIntervalMs)

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow()
      void settingsStore.load().then(applyAlwaysOnTop)
    }
    showRecordingWidget()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (ownsAppInstance && !keepProxyRunningAfterClose) void stopLocalXrayRuntime()
})
