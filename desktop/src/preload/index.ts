import { contextBridge, ipcRenderer } from 'electron'
import type { ObsStatus, ObsTestReplayResult } from '../main/services/obs/obsService'
import type { AppSettings } from '../main/services/settings/settings'

const api = {
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version')
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get')
  },
  obs: {
    getStatus: (): Promise<ObsStatus> => ipcRenderer.invoke('obs:get-status'),
    testReplaySave: (): Promise<ObsTestReplayResult> => ipcRenderer.invoke('obs:test-replay-save')
  }
}

contextBridge.exposeInMainWorld('tradeClipper', api)

export type TradeClipperApi = typeof api
