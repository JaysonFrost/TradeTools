import { availableParallelism } from 'node:os'

export type FfmpegTrimMode = 'copy' | 'reencode'
export type H264VideoPurpose = 'recording' | 'export'
export type H264VideoEncoder = 'gpu' | 'nvidia' | 'amd' | 'intel' | `gpu:${'nvidia' | 'amd' | 'intel'}:${number}` | 'cpu'
export type H264VideoQuality = 'standard' | 'native'

export type FfmpegTrimInput = {
  inputPath: string
  outputPath: string
  startSeconds: number
  endSeconds: number
  mode: FfmpegTrimMode
  targetFrameRate?: number
  platform?: NodeJS.Platform
  videoEncoder?: H264VideoEncoder
  renderThreads?: number
}

export type H264VideoArgsInput = {
  platform?: NodeJS.Platform
  purpose: H264VideoPurpose
  encoder?: H264VideoEncoder
  quality?: H264VideoQuality
}

const formatSeconds = (value: number): string => value.toFixed(3)
const formatFrameRate = (value: number): string => value.toFixed(3).replace(/\.?0+$/, '')

export const calculateFfmpegRenderThreads = (parallelism = availableParallelism()): number => {
  void parallelism
  return 1
}

const buildCpuH264VideoArgs = (purpose: H264VideoPurpose, quality: H264VideoQuality): string[] => [
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  ...(purpose === 'recording'
    ? ['-tune', 'zerolatency', '-crf', quality === 'native' ? '16' : '20']
    : ['-crf', quality === 'native' ? '14' : '18']),
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

export const buildH264VideoArgs = ({ platform = process.platform, purpose, encoder = 'gpu', quality = 'standard' }: H264VideoArgsInput): string[] => {
  const nativeQuality = quality === 'native'
  const bitrate = nativeQuality ? '60M' : '20M'
  const maxRate = nativeQuality ? '90M' : '30M'
  const bufferSize = nativeQuality ? '120M' : '40M'
  const constantQuality = nativeQuality ? '14' : '18'
  const gpuEncoder = parseGpuH264VideoEncoder(encoder)

  if (encoder === 'cpu') return buildCpuH264VideoArgs(purpose, quality)

  if (platform === 'win32') {
    if (gpuEncoder?.vendor === 'nvidia') {
      return [
        '-c:v',
        'h264_nvenc',
        ...(gpuEncoder.index === undefined ? [] : ['-gpu', String(gpuEncoder.index)]),
        '-preset',
        purpose === 'recording' ? 'p5' : 'p4',
        '-tune',
        'hq',
        '-rc',
        'vbr',
        '-cq',
        constantQuality,
        '-b:v',
        bitrate,
        '-maxrate',
        maxRate,
        '-bufsize',
        bufferSize,
        '-pix_fmt',
        'yuv420p'
      ]
    }

    if (gpuEncoder?.vendor === 'amd') {
      return [
        '-c:v',
        'h264_amf',
        '-usage',
        'high_quality',
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
        'medium',
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

  return buildCpuH264VideoArgs(purpose, quality)
}

export const buildFfmpegTrimArgs = (input: FfmpegTrimInput): string[] => {
  if (!Number.isFinite(input.startSeconds) || !Number.isFinite(input.endSeconds)) {
    throw new Error('Trim times must be finite')
  }

  if (input.endSeconds <= input.startSeconds) {
    throw new Error('Trim end must be after start')
  }

  const durationSeconds = input.endSeconds - input.startSeconds
  const requestedRenderThreads = Number(input.renderThreads)
  const renderThreads = Number.isFinite(requestedRenderThreads) && requestedRenderThreads > 0
    ? Math.max(1, Math.min(2, Math.trunc(requestedRenderThreads)))
    : calculateFfmpegRenderThreads()
  const renderInputArgs = input.mode === 'reencode'
    ? ['-threads', String(renderThreads), '-filter_threads', '1']
    : []
  const baseArgs = ['-y', ...renderInputArgs, '-fflags', '+genpts', '-ss', formatSeconds(input.startSeconds), '-t', formatSeconds(durationSeconds), '-i', input.inputPath]

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
    ...buildH264VideoArgs({
      platform: input.platform,
      purpose: 'export',
      encoder: input.videoEncoder ?? 'cpu'
    }),
    '-threads',
    String(renderThreads),
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
