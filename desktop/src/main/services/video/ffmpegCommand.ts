export type FfmpegTrimMode = 'copy' | 'reencode'
export type H264VideoPurpose = 'recording' | 'export'

export type FfmpegTrimInput = {
  inputPath: string
  outputPath: string
  startSeconds: number
  endSeconds: number
  mode: FfmpegTrimMode
  targetFrameRate?: number
}

export type H264VideoArgsInput = {
  platform?: NodeJS.Platform
  purpose: H264VideoPurpose
}

const formatSeconds = (value: number): string => value.toFixed(3)
const formatFrameRate = (value: number): string => value.toFixed(3).replace(/\.?0+$/, '')

export const buildH264VideoArgs = ({ platform = process.platform, purpose }: H264VideoArgsInput): string[] => {
  const bitrate = purpose === 'recording' ? '8M' : '10M'

  if (platform === 'win32') {
    return [
      '-c:v',
      'h264_mf',
      '-hw_encoding',
      '1',
      '-b:v',
      bitrate,
      '-pix_fmt',
      'nv12'
    ]
  }

  if (platform === 'darwin') {
    return [
      '-c:v',
      'h264_videotoolbox',
      ...(purpose === 'recording' ? ['-realtime', '1'] : []),
      '-b:v',
      bitrate,
      '-pix_fmt',
      'yuv420p'
    ]
  }

  return [
    '-c:v',
    'libx264',
    '-preset',
    purpose === 'recording' ? 'ultrafast' : 'veryfast',
    ...(purpose === 'recording' ? ['-tune', 'zerolatency', '-crf', '24'] : ['-crf', '18']),
    '-pix_fmt',
    'yuv420p'
  ]
}

export const buildFfmpegTrimArgs = (input: FfmpegTrimInput): string[] => {
  if (!Number.isFinite(input.startSeconds) || !Number.isFinite(input.endSeconds)) {
    throw new Error('Trim times must be finite')
  }

  if (input.endSeconds <= input.startSeconds) {
    throw new Error('Trim end must be after start')
  }

  const durationSeconds = input.endSeconds - input.startSeconds
  const baseArgs = ['-y', '-fflags', '+genpts', '-ss', formatSeconds(input.startSeconds), '-t', formatSeconds(durationSeconds), '-i', input.inputPath]

  if (input.mode === 'copy') {
    return [...baseArgs, '-avoid_negative_ts', 'make_zero', '-c', 'copy', input.outputPath]
  }

  const frameRateArgs = Number.isFinite(input.targetFrameRate) && (input.targetFrameRate ?? 0) > 0
    ? ['-r', formatFrameRate(input.targetFrameRate as number), '-fps_mode', 'cfr']
    : ['-fps_mode', 'cfr']

  return [
    ...baseArgs,
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
    ...frameRateArgs,
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-avoid_negative_ts',
    'make_zero',
    '-movflags',
    '+faststart',
    input.outputPath
  ]
}
