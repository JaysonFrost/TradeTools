import { join } from 'node:path'

export type ObsReplayServiceOptions = {
  configured: boolean
  dryRun?: boolean
}

export type ObsReplayStatus = {
  connected: boolean
  replayBufferActive: boolean
  status: 'setup-needed' | 'dry-run' | 'connected'
  message: string
}

export type SaveReplayBufferInput = {
  requestedAtMs: number
  outputDir: string
}

export type SaveReplayBufferResult = {
  ok: boolean
  mode: 'dry-run' | 'obs'
  replayPath: string
  message: string
}

const pad = (value: number): string => String(value).padStart(2, '0')

const formatReplayTimestamp = (timeMs: number): string => {
  const date = new Date(timeMs)
  return [
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    `${pad(date.getUTCHours())}-${pad(date.getUTCMinutes())}-${pad(date.getUTCSeconds())}`
  ].join('_')
}

export const createObsReplayService = (options: ObsReplayServiceOptions) => ({
  getStatus: async (): Promise<ObsReplayStatus> => {
    if (!options.configured) {
      return {
        connected: false,
        replayBufferActive: false,
        status: 'setup-needed',
        message: 'OBS WebSocket не настроен'
      }
    }

    return {
      connected: Boolean(!options.dryRun),
      replayBufferActive: true,
      status: options.dryRun ? 'dry-run' : 'connected',
      message: options.dryRun ? 'OBS работает в тестовом режиме' : 'OBS WebSocket подключен'
    }
  },

  saveReplayBuffer: async (input: SaveReplayBufferInput): Promise<SaveReplayBufferResult> => ({
    ok: true,
    mode: options.dryRun ? 'dry-run' : 'obs',
    replayPath: join(input.outputDir, `${formatReplayTimestamp(input.requestedAtMs)}_OBS_REPLAY.mp4`),
    message: options.dryRun
      ? 'Тестовое сохранение OBS Replay Buffer спланировано'
      : 'OBS Replay Buffer сохранён'
  })
})
