import { contextBridge, ipcRenderer } from 'electron'
import type { ObsStatus, ObsTestReplayResult } from '../main/services/obs/obsService'
import type { AppSettings, SettingsUpdateInput } from '../main/services/settings/settings'
import type { ClipQueueItem } from '../main/services/trades/tradeClipPipeline'

const api = {
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version')
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    update: (patch: SettingsUpdateInput): Promise<AppSettings> => ipcRenderer.invoke('settings:update', patch)
  },
  obs: {
    getStatus: (): Promise<ObsStatus> => ipcRenderer.invoke('obs:get-status'),
    testReplaySave: (): Promise<ObsTestReplayResult> => ipcRenderer.invoke('obs:test-replay-save')
  },
  clips: {
    listPending: (): Promise<ClipQueueItem[]> => ipcRenderer.invoke('clips:list-pending'),
    createTest: (): Promise<ClipQueueItem> => ipcRenderer.invoke('clips:create-test')
  }
}

contextBridge.exposeInMainWorld('tradeClipper', api)

export type TradeClipperApi = typeof api
