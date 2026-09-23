import { afterEach, describe, expect, it, vi } from 'vitest'
import { Output } from 'mediabunny'
import { chooseWindowEncoderAcceleration, startCompressedWindowCapture } from '../../src/renderer/lib/compressedWindowCapture'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('window H.264 encoder selection', () => {
  it('requests hardware when available and falls back to software otherwise', async () => {
    const probe = vi.fn(async (config: VideoEncoderConfig) => ({
      supported: config.width <= 1920 || config.hardwareAcceleration === 'prefer-software'
    }))
    vi.stubGlobal('VideoEncoder', { isConfigSupported: probe })
    const config = { codec: 'avc1.640033', width: 1920, height: 1080 }

    expect(await chooseWindowEncoderAcceleration(config, true)).toBe('prefer-hardware')
    expect(await chooseWindowEncoderAcceleration({ ...config, width: 2560 }, true)).toBe('prefer-software')
    expect(await chooseWindowEncoderAcceleration(config, false)).toBe('prefer-software')
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('cancels the output when the capture source fails to start', async () => {
    class Track {
      kind = 'video'
      getSettings() { return { width: 320, height: 180 } }
    }
    vi.stubGlobal('MediaStreamTrack', Track)
    vi.stubGlobal('VideoEncoder', { isConfigSupported: async () => ({ supported: true }) })
    const failure = new Error('Worker blocked by Content Security Policy')
    vi.spyOn(Output.prototype, 'start').mockRejectedValueOnce(failure)
    const cancel = vi.spyOn(Output.prototype, 'cancel')
    const stream = {
      getVideoTracks: () => [new Track()], getAudioTracks: () => []
    } as unknown as MediaStream

    await expect(startCompressedWindowCapture(stream, 10, 1_000_000, false, vi.fn(), vi.fn()))
      .rejects.toBe(failure)
    expect(cancel).toHaveBeenCalledOnce()
  })
})
