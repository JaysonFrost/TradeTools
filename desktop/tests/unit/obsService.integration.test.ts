import { describe, expect, it, vi } from 'vitest'
import { createObsService, type ObsClient } from '../../src/main/services/obs/obsService'
import { createDefaultSettings } from '../../src/main/services/settings/settings'

const configuredSettings = () => ({
  ...createDefaultSettings('/tmp/tradecut'),
  obs: {
    host: '127.0.0.1',
    port: 4455,
    passwordConfigured: true
  }
})

const createFakeClient = (replayBufferActive: boolean, replayPath?: string): ObsClient => ({
  connect: vi.fn().mockResolvedValue(undefined),
  call: vi.fn(async (requestType: string) => {
    if (requestType === 'GetReplayBufferStatus') return { outputActive: replayBufferActive }
    if (requestType === 'GetLastReplayBufferReplay') return { savedReplayPath: replayPath }
    return undefined
  }),
  disconnect: vi.fn().mockResolvedValue(undefined)
})

describe('obsService real websocket boundary', () => {
  it('connects to OBS and reports replay buffer as connected when configured', async () => {
    const client = createFakeClient(true)
    const service = createObsService({
      now: () => 1000,
      getSettings: async () => configuredSettings(),
      getPassword: async () => 'secret',
      createClient: () => client
    })

    await expect(service.getStatus()).resolves.toEqual({
      connected: true,
      replayBufferActive: true,
      status: 'connected',
      message: 'OBS WebSocket подключен, Replay Buffer активен',
      checkedAtMs: 1000
    })
    expect(client.connect).toHaveBeenCalledWith('ws://127.0.0.1:4455', 'secret')
    expect(client.call).toHaveBeenCalledWith('GetReplayBufferStatus')
    expect(client.disconnect).toHaveBeenCalled()
  })

  it('requests SaveReplayBuffer through OBS when replay buffer is active', async () => {
    const client = createFakeClient(true, '/tmp/tradecut/obs-replays/replay.mp4')
    const waitForReplayFile = vi.fn().mockResolvedValue('/tmp/tradecut/obs-replays/replay.mp4')
    const service = createObsService({
      now: () => 2000,
      getSettings: async () => configuredSettings(),
      getPassword: async () => 'secret',
      createClient: () => client,
      waitForReplayFile
    })

    await expect(service.testReplaySave()).resolves.toEqual({
      ok: true,
      message: 'OBS Replay Buffer сохранён, свежий файл найден',
      requestedAtMs: 2000,
      replayPath: '/tmp/tradecut/obs-replays/replay.mp4'
    })
    expect(client.call).toHaveBeenCalledWith('GetReplayBufferStatus')
    expect(client.call).toHaveBeenCalledWith('SaveReplayBuffer')
    expect(client.call).toHaveBeenCalledWith('GetLastReplayBufferReplay')
    expect(waitForReplayFile).toHaveBeenCalledWith(expect.objectContaining({
      directory: '/tmp/tradecut/obs-replays',
      afterMs: 2000,
      preferredPath: '/tmp/tradecut/obs-replays/replay.mp4',
      previousSnapshot: undefined,
      timeoutMs: 30000
    }))
  })

  it('starts OBS Replay Buffer automatically before saving when it is inactive', async () => {
    let replayBufferActive = false
    const client: ObsClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      call: vi.fn(async (requestType: string) => {
        if (requestType === 'GetReplayBufferStatus') return { outputActive: replayBufferActive }
        if (requestType === 'StartReplayBuffer') {
          replayBufferActive = true
          return undefined
        }
        if (requestType === 'GetLastReplayBufferReplay') return { savedReplayPath: '/tmp/tradecut/obs-replays/replay.mp4' }
        return undefined
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    }
    const waitForReplayFile = vi.fn().mockResolvedValue('/tmp/tradecut/obs-replays/replay.mp4')
    const service = createObsService({
      now: () => 2100,
      getSettings: async () => configuredSettings(),
      getPassword: async () => 'secret',
      createClient: () => client,
      waitForReplayFile
    })

    await expect(service.testReplaySave()).resolves.toEqual({
      ok: true,
      message: 'OBS Replay Buffer сохранён, свежий файл найден',
      requestedAtMs: 2100,
      replayPath: '/tmp/tradecut/obs-replays/replay.mp4'
    })
    expect(client.call).toHaveBeenCalledWith('StartReplayBuffer')
    expect(client.call).toHaveBeenCalledWith('SaveReplayBuffer')
  })

  it('can start OBS Replay Buffer without saving a replay file', async () => {
    let replayBufferActive = false
    const client: ObsClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      call: vi.fn(async (requestType: string) => {
        if (requestType === 'GetReplayBufferStatus') return { outputActive: replayBufferActive }
        if (requestType === 'StartReplayBuffer') {
          replayBufferActive = true
          return undefined
        }
        return undefined
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    }
    const service = createObsService({
      now: () => 2200,
      getSettings: async () => configuredSettings(),
      getPassword: async () => 'secret',
      createClient: () => client
    })

    await expect(service.ensureReplayBufferActive()).resolves.toEqual({
      connected: true,
      replayBufferActive: true,
      status: 'connected',
      message: 'OBS Replay Buffer запущен автоматически',
      checkedAtMs: 2200
    })
    expect(client.call).toHaveBeenCalledWith('StartReplayBuffer')
    expect(client.call).not.toHaveBeenCalledWith('SaveReplayBuffer')
  })

  it('reports the replay folder mismatch when OBS saved but no fresh file appears', async () => {
    const client = createFakeClient(true)
    const service = createObsService({
      now: () => 2500,
      getSettings: async () => configuredSettings(),
      getPassword: async () => 'secret',
      createClient: () => client,
      waitForReplayFile: vi.fn().mockResolvedValue(undefined)
    })

    await expect(service.testReplaySave()).resolves.toEqual({
      ok: false,
      message: 'OBS сохранил Replay Buffer, но свежий replay-файл не найден в папке: /tmp/tradecut/obs-replays. TradeCut ждёт до 30с и ищет видео в подпапках. Проверьте, что OBS действительно создаёт новый replay-файл в этой папке.',
      requestedAtMs: 2500
    })
  })

  it('returns a Russian error instead of throwing when OBS connection fails', async () => {
    const client: ObsClient = {
      connect: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      call: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined)
    }
    const service = createObsService({
      now: () => 3000,
      getSettings: async () => configuredSettings(),
      getPassword: async () => 'secret',
      createClient: () => client
    })

    await expect(service.getStatus()).resolves.toEqual({
      connected: false,
      replayBufferActive: false,
      status: 'disconnected',
      message: 'OBS недоступен: ECONNREFUSED',
      checkedAtMs: 3000
    })
  })
})
