export type ObsConnectionStatus = 'setup-needed' | 'disconnected' | 'connected'

export type ObsStatus = {
  connected: boolean
  replayBufferActive: boolean
  status: ObsConnectionStatus
  message: string
  checkedAtMs: number
}

export type ObsTestReplayResult = {
  ok: boolean
  message: string
  requestedAtMs: number
}

export type ObsServiceDeps = {
  now?: () => number
}

export type ObsService = {
  getStatus: () => Promise<ObsStatus>
  testReplaySave: () => Promise<ObsTestReplayResult>
}

export const createObsService = (deps: ObsServiceDeps = {}): ObsService => {
  const now = deps.now ?? (() => Date.now())

  return {
    async getStatus() {
      return {
        connected: false,
        replayBufferActive: false,
        status: 'setup-needed',
        message: 'OBS WebSocket не настроен',
        checkedAtMs: now()
      }
    },
    async testReplaySave() {
      return {
        ok: false,
        message: 'Сначала подключите OBS WebSocket и включите Replay Buffer',
        requestedAtMs: now()
      }
    }
  }
}
