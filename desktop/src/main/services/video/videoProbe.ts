export type VideoDurationProbe = (videoPath: string) => Promise<number>

export const probeVideoDurationSeconds: VideoDurationProbe = async (videoPath) => {
  const { spawn } = await import('node:child_process')
  const args = [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    videoPath
  ]

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }

      reject(new Error(`ffprobe exited with code ${code ?? 'unknown'}: ${stderr.trim()}`))
    })
  })
  const durationSeconds = Number(output)
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`Не удалось определить длительность видео через ffprobe: ${videoPath}`)
  }

  return durationSeconds
}
