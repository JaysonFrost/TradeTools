import { createMissingMediaToolError, isMissingMediaToolError, resolveMediaToolPath } from './mediaBinaries'

export type VideoDurationProbe = (videoPath: string) => Promise<number>

export type VideoDetails = {
  durationSeconds: number
  averageFrameRate?: number
  nominalFrameRate?: number
  codecName?: string
  width?: number
  height?: number
  frameCount?: number
}

export type VideoDetailsProbe = (videoPath: string) => Promise<VideoDetails>

type FfprobeStream = {
  codec_name?: unknown
  width?: unknown
  height?: unknown
  duration?: unknown
  avg_frame_rate?: unknown
  r_frame_rate?: unknown
  nb_frames?: unknown
}

type FfprobeOutput = {
  streams?: FfprobeStream[]
  format?: {
    duration?: unknown
  }
}

const parsePositiveNumber = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

const parseFrameRate = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || value === '0/0') return undefined

  const [numeratorText, denominatorText] = value.split('/')
  if (!denominatorText) return parsePositiveNumber(value)

  const numerator = Number(numeratorText)
  const denominator = Number(denominatorText)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return undefined

  const frameRate = numerator / denominator
  return frameRate > 0 ? frameRate : undefined
}

const runFfprobe = async (videoPath: string): Promise<string> => {
  const { spawn } = await import('node:child_process')
  const args = [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_name,width,height,duration,avg_frame_rate,r_frame_rate,nb_frames:format=duration',
    '-of',
    'json',
    videoPath
  ]

  return new Promise<string>((resolve, reject) => {
    const child = spawn(resolveMediaToolPath('ffprobe'), args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      reject(isMissingMediaToolError(error) ? createMissingMediaToolError('ffprobe') : error)
    })
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }

      reject(new Error(`ffprobe exited with code ${code ?? 'unknown'}: ${stderr.trim()}`))
    })
  })
}

export const probeVideoDetails: VideoDetailsProbe = async (videoPath) => {
  const output = await runFfprobe(videoPath)
  const parsed = JSON.parse(output) as FfprobeOutput
  const stream = parsed.streams?.[0]
  const durationSeconds = parsePositiveNumber(stream?.duration) ?? parsePositiveNumber(parsed.format?.duration)

  if (durationSeconds === undefined) {
    throw new Error(`Не удалось определить длительность видео через ffprobe: ${videoPath}`)
  }

  const averageFrameRate = parseFrameRate(stream?.avg_frame_rate)
  const nominalFrameRate = parseFrameRate(stream?.r_frame_rate)
  const frameCount = parsePositiveNumber(stream?.nb_frames)
  const width = parsePositiveNumber(stream?.width)
  const height = parsePositiveNumber(stream?.height)

  return {
    durationSeconds,
    ...(averageFrameRate ? { averageFrameRate } : {}),
    ...(nominalFrameRate ? { nominalFrameRate } : {}),
    ...(typeof stream?.codec_name === 'string' && stream.codec_name ? { codecName: stream.codec_name } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(frameCount ? { frameCount } : {})
  }
}

export const probeVideoDurationSeconds: VideoDurationProbe = async (videoPath) => {
  const details = await probeVideoDetails(videoPath)
  return details.durationSeconds
}
