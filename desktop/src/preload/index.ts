import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ObsStatus, ObsTestReplayResult } from '../main/services/obs/obsService'
import type { NetworkEnvironmentSnapshot } from '../main/services/proxies/networkEnvironment'
import type { VpnBypassRouteResult } from '../main/services/proxies/vpnBypassRoutes'
import type { AppSettings, ProxyRecord, SettingsUpdateInput } from '../main/services/settings/settings'
import type { ClipProcessingStatus, ClipQueueItem, DeleteClipFromQueueResult, RenameClipFileResult } from '../main/services/trades/tradeClipPipeline'
import type { TerminalTradeRecordingStatus } from '../main/services/trades/terminalTradeRecorder'
import type { AppUpdateStatus } from '../main/services/updates/appUpdateService'
import type { FreeRecordingFinishResult, FreeRecordingStatus, WindowCaptureSource, WindowRecorderStatus, WindowRecordingSegmentInput } from '../main/services/recording/windowRecorderService'

export type ProxySaveInput = {
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

export type ProxySshCheckResult = {
  ok: boolean
  host: string
  port: number
  login: string
  message: string
  serverInfo?: string
}

export type ProxyChainInstructionResult = {
  chain: Array<Pick<ProxyRecord, 'id' | 'name' | 'server' | 'login' | 'passwordConfigured'>>
  sshChecks: ProxySshCheckResult[]
  network: NetworkEnvironmentSnapshot
  route: string
  terminal: string[]
}

export type ProxyChainSetupProgress = {
  proxyId?: string
  proxyName?: string
  step: string
  status: 'running' | 'success' | 'error' | 'info'
  message: string
  timestampMs: number
}

export type ProxyChainSetupResult = {
  ok: true
  route: string
  entryProxy: {
    host: '127.0.0.1'
    port: number
    type: 'HTTP'
    username: ''
    password: ''
    authRequired: false
  }
  diagnostics: Array<{ name: string, ok: boolean, message: string }>
  network: NetworkEnvironmentSnapshot
  configuredAtMs: number
}

export type SystemNotificationResult = {
  ok: boolean
  message: string
}

export type { VpnBypassRouteResult }

const api = {
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version')
  },
  dialog: {
    selectDirectory: (defaultPath?: string): Promise<string | undefined> => ipcRenderer.invoke('dialog:select-directory', defaultPath)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    update: (patch: SettingsUpdateInput): Promise<AppSettings> => ipcRenderer.invoke('settings:update', patch)
  },
  clipboard: {
    writeText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write-text', text)
  },
  links: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('links:open-external', url)
  },
  notifications: {
    test: (): Promise<SystemNotificationResult> => ipcRenderer.invoke('notifications:test')
  },
  updates: {
    getStatus: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('updates:get-status'),
    check: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('updates:check'),
    download: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('updates:download'),
    install: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('updates:install'),
    onStatus: (callback: (status: AppUpdateStatus) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, status: AppUpdateStatus) => callback(status)
      ipcRenderer.on('updates:status', listener)
      return () => ipcRenderer.removeListener('updates:status', listener)
    }
  },
  proxies: {
    save: (input: ProxySaveInput): Promise<AppSettings> => ipcRenderer.invoke('proxies:save', input),
    delete: (proxyId: string): Promise<AppSettings> => ipcRenderer.invoke('proxies:delete', proxyId),
    copyPassword: (proxyId: string): Promise<void> => ipcRenderer.invoke('proxies:copy-password', proxyId),
    openDashboard: (proxyId: string): Promise<void> => ipcRenderer.invoke('proxies:open-dashboard', proxyId),
    configureChain: (proxyId: string): Promise<ProxyChainInstructionResult> => ipcRenderer.invoke('proxies:configure-chain', proxyId),
    setupChain: (input: { proxyId: string }): Promise<ProxyChainSetupResult> => ipcRenderer.invoke('proxies:setup-chain', input),
    configureVpnBypass: (input: { proxyId: string }): Promise<VpnBypassRouteResult> => ipcRenderer.invoke('proxies:configure-vpn-bypass', input),
    onConfigureChainProgress: (callback: (progress: ProxyChainSetupProgress) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, progress: ProxyChainSetupProgress) => callback(progress)
      ipcRenderer.on('proxies:configure-chain-progress', listener)
      return () => ipcRenderer.removeListener('proxies:configure-chain-progress', listener)
    },
    onSetupChainProgress: (callback: (progress: ProxyChainSetupProgress) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, progress: ProxyChainSetupProgress) => callback(progress)
      ipcRenderer.on('proxies:setup-chain-progress', listener)
      return () => ipcRenderer.removeListener('proxies:setup-chain-progress', listener)
    }
  },
  obs: {
    getStatus: (): Promise<ObsStatus> => ipcRenderer.invoke('obs:get-status'),
    testReplaySave: (): Promise<ObsTestReplayResult> => ipcRenderer.invoke('obs:test-replay-save')
  },
  recording: {
    listWindowSources: (): Promise<WindowCaptureSource[]> => ipcRenderer.invoke('recording:list-window-sources'),
    getStatus: (): Promise<WindowRecorderStatus> => ipcRenderer.invoke('recording:get-status'),
    getFreeStatus: (): Promise<FreeRecordingStatus> => ipcRenderer.invoke('recording:free-status'),
    start: (): Promise<WindowRecorderStatus> => ipcRenderer.invoke('recording:start'),
    startFree: (): Promise<FreeRecordingStatus> => ipcRenderer.invoke('recording:free-start'),
    pauseFree: (): Promise<FreeRecordingStatus> => ipcRenderer.invoke('recording:free-pause'),
    resumeFree: (): Promise<FreeRecordingStatus> => ipcRenderer.invoke('recording:free-resume'),
    finishFree: (): Promise<FreeRecordingFinishResult> => ipcRenderer.invoke('recording:free-finish'),
    stop: (): Promise<void> => ipcRenderer.invoke('recording:stop'),
    appendSegment: (input: WindowRecordingSegmentInput): Promise<WindowRecorderStatus> => ipcRenderer.invoke('recording:append-segment', input)
  },
  terminalTrade: {
    getStatus: (): Promise<TerminalTradeRecordingStatus> => ipcRenderer.invoke('terminal-trade:get-status')
  },
  clips: {
    listPending: (): Promise<ClipQueueItem[]> => ipcRenderer.invoke('clips:list-pending'),
    getProcessingStatus: (): Promise<ClipProcessingStatus> => ipcRenderer.invoke('clips:get-processing-status'),
    createTest: (): Promise<ClipQueueItem> => ipcRenderer.invoke('clips:create-test'),
    renameFile: (input: { metadataPath: string, fileName: string }): Promise<RenameClipFileResult> => ipcRenderer.invoke('clips:rename-file', input),
    deleteFromQueue: (metadataPath: string): Promise<DeleteClipFromQueueResult> => ipcRenderer.invoke('clips:delete-from-queue', metadataPath),
    openPreview: (videoPath: string): Promise<void> => ipcRenderer.invoke('clips:open-preview', videoPath),
    showInFolder: (videoPath: string): Promise<void> => ipcRenderer.invoke('clips:show-in-folder', videoPath)
  }
}

contextBridge.exposeInMainWorld('tradeTools', api)

export type TradeToolsApi = typeof api
