import { basename } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMissingMediaToolError, resolveMediaToolPath } from '../../src/main/services/video/mediaBinaries'

const originalFfprobePath = process.env.TRADETOOLS_FFPROBE_PATH

describe('mediaBinaries', () => {
  afterEach(() => {
    if (originalFfprobePath === undefined) {
      delete process.env.TRADETOOLS_FFPROBE_PATH
      return
    }

    process.env.TRADETOOLS_FFPROBE_PATH = originalFfprobePath
  })

  it('allows overriding ffprobe path with an environment variable', () => {
    process.env.TRADETOOLS_FFPROBE_PATH = 'C:\\tools\\ffprobe.exe'

    expect(resolveMediaToolPath('ffprobe')).toBe('C:\\tools\\ffprobe.exe')
  })

  it('uses the bundled ffprobe binary when available', () => {
    delete process.env.TRADETOOLS_FFPROBE_PATH

    expect(basename(resolveMediaToolPath('ffprobe'))).toMatch(/^ffprobe(\.exe)?$/)
  })

  it('returns a user-facing missing binary error', () => {
    expect(createMissingMediaToolError('ffprobe').message).toContain('ffprobe не найден')
    expect(createMissingMediaToolError('ffmpeg').message).toContain('TRADETOOLS_FFMPEG_PATH')
  })
})
