export type FfmpegTrimMode = 'copy' | 'reencode'

export type FfmpegTrimInput = {
  inputPath: string
  outputPath: string
  startSeconds: number
  endSeconds: number
  mode: FfmpegTrimMode
}

const formatSeconds = (value: number): string => value.toFixed(3)

export const buildFfmpegTrimArgs = (input: FfmpegTrimInput): string[] => {
  if (!Number.isFinite(input.startSeconds) || !Number.isFinite(input.endSeconds)) {
    throw new Error('Trim times must be finite')
  }

  if (input.endSeconds <= input.startSeconds) {
    throw new Error('Trim end must be after start')
  }

  const durationSeconds = input.endSeconds - input.startSeconds
  const baseArgs = ['-y', '-ss', formatSeconds(input.startSeconds), '-t', formatSeconds(durationSeconds), '-i', input.inputPath]

  if (input.mode === 'copy') {
    return [...baseArgs, '-avoid_negative_ts', 'make_zero', '-c', 'copy', input.outputPath]
  }

  return [...baseArgs, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-movflags', '+faststart', input.outputPath]
}
