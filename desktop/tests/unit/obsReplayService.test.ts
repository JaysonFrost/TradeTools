import { describe, expect, it } from 'vitest'
import { createObsReplayService } from '../../src/main/services/obs/obsReplayService'

describe('obsReplayService', () => {
  it('reports setup-needed status before OBS websocket credentials are configured', async () => {
    const service = createObsReplayService({ configured: false })

    await expect(service.getStatus()).resolves.toEqual({
      connected: false,
      replayBufferActive: false,
      status: 'setup-needed',
      message: 'OBS WebSocket не настроен'
    })
  })

  it('returns a deterministic test-save path without touching OBS in dry-run mode', async () => {
    const service = createObsReplayService({ configured: true, dryRun: true })
    const result = await service.saveReplayBuffer({
      requestedAtMs: Date.parse('2026-05-13T03:51:12.000Z'),
      outputDir: '/Users/igor/TradeClips/replays'
    })

    expect(result).toEqual({
      ok: true,
      mode: 'dry-run',
      replayPath: '/Users/igor/TradeClips/replays/2026-05-13_03-51-12_OBS_REPLAY.mp4',
      message: 'Тестовое сохранение OBS Replay Buffer спланировано'
    })
  })
})
