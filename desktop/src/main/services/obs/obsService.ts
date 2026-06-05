import OBSWebSocket from 'obs-websocket-js'
import type { AppSettings } from '../settings/settings'
import { snapshotReplayFiles, waitForNewestReplayFile, type ReplayFileSnapshot, type ReplayFileWaitInput } from '../video/replayFileFinder'

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
  replayPath?: string
}

export type ObsClient = {
  connect: (url: string, password?: string) => Promise<unknown>
  call: (requestType: string) => Promise<unknown>
  disconnect: () => Promise<unknown>
  on?: (eventName: 'ReplayBufferSaved', listener: (event: unknown) => void) => unknown
  off?: (eventName: 'ReplayBufferSaved', listener: (event: unknown) => void) => unknown
  removeListener?: (eventName: 'ReplayBufferSaved', listener: (event: unknown) => void) => unknown
}

export type ObsServiceDeps = {
  now?: () => number
  getSettings?: () => Promise<AppSettings>
  getPassword?: () => Promise<string | undefined>
  createClient?: () => ObsClient
  waitForReplayFile?: (input: ReplayFileWaitInput) => Promise<string | undefined>
}

export type ObsService = {
  getStatus: () => Promise<ObsStatus>
  ensureReplayBufferActive: () => Promise<ObsStatus>
  testReplaySave: () => Promise<ObsTestReplayResult>
}

type ReplayBufferStatusResponse = {
  outputActive?: boolean
}

type LastReplayBufferReplayResponse = {
  savedReplayPath?: string
}

type ReplayPathSource = {
  promise: Promise<string | undefined>
  cancel?: () => void
}

const isReplayBufferStatusResponse = (value: unknown): value is ReplayBufferStatusResponse => {
  return typeof value === 'object' && value !== null && 'outputActive' in value
}

const isLastReplayBufferReplayResponse = (value: unknown): value is LastReplayBufferReplayResponse => {
  return typeof value === 'object' && value !== null && 'savedReplayPath' in value
}

const savedReplayPathFromEvent = (value: unknown): string | undefined => {
  if (!isLastReplayBufferReplayResponse(value)) return undefined
  return typeof value.savedReplayPath === 'string' && value.savedReplayPath.trim().length > 0
    ? value.savedReplayPath
    : undefined
}

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return 'неизвестная ошибка'
}

const createDefaultClient = (): ObsClient => new OBSWebSocket() as ObsClient
const replaySaveTimeoutMs = 30_000

export const createObsService = (deps: ObsServiceDeps = {}): ObsService => {
  const now = deps.now ?? (() => Date.now())
  const createClient = deps.createClient ?? createDefaultClient
  const waitForReplayFile = deps.waitForReplayFile ?? waitForNewestReplayFile

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

  const ensureReplayBufferActiveForClient = async (client: ObsClient): Promise<boolean> => {
    if (await getReplayBufferActive(client)) return false

    await client.call('StartReplayBuffer')
    if (!await getReplayBufferActive(client)) {
      throw new Error('Replay Buffer не запустился')
    }

    return true
  }

  const getLastReplayBufferReplayPath = async (client: ObsClient): Promise<string | undefined> => {
    try {
      const response = await client.call('GetLastReplayBufferReplay')
      return savedReplayPathFromEvent(response)
    } catch {
      return undefined
    }
  }

  const createReplayBufferSavedEventSource = (client: ObsClient, timeoutMs: number): ReplayPathSource => {
    if (!client.on) return { promise: Promise.resolve(undefined) }

    let listener: (event: unknown) => void = () => undefined
    let timer: NodeJS.Timeout | undefined
    let settled = false
    let settle: (path: string | undefined) => void = () => undefined

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      client.off?.('ReplayBufferSaved', listener)
      client.removeListener?.('ReplayBufferSaved', listener)
    }
    const promise = new Promise<string | undefined>((resolve) => {
      settle = (path) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(path)
      }
      listener = (event) => {
        const replayPath = savedReplayPathFromEvent(event)
        if (replayPath) settle(replayPath)
      }
      client.on?.('ReplayBufferSaved', listener)
      timer = setTimeout(() => settle(undefined), timeoutMs)
    })

    return {
      promise,
      cancel: () => settle(undefined)
    }
  }

  const waitForFirstReplayPath = async (sources: ReplayPathSource[]): Promise<string | undefined> => {
    const pendingSources = new Set(sources)

    try {
      while (pendingSources.size > 0) {
        const result = await Promise.race([...pendingSources].map((source) => source.promise
          .then((path) => ({ source, path }))
          .catch(() => ({ source, path: undefined }))))
        pendingSources.delete(result.source)
        if (result.path) return result.path
      }

      return undefined
    } finally {
      for (const source of sources) source.cancel?.()
    }
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
    async ensureReplayBufferActive() {
      const checkedAtMs = now()

      try {
        const started = await withClient((client) => ensureReplayBufferActiveForClient(client))

        return {
          connected: true,
          replayBufferActive: true,
          status: 'connected',
          message: started ? 'OBS Replay Buffer запущен автоматически' : 'OBS Replay Buffer уже активен',
          checkedAtMs
        }
      } catch (error) {
        const message = errorMessage(error)
        const setupNeeded = message === 'OBS WebSocket не настроен'

        return {
          connected: false,
          replayBufferActive: false,
          status: setupNeeded ? 'setup-needed' : 'disconnected',
          message: setupNeeded ? message : `OBS Replay Buffer не запущен: ${message}`,
          checkedAtMs
        }
      }
    },
    async testReplaySave() {
      const requestedAtMs = now()
      const settings = await deps.getSettings?.()
      let preferredPath: string | undefined
      let previousSnapshot: ReplayFileSnapshot | undefined
      let replayPath: string | undefined

      if (settings) {
        previousSnapshot = await snapshotReplayFiles(settings.clip.replaySourceDir).catch(() => undefined)
      }

      try {
        await withClient(async (client) => {
          await ensureReplayBufferActiveForClient(client)
          const eventSource = createReplayBufferSavedEventSource(client, replaySaveTimeoutMs)
          await client.call('SaveReplayBuffer')
          preferredPath = await getLastReplayBufferReplayPath(client)

          if (settings) {
            const replayFileSearchAbortController = new AbortController()
            replayPath = await waitForFirstReplayPath([
              eventSource,
              {
                promise: waitForReplayFile({
                  directory: settings.clip.replaySourceDir,
                  afterMs: requestedAtMs,
                  preferredPath,
                  previousSnapshot,
                  timeoutMs: replaySaveTimeoutMs,
                  signal: replayFileSearchAbortController.signal
                }),
                cancel: () => replayFileSearchAbortController.abort()
              }
            ])
            return
          }

          replayPath = preferredPath ?? await eventSource.promise
        })
        replayPath = replayPath ?? preferredPath

        if (settings) {
          if (!replayPath) {
            return {
              ok: false,
              message: `OBS сохранил Replay Buffer, но свежий replay-файл не найден в папке: ${settings.clip.replaySourceDir}. TradeCut ждёт до ${Math.round(replaySaveTimeoutMs / 1000)}с и ищет видео в подпапках. Проверьте, что OBS действительно создаёт новый replay-файл в этой папке.`,
              requestedAtMs
            }
          }
        }

        return {
          ok: true,
          message: settings ? 'OBS Replay Buffer сохранён, свежий файл найден' : 'OBS Replay Buffer сохранён',
          requestedAtMs,
          replayPath
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
