// node node_modules/electron/cli.js tests/diagnostics/captureCadence.cjs
// Measures how evenly a terminal window capture delivers frames in a visible and a hidden renderer.
const { app, BrowserWindow, desktopCapturer } = require('electron')
const { buildSync } = require('esbuild')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const namePattern = new RegExp(process.env.TT_CAPTURE_NAME || 'loot\\s*x', 'i')
const seconds = Number(process.env.TT_CAPTURE_SECONDS || 10)
const directory = mkdtempSync(join(tmpdir(), 'tradetools-capture-cadence-'))
app.setPath('userData', directory)

const scenarios = [
  { name: 'visible', show: true, backgroundThrottling: true },
  { name: 'hidden', show: false, backgroundThrottling: true },
  { name: 'hidden-unthrottled', show: false, backgroundThrottling: false }
]

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
}

const simulateCfr = (arrivals, frameRate) => {
  if (!arrivals.length) return { emitted: 0, repeated: 0, skipped: 0 }
  const step = 1000 / frameRate
  let last = arrivals[0]
  let emitted = 1
  let repeated = 0
  let skipped = 0
  let current = 0
  let currentUsed = true
  const tick = (now) => {
    while (now - last > step) {
      last += step
      emitted++
      if (currentUsed) repeated++
      currentUsed = true
    }
  }
  for (let index = 1; index < arrivals.length; index++) {
    for (let time = arrivals[index - 1] + 4; time < arrivals[index]; time += 4) tick(time)
    tick(arrivals[index])
    if (!currentUsed) skipped++
    current = index
    currentUsed = false
  }
  return { emitted, repeated, skipped, lastSourceFrame: current }
}

const summarize = (samples) => {
  const sourceDeltas = samples.slice(1).map((sample, index) => (sample.timestampUs - samples[index].timestampUs) / 1000)
  const arrivalDeltas = samples.slice(1).map((sample, index) => sample.arrivalMs - samples[index].arrivalMs)
  const durationMs = samples.length > 1 ? (samples.at(-1).timestampUs - samples[0].timestampUs) / 1000 : 0
  return {
    frames: samples.length,
    sourceFps: durationMs > 0 ? Number(((samples.length - 1) * 1000 / durationMs).toFixed(2)) : 0,
    sourceDeltaP50Ms: Number(percentile(sourceDeltas, 0.5).toFixed(1)),
    sourceDeltaP95Ms: Number(percentile(sourceDeltas, 0.95).toFixed(1)),
    sourceDeltaMaxMs: Number(Math.max(0, ...sourceDeltas).toFixed(1)),
    sourceDeltasOver45Ms: sourceDeltas.filter((delta) => delta > 45).length,
    arrivalDeltaP95Ms: Number(percentile(arrivalDeltas, 0.95).toFixed(1)),
    arrivalDeltaMaxMs: Number(Math.max(0, ...arrivalDeltas).toFixed(1)),
    arrivalLagP95Ms: Number(percentile(samples.map((sample) => sample.lagMs), 0.95).toFixed(1)),
    arrivalLagMaxMs: Number(Math.max(0, ...samples.map((sample) => sample.lagMs)).toFixed(1)),
    cfr30: simulateCfr(samples.map((sample) => sample.arrivalMs), 30)
  }
}

const runScenario = async (scenario, sourceId) => {
  const window = new BrowserWindow({
    show: scenario.show,
    width: 400,
    height: 300,
    webPreferences: { backgroundThrottling: scenario.backgroundThrottling }
  })
  try {
    await window.loadFile(join(directory, 'index.html'))
    if (!scenario.show) window.hide()
    return await window.webContents.executeJavaScript(`(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: ${JSON.stringify(sourceId)}, minFrameRate: 30, maxFrameRate: 30 }, cursor: 'never' }
      })
      const [track] = stream.getVideoTracks()
      const settings = track.getSettings()
      const probe = track.clone()
      const samples = []
      const errors = []
      const origin = performance.timeOrigin
      const reader = new MediaStreamTrackProcessor({ track: probe }).readable.getReader()
      let reading = true
      const read = (async () => {
        while (reading) {
          const { value, done } = await reader.read()
          if (done) break
          const arrivalMs = performance.now()
          samples.push({ timestampUs: value.timestamp, arrivalMs, lagMs: 0 })
          value.close()
        }
      })()
      const encoder = await Capture.startCompressedWindowCapture(
        new MediaStream([track]), 30, 24000000, true, () => undefined, (error) => errors.push(String(error))
      ).catch((error) => { errors.push(String(error)); return undefined })
      await new Promise((resolve) => setTimeout(resolve, ${seconds * 1000}))
      reading = false
      await encoder?.stop()
      await reader.cancel().catch(() => undefined)
      await read.catch(() => undefined)
      stream.getTracks().forEach((item) => item.stop())
      probe.stop()
      const firstUs = samples[0]?.timestampUs ?? 0
      const firstArrival = samples[0]?.arrivalMs ?? 0
      for (const sample of samples) {
        sample.lagMs = (sample.arrivalMs - firstArrival) - (sample.timestampUs - firstUs) / 1000
      }
      const minLag = Math.min(0, ...samples.map((sample) => sample.lagMs))
      for (const sample of samples) sample.lagMs -= minLag
      return { settings: { width: settings.width, height: settings.height, frameRate: settings.frameRate }, samples, errors, hidden: document.hidden }
    })()`)
  } finally {
    window.destroy()
  }
}

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
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })
  const source = sources.find((item) => namePattern.test(item.name) && !/TradeTools|TradeClipper/i.test(item.name))
  if (!source) {
    console.log(JSON.stringify({ error: 'window not found', windows: sources.map((item) => item.name) }))
    app.exit(1)
    return
  }
  const results = []
  for (const scenario of scenarios) {
    const result = await runScenario(scenario, source.id)
    results.push({ scenario: scenario.name, hidden: result.hidden, settings: result.settings, errors: result.errors, ...summarize(result.samples) })
  }
  console.log(JSON.stringify({ electron: process.versions.electron, window: source.name, results }, null, 2))
  app.exit(0)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})

app.on('quit', () => rmSync(directory, { recursive: true, force: true }))
