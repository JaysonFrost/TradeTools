import { describe, expect, it, vi } from 'vitest'
import { createObsService, type ObsClient } from '../../src/main/services/obs/obsService'
import { createDefaultSettings } from '../../src/main/services/settings/settings'

const configuredSettings = () => ({
  ...createDefaultSettings('/tmp/trade-clipper'),
  obs: {
    host: '127.0.0.1',
    port: 4455,
    passwordConfigured: true
  }
})

const createFakeClient = (replayBufferActive: boolean): ObsClient => ({
  connect: vi.fn().mockResolvedValue(undefined),
  call: vi.fn().mockResolvedValue({ outputActive: replayBufferActive }),
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
    const client = createFakeClient(true)
    const service = createObsService({
      now: () => 2000,
      getSettings: async () => configuredSettings(),
      getPassword: async () => 'secret',
      createClient: () => client
    })

    await expect(service.testReplaySave()).resolves.toEqual({
      ok: true,
      message: 'OBS Replay Buffer сохранён',
      requestedAtMs: 2000
    })
    expect(client.call).toHaveBeenCalledWith('GetReplayBufferStatus')
    expect(client.call).toHaveBeenCalledWith('SaveReplayBuffer')
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
