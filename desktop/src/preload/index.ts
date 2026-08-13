import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { NetworkEnvironmentSnapshot } from '../main/services/proxies/networkEnvironment'
import type { VpnBypassRouteResult, VpnBypassStatus } from '../main/services/proxies/vpnBypassRoutes'
import type { AppSettings, LocalProxyType, ProxyRecord, SettingsUpdateInput } from '../main/services/settings/settings'
import type { ClearClipQueueResult, ClipProcessingStatus, ClipQueueItem, DeleteClipFileResult, DeleteClipFromQueueResult, RenameClipFileResult } from '../main/services/trades/tradeClipPipeline'
import type { TerminalTradeRecordingStatus } from '../main/services/trades/terminalTradeRecorder'
import type { AppUpdateStatus } from '../main/services/updates/appUpdateService'
import type { FreeRecordingFinishResult, FreeRecordingStatus, VideoCacheClearResult, WindowCaptureSource, WindowRecorderStatus, WindowRecordingSegmentInput, WindowRecordingStartedInput, WindowRecordingStoppedInput } from '../main/services/recording/windowRecorderService'
import type { AppLogSnapshot } from '../main/services/logging/appLogService'
import type { VideoEncoderOption } from '../main/services/video/videoEncoderDevices'
import type { RecordingControlStatus } from '../shared/recordingControl'

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
    type: LocalProxyType
    username: ''
    password: ''
    authRequired: false
  }
  diagnostics: Array<{ name: string, ok: boolean, message: string }>
  network: NetworkEnvironmentSnapshot
  configuredAtMs: number
}

export type ProxyChainConnectionResult = ProxyChainSetupResult & {
  reusedRuntime: boolean
}

export type SystemNotificationResult = {
  ok: boolean
  message: string
}

export type { RecordingControlStatus, VpnBypassRouteResult, VpnBypassStatus }

const api = {
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
    showMainWindow: (): Promise<void> => ipcRenderer.invoke('app:show-main-window'),
    showRecordingWidget: (): Promise<void> => ipcRenderer.invoke('app:show-recording-widget'),
    closeRecordingWidget: (): Promise<void> => ipcRenderer.invoke('app:close-recording-widget')
  },
  dialog: {
    selectDirectory: (defaultPath?: string): Promise<string | undefined> => ipcRenderer.invoke('dialog:select-directory', defaultPath)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    update: (patch: SettingsUpdateInput): Promise<AppSettings> => ipcRenderer.invoke('settings:update', patch),
    onChanged: (callback: (settings: AppSettings) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, settings: AppSettings) => callback(settings)
      ipcRenderer.on('settings:changed', listener)
      return () => ipcRenderer.removeListener('settings:changed', listener)
    }
  },
  tmm: {
    getStatus: (): Promise<{ apiKeyConfigured: boolean }> => ipcRenderer.invoke('tmm:get-status'),
    saveApiKey: (apiKey: string): Promise<{ apiKeyConfigured: boolean, sync?: { checkedCount: number, matchedCount: number } }> => ipcRenderer.invoke('tmm:save-api-key', apiKey),
    clearApiKey: (): Promise<{ apiKeyConfigured: boolean }> => ipcRenderer.invoke('tmm:clear-api-key')
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
  logs: {
    get: (): Promise<AppLogSnapshot> => ipcRenderer.invoke('logs:get'),
    showFile: (): Promise<void> => ipcRenderer.invoke('logs:show-file')
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
    connectChain: (input: { proxyId: string, localProxyType: LocalProxyType }): Promise<ProxyChainConnectionResult> => ipcRenderer.invoke('proxies:connect-chain', input),
    disconnect: (): Promise<AppSettings> => ipcRenderer.invoke('proxies:disconnect'),
    getLocalRuntimeStatus: (): Promise<boolean> => ipcRenderer.invoke('proxies:get-local-runtime-status'),
    setupChain: (input: { proxyId: string, localProxyType: LocalProxyType }): Promise<ProxyChainSetupResult> => ipcRenderer.invoke('proxies:setup-chain', input),
    configureVpnBypass: (input: { proxyId: string }): Promise<VpnBypassRouteResult> => ipcRenderer.invoke('proxies:configure-vpn-bypass', input),
    getVpnBypassStatus: (): Promise<VpnBypassStatus> => ipcRenderer.invoke('proxies:get-vpn-bypass-status'),
    refreshVpnBypass: (): Promise<VpnBypassStatus> => ipcRenderer.invoke('proxies:refresh-vpn-bypass'),
    onVpnBypassStatus: (callback: (status: VpnBypassStatus) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, status: VpnBypassStatus) => callback(status)
      ipcRenderer.on('proxies:vpn-bypass-status', listener)
      return () => ipcRenderer.removeListener('proxies:vpn-bypass-status', listener)
    },
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
  recording: {
    listWindowSources: (forceRefresh = false): Promise<WindowCaptureSource[]> => ipcRenderer.invoke('recording:list-window-sources', forceRefresh),
    listVideoEncoders: (): Promise<VideoEncoderOption[]> => ipcRenderer.invoke('recording:list-video-encoders'),
    getStatus: (): Promise<WindowRecorderStatus> => ipcRenderer.invoke('recording:get-status'),
    check: (): Promise<WindowRecorderStatus> => ipcRenderer.invoke('recording:check'),
    getControlStatus: (): Promise<RecordingControlStatus> => ipcRenderer.invoke('recording:get-control-status'),
    getFreeStatus: (): Promise<FreeRecordingStatus> => ipcRenderer.invoke('recording:free-status'),
    setEnabled: (enabled: boolean): Promise<RecordingControlStatus> => ipcRenderer.invoke('recording:set-enabled', enabled),
    reportStatus: (status: WindowRecorderStatus): Promise<void> => ipcRenderer.invoke('recording:report-status', status),
    start: (): Promise<WindowRecorderStatus> => ipcRenderer.invoke('recording:start'),
    startFree: (): Promise<FreeRecordingStatus> => ipcRenderer.invoke('recording:free-start'),
    pauseFree: (): Promise<FreeRecordingStatus> => ipcRenderer.invoke('recording:free-pause'),
    resumeFree: (): Promise<FreeRecordingStatus> => ipcRenderer.invoke('recording:free-resume'),
    finishFree: (): Promise<FreeRecordingFinishResult> => ipcRenderer.invoke('recording:free-finish'),
    clearCache: (): Promise<VideoCacheClearResult> => ipcRenderer.invoke('recording:clear-cache'),
    stopEngine: (): Promise<void> => ipcRenderer.invoke('recording:stop-engine'),
    browserStarted: (input: WindowRecordingStartedInput): Promise<void> => ipcRenderer.invoke('recording:browser-started', input),
    browserStopped: (input: WindowRecordingStoppedInput): Promise<void> => ipcRenderer.invoke('recording:browser-stopped', input),
    appendSegment: (input: WindowRecordingSegmentInput): Promise<WindowRecorderStatus> => ipcRenderer.invoke('recording:append-segment', input),
    onEnsureWindowRecording: (callback: () => void): (() => void) => {
      const listener = () => callback()
      ipcRenderer.on('recording:ensure-window', listener)
      return () => ipcRenderer.removeListener('recording:ensure-window', listener)
    },
    onControlStatus: (callback: (status: RecordingControlStatus) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, status: RecordingControlStatus) => callback(status)
      ipcRenderer.on('recording:control-status', listener)
      return () => ipcRenderer.removeListener('recording:control-status', listener)
    }
  },
  terminalTrade: {
    getStatus: (): Promise<TerminalTradeRecordingStatus> => ipcRenderer.invoke('terminal-trade:get-status')
  },
  clips: {
    listPending: (): Promise<ClipQueueItem[]> => ipcRenderer.invoke('clips:list-pending'),
    getProcessingStatus: (): Promise<ClipProcessingStatus> => ipcRenderer.invoke('clips:get-processing-status'),
    createTest: (): Promise<ClipQueueItem> => ipcRenderer.invoke('clips:create-test'),
    createBuffer: (): Promise<ClipQueueItem[]> => ipcRenderer.invoke('clips:create-buffer'),
    cancelRender: (jobId?: string): Promise<{ ok: true, cancelledCount: number }> => ipcRenderer.invoke('clips:cancel-render', jobId),
    clearQueue: (): Promise<ClearClipQueueResult> => ipcRenderer.invoke('clips:clear-queue'),
    deleteQueueFiles: (): Promise<ClearClipQueueResult> => ipcRenderer.invoke('clips:delete-queue-files'),
    renameFile: (input: { metadataPath: string, fileName: string }): Promise<RenameClipFileResult> => ipcRenderer.invoke('clips:rename-file', input),
    deleteFromQueue: (metadataPath: string): Promise<DeleteClipFromQueueResult> => ipcRenderer.invoke('clips:delete-from-queue', metadataPath),
    deleteFile: (metadataPath: string): Promise<DeleteClipFileResult> => ipcRenderer.invoke('clips:delete-file', metadataPath),
    openPreview: (videoPath: string): Promise<void> => ipcRenderer.invoke('clips:open-preview', videoPath),
    showInFolder: (videoPath: string): Promise<void> => ipcRenderer.invoke('clips:show-in-folder', videoPath),
    openOutputFolder: (): Promise<void> => ipcRenderer.invoke('clips:open-output-folder')
  }
}

contextBridge.exposeInMainWorld('tradeTools', api)

export type TradeToolsApi = typeof api
