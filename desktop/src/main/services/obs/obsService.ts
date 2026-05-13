import OBSWebSocket from 'obs-websocket-js'
import type { AppSettings } from '../settings/settings'

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

export type ObsClient = {
  connect: (url: string, password?: string) => Promise<unknown>
  call: (requestType: string) => Promise<unknown>
  disconnect: () => Promise<unknown>
}

export type ObsServiceDeps = {
  now?: () => number
  getSettings?: () => Promise<AppSettings>
  getPassword?: () => Promise<string | undefined>
  createClient?: () => ObsClient
}

export type ObsService = {
  getStatus: () => Promise<ObsStatus>
  testReplaySave: () => Promise<ObsTestReplayResult>
}

type ReplayBufferStatusResponse = {
  outputActive?: boolean
}

const isReplayBufferStatusResponse = (value: unknown): value is ReplayBufferStatusResponse => {
  return typeof value === 'object' && value !== null && 'outputActive' in value
}

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return 'неизвестная ошибка'
}

const createDefaultClient = (): ObsClient => new OBSWebSocket() as ObsClient

export const createObsService = (deps: ObsServiceDeps = {}): ObsService => {
  const now = deps.now ?? (() => Date.now())
  const createClient = deps.createClient ?? createDefaultClient

  const getConfiguredConnection = async () => {
    const settings = await deps.getSettings?.()
    if (!settings?.obs.passwordConfigured) return undefined

    return {
      url: `ws://${settings.obs.host}:${settings.obs.port}`,
      password: await deps.getPassword?.()
    }
  }

  const withClient = async <T>(operation: (client: ObsClient) => Promise<T>): Promise<T> => {
    const connection = await getConfiguredConnection()
    if (!connection) throw new Error('OBS WebSocket не настроен')

    const client = createClient()
    try {
      await client.connect(connection.url, connection.password)
      return await operation(client)
    } finally {
      await client.disconnect().catch(() => undefined)
    }
  }

  const getReplayBufferActive = async (client: ObsClient): Promise<boolean> => {
    const response = await client.call('GetReplayBufferStatus')
    return isReplayBufferStatusResponse(response) ? response.outputActive === true : false
  }

  return {
    async getStatus() {
      const checkedAtMs = now()

      try {
        const replayBufferActive = await withClient(getReplayBufferActive)

        return {
          connected: true,
          replayBufferActive,
          status: 'connected',
          message: replayBufferActive ? 'OBS WebSocket подключен, Replay Buffer активен' : 'OBS WebSocket подключен, Replay Buffer выключен',
          checkedAtMs
        }
      } catch (error) {
        const message = errorMessage(error)
        const setupNeeded = message === 'OBS WebSocket не настроен'

        return {
          connected: false,
          replayBufferActive: false,
          status: setupNeeded ? 'setup-needed' : 'disconnected',
          message: setupNeeded ? message : `OBS недоступен: ${message}`,
          checkedAtMs
        }
      }
    },
    async testReplaySave() {
      const requestedAtMs = now()

      try {
        await withClient(async (client) => {
          const replayBufferActive = await getReplayBufferActive(client)
          if (!replayBufferActive) throw new Error('Replay Buffer выключен')
          await client.call('SaveReplayBuffer')
        })

        return {
          ok: true,
          message: 'OBS Replay Buffer сохранён',
          requestedAtMs
        }
      } catch (error) {
        const message = errorMessage(error)
        const userMessage = message === 'OBS WebSocket не настроен'
          ? 'Сначала подключите OBS WebSocket и включите Replay Buffer'
          : `Не удалось сохранить OBS Replay Buffer: ${message}`

        return {
          ok: false,
          message: userMessage,
          requestedAtMs
        }
      }
    }
  }
}
