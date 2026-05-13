import { contextBridge, ipcRenderer } from 'electron'

const api = {
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version')
  }
}

contextBridge.exposeInMainWorld('tradeClipper', api)

export type TradeClipperApi = typeof api
