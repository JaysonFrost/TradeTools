export type FfmpegTrimMode = 'copy' | 'reencode'
export type H264VideoPurpose = 'recording' | 'export'
export type H264VideoEncoder = 'gpu' | 'nvidia' | 'amd' | 'intel' | `gpu:${'nvidia' | 'amd' | 'intel'}:${number}` | 'cpu'

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
  encoder?: H264VideoEncoder
}

const formatSeconds = (value: number): string => value.toFixed(3)
const formatFrameRate = (value: number): string => value.toFixed(3).replace(/\.?0+$/, '')

const buildCpuH264VideoArgs = (purpose: H264VideoPurpose): string[] => [
  '-c:v',
  'libx264',
  '-preset',
  purpose === 'recording' ? 'ultrafast' : 'veryfast',
  ...(purpose === 'recording' ? ['-tune', 'zerolatency', '-crf', '24'] : ['-crf', '18']),
  '-pix_fmt',
  'yuv420p'
]

const parseGpuH264VideoEncoder = (encoder: H264VideoEncoder): { vendor: 'nvidia' | 'amd' | 'intel', index?: number } | undefined => {
  if (encoder === 'nvidia' || encoder === 'amd' || encoder === 'intel') return { vendor: encoder }

  const match = /^gpu:(nvidia|amd|intel):(\d+)$/.exec(encoder)
  if (!match) return undefined

  const index = Number(match[2])
  return Number.isInteger(index) && index >= 0 ? { vendor: match[1] as 'nvidia' | 'amd' | 'intel', index } : undefined
}

export const buildH264VideoArgs = ({ platform = process.platform, purpose, encoder = 'gpu' }: H264VideoArgsInput): string[] => {
  const bitrate = purpose === 'recording' ? '5M' : '10M'
  const gpuEncoder = parseGpuH264VideoEncoder(encoder)

  if (encoder === 'cpu') return buildCpuH264VideoArgs(purpose)

  if (platform === 'win32') {
    if (gpuEncoder?.vendor === 'nvidia') {
      return [
        '-c:v',
        'h264_nvenc',
        ...(gpuEncoder.index === undefined ? [] : ['-gpu', String(gpuEncoder.index)]),
        '-preset',
        purpose === 'recording' ? 'p1' : 'p4',
        '-tune',
        purpose === 'recording' ? 'ull' : 'hq',
        '-b:v',
        bitrate,
        '-pix_fmt',
        'yuv420p'
      ]
    }

    if (gpuEncoder?.vendor === 'amd') {
      return [
        '-c:v',
        'h264_amf',
        '-usage',
        purpose === 'recording' ? 'ultralowlatency' : 'high_quality',
        '-b:v',
        bitrate,
        '-pix_fmt',
        'nv12'
      ]
    }

    if (gpuEncoder?.vendor === 'intel') {
      return [
        '-c:v',
        'h264_qsv',
        '-preset',
        purpose === 'recording' ? 'veryfast' : 'medium',
        '-b:v',
        bitrate,
        '-pix_fmt',
        'nv12'
      ]
    }

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

  return buildCpuH264VideoArgs(purpose)
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
