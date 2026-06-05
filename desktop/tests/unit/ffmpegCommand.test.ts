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
    })).toEqual(['-y', '-ss', '12.000', '-t', '30.000', '-i', '/tmp/replay.mp4', '-avoid_negative_ts', 'make_zero', '-c', 'copy', '/tmp/clip.mp4'])
  })

  it('builds a frame-accurate re-encode command argument list', () => {
    expect(buildFfmpegTrimArgs({
      inputPath: '/tmp/replay.mp4',
      outputPath: '/tmp/clip.mp4',
      startSeconds: 1.25,
      endSeconds: 8.5,
      mode: 'reencode'
    })).toEqual([
      '-y',
      '-ss',
      '1.250',
      '-t',
      '7.250',
      '-i',
      '/tmp/replay.mp4',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      '/tmp/clip.mp4'
    ])
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
