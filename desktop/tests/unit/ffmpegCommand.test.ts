import { describe, expect, it } from 'vitest'
import { buildFfmpegTrimArgs } from '../../src/main/services/video/ffmpegCommand'

describe('buildFfmpegTrimArgs', () => {
  it('builds a safe stream-copy trim command argument list', () => {
    expect(buildFfmpegTrimArgs({
      inputPath: '/tmp/replay.mp4',
      outputPath: '/tmp/clip.mp4',
      startSeconds: 12,
      endSeconds: 42,
      mode: 'copy'
    })).toEqual(['-y', '-ss', '12.000', '-to', '42.000', '-i', '/tmp/replay.mp4', '-c', 'copy', '/tmp/clip.mp4'])
  })

  it('builds a frame-accurate re-encode command argument list', () => {
    expect(buildFfmpegTrimArgs({
      inputPath: '/tmp/replay.mp4',
      outputPath: '/tmp/clip.mp4',
      startSeconds: 1.25,
      endSeconds: 8.5,
      mode: 'reencode'
    })).toContain('libx264')
  })

  it('rejects invalid trim ranges', () => {
    expect(() => buildFfmpegTrimArgs({
      inputPath: '/tmp/replay.mp4',
      outputPath: '/tmp/clip.mp4',
      startSeconds: 10,
      endSeconds: 10,
      mode: 'copy'
    })).toThrow('Trim end must be after start')
  })
})
