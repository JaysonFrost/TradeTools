import { describe, expect, it } from 'vitest'
import { buildFfmpegTrimArgs, buildH264VideoArgs } from '../../src/main/services/video/ffmpegCommand'

describe('buildFfmpegTrimArgs', () => {
  it('builds a safe stream-copy trim command argument list', () => {
    expect(buildFfmpegTrimArgs({
      inputPath: '/tmp/replay.mp4',
      outputPath: '/tmp/clip.mp4',
      startSeconds: 12,
      endSeconds: 42,
      mode: 'copy'
    })).toEqual(['-y', '-fflags', '+genpts', '-ss', '12.000', '-t', '30.000', '-i', '/tmp/replay.mp4', '-avoid_negative_ts', 'make_zero', '-c', 'copy', '/tmp/clip.mp4'])
  })

  it('builds a frame-accurate re-encode command argument list', () => {
    expect(buildFfmpegTrimArgs({
      inputPath: '/tmp/replay.mp4',
      outputPath: '/tmp/clip.mp4',
      startSeconds: 1.25,
      endSeconds: 8.5,
      mode: 'reencode',
      targetFrameRate: 59.94
    })).toEqual([
      '-y',
      '-fflags',
      '+genpts',
      '-ss',
      '1.250',
      '-t',
      '7.250',
      '-i',
      '/tmp/replay.mp4',
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '59.94',
      '-fps_mode',
      'cfr',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-avoid_negative_ts',
      'make_zero',
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

  it('uses platform hardware H.264 encoders for video re-encoding', () => {
    expect(buildH264VideoArgs({ platform: 'win32', purpose: 'export' })).toEqual([
      '-c:v',
      'h264_mf',
      '-hw_encoding',
      '1',
      '-b:v',
      '20M',
      '-pix_fmt',
      'nv12'
    ])
    expect(buildH264VideoArgs({ platform: 'win32', purpose: 'recording' })).toEqual([
      '-c:v',
      'h264_mf',
      '-hw_encoding',
      '1',
      '-b:v',
      '20M',
      '-pix_fmt',
      'nv12'
    ])
    expect(buildH264VideoArgs({ platform: 'darwin', purpose: 'recording' })).toEqual([
      '-c:v',
      'h264_videotoolbox',
      '-realtime',
      '1',
      '-b:v',
      '20M',
      '-pix_fmt',
      'yuv420p'
    ])
    expect(buildH264VideoArgs({ platform: 'linux', purpose: 'export' })).toEqual([
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p'
    ])
  })

  it('can select a specific Windows GPU encoder device', () => {
    expect(buildH264VideoArgs({ platform: 'win32', purpose: 'recording', encoder: 'gpu:nvidia:1' })).toEqual([
      '-c:v',
      'h264_nvenc',
      '-gpu',
      '1',
      '-preset',
      'p5',
      '-tune',
      'hq',
      '-rc',
      'vbr',
      '-cq',
      '18',
      '-b:v',
      '20M',
      '-maxrate',
      '30M',
      '-bufsize',
      '40M',
      '-pix_fmt',
      'yuv420p'
    ])
    expect(buildH264VideoArgs({ platform: 'win32', purpose: 'export', encoder: 'gpu:amd:0' })).toEqual([
      '-c:v',
      'h264_amf',
      '-usage',
      'high_quality',
      '-b:v',
      '20M',
      '-pix_fmt',
      'nv12'
    ])
    expect(buildH264VideoArgs({ platform: 'win32', purpose: 'recording', encoder: 'gpu:intel:0' })).toEqual([
      '-c:v',
      'h264_qsv',
      '-preset',
      'medium',
      '-b:v',
      '20M',
      '-pix_fmt',
      'nv12'
    ])
  })

  it('can force CPU H.264 encoding even on platforms with hardware encoders', () => {
    expect(buildH264VideoArgs({ platform: 'win32', purpose: 'recording', encoder: 'cpu' })).toEqual([
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-tune',
      'zerolatency',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p'
    ])
  })
})
