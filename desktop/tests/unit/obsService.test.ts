import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultSettings } from '../../src/main/services/settings/settings'
import { createObsService, type ObsClient } from '../../src/main/services/obs/obsService'

describe('obsService', () => {
  it('reports disconnected setup-needed status before websocket credentials are configured', async () => {
    const service = createObsService({ now: () => Date.parse('2026-05-13T04:00:00.000Z') })

    await expect(service.getStatus()).resolves.toEqual({
      connected: false,
      replayBufferActive: false,
      status: 'setup-needed',
      message: 'OBS WebSocket не настроен',
      checkedAtMs: Date.parse('2026-05-13T04:00:00.000Z')
    })
  })

  it('plans a test replay save without pretending OBS is connected', async () => {
    const service = createObsService({ now: () => Date.parse('2026-05-13T04:00:00.000Z') })

    await expect(service.testReplaySave()).resolves.toEqual({
      ok: false,
      message: 'Сначала подключите OBS WebSocket и включите Replay Buffer',
      requestedAtMs: Date.parse('2026-05-13T04:00:00.000Z')
    })
  })

  it('uses the OBS ReplayBufferSaved event path when folder scanning does not find the replay', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'tradecut-obs-service-data-'))
    const configuredReplayDir = await mkdtemp(join(tmpdir(), 'tradecut-configured-replays-'))
    const actualReplayDir = await mkdtemp(join(tmpdir(), 'tradecut-actual-replays-'))
    const actualReplayPath = join(actualReplayDir, 'Replay 2026-05-13 04-05-00.mp4')
    const listeners = new Map<string, Array<(event: unknown) => void>>()
    const emit = (eventName: string, event: unknown) => {
      for (const listener of listeners.get(eventName) ?? []) listener(event)
    }
    const client: ObsClient = {
      connect: vi.fn(async () => undefined),
      call: vi.fn(async (requestType) => {
        if (requestType === 'GetReplayBufferStatus') return { outputActive: true }
        if (requestType === 'SaveReplayBuffer') {
          queueMicrotask(async () => {
            await writeFile(actualReplayPath, 'saved replay')
            emit('ReplayBufferSaved', { savedReplayPath: actualReplayPath })
          })
        }
        if (requestType === 'GetLastReplayBufferReplay') return {}
        return undefined
      }),
      disconnect: vi.fn(async () => undefined),
      on: (eventName, listener) => {
        listeners.set(eventName, [...(listeners.get(eventName) ?? []), listener])
      },
      off: (eventName, listener) => {
        listeners.set(eventName, (listeners.get(eventName) ?? []).filter((candidate) => candidate !== listener))
      }
    }
    const requestedAtMs = Date.parse('2026-05-13T04:05:00.000Z')
    const service = createObsService({
      now: () => requestedAtMs,
      getSettings: async () => ({
        ...createDefaultSettings(dataDir),
        obs: {
          host: '127.0.0.1',
          port: 4455,
          passwordConfigured: true
        },
        clip: {
          paddingBeforeSeconds: 3,
          paddingAfterSeconds: 5,
          replayBufferSeconds: 1800,
          replaySourceDir: configuredReplayDir,
          outputDir: dataDir
        }
      }),
      getPassword: async () => 'obs-password',
      createClient: () => client,
      waitForReplayFile: vi.fn(async () => undefined)
    })

    await expect(service.testReplaySave()).resolves.toEqual({
      ok: true,
      message: 'OBS Replay Buffer сохранён, свежий файл найден',
      requestedAtMs,
      replayPath: actualReplayPath
    })
    expect(client.call).toHaveBeenCalledWith('SaveReplayBuffer')
  })
})
