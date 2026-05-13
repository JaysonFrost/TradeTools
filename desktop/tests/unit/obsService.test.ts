import { describe, expect, it } from 'vitest'
import { createObsService } from '../../src/main/services/obs/obsService'

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
})
