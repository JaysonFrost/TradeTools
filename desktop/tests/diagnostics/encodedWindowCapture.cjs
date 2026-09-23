// node node_modules/electron/cli.js tests/diagnostics/encodedWindowCapture.cjs
// A short, isolated end-to-end check of the renderer's MP4 fragment producer.
const { app, BrowserWindow } = require('electron')
const { spawnSync } = require('node:child_process')
const { buildSync } = require('esbuild')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const preferGpu = process.env.TT_CAPTURE_GPU === '1'
const sourceId = process.env.TT_CAPTURE_SOURCE || ''
const directory = mkdtempSync(join(tmpdir(), 'tradetools-encoded-capture-'))
app.setPath('userData', directory)

app.whenReady().then(async () => {
  buildSync({
    entryPoints: [join(__dirname, '../../src/renderer/lib/compressedWindowCapture.ts')],
    outfile: join(directory, 'capture.js'),
    bundle: true,
    format: 'iife',
    globalName: 'Capture',
    platform: 'browser'
  })
  const policy = readFileSync(join(__dirname, '../../src/renderer/index.html'), 'utf8')
    .match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0]
  writeFileSync(join(directory, 'index.html'), `${policy}<script src="capture.js"></script>`)
  const window = new BrowserWindow({ show: false })
  try {
    await window.loadFile(join(directory, 'index.html'))
    const result = await window.webContents.executeJavaScript(`(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 321
      canvas.height = 181
      const context = canvas.getContext('2d')
      const sourceId = ${JSON.stringify(sourceId)}
      const stream = sourceId ? await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxFrameRate: 30 } }
      }) : canvas.captureStream(10)
      const dimensions = stream.getVideoTracks()[0].getSettings()
      const fragments = []
      const errors = []
      const timer = setInterval(() => {
        context.fillStyle = 'rgb(' + Math.floor(Math.random() * 255) + ',80,100)'
        context.fillRect(0, 0, canvas.width, canvas.height)
      }, 100)
      const resizeTimer = setTimeout(() => {
        canvas.width = 363
        canvas.height = 205
      }, 3000)
      try {
        const encoder = await Capture.startCompressedWindowCapture(
          stream, sourceId ? 30 : 10, sourceId ? 24000000 : 1000000, ${preferGpu},
          fragment => fragments.push({
            data: Array.from(new Uint8Array(fragment.data)),
            start: fragment.startedAtMs,
            end: fragment.endedAtMs
          }),
          error => errors.push(String(error))
        )
        await new Promise(resolve => setTimeout(resolve, 6500))
        await encoder.stop()
        return { fragments, errors, dimensions, hardwareRequested: encoder.hardwareRequested }
      } finally {
        clearInterval(timer)
        clearTimeout(resizeTimer)
        stream.getTracks().forEach(track => track.stop())
      }
    })()`)
    const ffprobe = require('@ffprobe-installer/ffprobe').path
    const expectedWidth = Math.max(2, result.dimensions.width - result.dimensions.width % 2)
    const expectedHeight = Math.max(2, result.dimensions.height - result.dimensions.height % 2)
    const decoded = result.fragments.map((fragment, index) => {
      const file = join(directory, `${index}.mp4`)
      writeFileSync(file, Buffer.from(fragment.data))
      const probe = spawnSync(ffprobe, [
        '-v', 'error', '-count_frames', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,nb_read_frames', '-of', 'json', file
      ], { encoding: 'utf8' })
      const video = probe.status === 0 ? JSON.parse(probe.stdout).streams?.[0] : undefined
      return {
        bytes: fragment.data.length, start: fragment.start, end: fragment.end,
        valid: probe.status === 0 && !probe.stderr.trim() && video?.width === expectedWidth && video?.height === expectedHeight && Number(video?.nb_read_frames) > 0,
        error: probe.stderr.trim()
      }
    })
    console.log(JSON.stringify({ electron: process.versions.electron, hardwareRequested: result.hardwareRequested, dimensions: result.dimensions, fragments: decoded, errors: result.errors }))
    if (preferGpu && !result.hardwareRequested || result.errors.length || decoded.length < 2 || decoded.some((fragment) => !fragment.valid || fragment.bytes < 100 || fragment.end <= fragment.start)) {
      process.exitCode = 1
    }
  } finally {
    window.destroy()
  }
  app.exit(process.exitCode || 0)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})

app.on('quit', () => rmSync(directory, { recursive: true, force: true }))
