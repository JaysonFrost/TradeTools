import { contextBridge, ipcRenderer } from 'electron'
import type { BinanceFuturesConnectionStatus } from '../main/services/exchanges/binanceFuturesClient'
import type { BinanceFuturesWatchStatus } from '../main/services/exchanges/binanceFuturesClipWatcher'
import type { ObsStatus, ObsTestReplayResult } from '../main/services/obs/obsService'
import type { AppSettings, SettingsUpdateInput } from '../main/services/settings/settings'
import type { ClipQueueItem, DeleteClipFromQueueResult } from '../main/services/trades/tradeClipPipeline'

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
  obs: {
    getStatus: (): Promise<ObsStatus> => ipcRenderer.invoke('obs:get-status'),
    testReplaySave: (): Promise<ObsTestReplayResult> => ipcRenderer.invoke('obs:test-replay-save')
  },
  binance: {
    testFuturesConnection: (): Promise<BinanceFuturesConnectionStatus> => ipcRenderer.invoke('binance:test-futures-connection'),
    getWatchStatus: (): Promise<BinanceFuturesWatchStatus> => ipcRenderer.invoke('binance:get-watch-status')
  },
  clips: {
    listPending: (): Promise<ClipQueueItem[]> => ipcRenderer.invoke('clips:list-pending'),
    createTest: (): Promise<ClipQueueItem> => ipcRenderer.invoke('clips:create-test'),
    deleteFromQueue: (metadataPath: string): Promise<DeleteClipFromQueueResult> => ipcRenderer.invoke('clips:delete-from-queue', metadataPath),
    openPreview: (videoPath: string): Promise<void> => ipcRenderer.invoke('clips:open-preview', videoPath),
    showInFolder: (videoPath: string): Promise<void> => ipcRenderer.invoke('clips:show-in-folder', videoPath)
  }
}

contextBridge.exposeInMainWorld('tradeCut', api)

export type TradeCutApi = typeof api
