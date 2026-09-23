// Run with node_modules/electron/dist/electron.exe tests/diagnostics/mediaRecorderMemory.cjs
// A separate, hidden Electron process for diagnosing MediaRecorder retention.
const { app, BrowserWindow, desktopCapturer } = require('electron')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const durationMs = Math.max(30, Math.min(180, Number(process.env.TT_REPRO_SECONDS) || 90)) * 1000
const sourceType = process.env.TT_REPRO_SOURCE === 'window' ? 'window' : 'screen'
const nativeResolution = process.env.TT_REPRO_NATIVE === '1'
const frameRate = Math.max(10, Math.min(60, Number(process.env.TT_REPRO_FPS) || 15))
const bitrate = Math.max(1_000_000, Math.min(90_000_000, Number(process.env.TT_REPRO_BITRATE) || 12_000_000))
const rotateMs = process.env.TT_REPRO_CONTINUOUS === '1' ? 0 : 8_000
const reuseRecorder = process.env.TT_REPRO_REUSE === '1'
const profile = mkdtempSync(join(tmpdir(), 'tradetools-media-repro-'))
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-features', 'AllowWgcScreenCapturer,AllowWgcScreenZeroHz,AllowWgcWindowZeroHz')

app.whenReady().then(async () => {
  const sources = await desktopCapturer.getSources({
    types: [sourceType], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false
  })
  const source = sourceType === 'window'
    ? sources.find((candidate) => candidate.name.includes(process.env.TT_REPRO_WINDOW_NAME || 'LootX'))
    : sources[0]
  if (!source) throw new Error('Requested capture source is unavailable')
  const window = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false }
  })
  const page = join(profile, 'capture.html')
  writeFileSync(page, '<!doctype html><html><body></body></html>')
  await window.loadFile(page)
  const started = await window.webContents.executeJavaScript(`
    (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: {
          chromeMediaSource: 'desktop', chromeMediaSourceId: ${JSON.stringify(source.id)},
          ${nativeResolution ? '' : 'maxWidth: 1280, maxHeight: 720,'}
          minFrameRate: ${frameRate}, maxFrameRate: ${frameRate}
        }}
      });
      let sessions = 0, bytes = 0, chunks = 0;
      let recorder;
      let stopping = false;
      function rotate() {
        if (stopping) return;
        if (!recorder || !${reuseRecorder}) {
          recorder = new MediaRecorder(stream, {
            mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
              ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8',
            videoBitsPerSecond: ${bitrate}
          });
        }
        sessions++;
        recorder.ondataavailable = async (event) => {
          if (event.data.size > 0) {
            const data = await event.data.arrayBuffer();
            bytes += data.byteLength;
            chunks++;
          }
        };
        recorder.onstop = () => {
          if (!${reuseRecorder}) recorder = undefined;
          if (!stopping) rotate();
        };
        recorder.start(2000);
        ${rotateMs ? `setTimeout(() => { if (recorder && recorder.state === 'recording') recorder.stop(); }, ${rotateMs});` : ''}
      }
      window.reproState = () => ({
        sessions, chunks, bytes,
        heap: require('node:v8').getHeapStatistics().used_heap_size,
        blink: process.getBlinkMemoryInfo().allocated
      });
      window.stopRepro = () => {
        stopping = true;
        if (recorder && recorder.state === 'recording') recorder.stop();
        stream.getTracks().forEach(track => track.stop());
      };
      rotate();
      return { track: stream.getVideoTracks()[0].getSettings(), pid: process.pid };
    })()
  `)
  console.log(JSON.stringify({ event: 'started', sourceType, nativeResolution, frameRate, bitrate, rotateMs, reuseRecorder, ...started }))
  const interval = setInterval(async () => {
    try {
      const state = await window.webContents.executeJavaScript('window.reproState()')
      const metric = app.getAppMetrics().find((item) => item.pid === started.pid)
      console.log(JSON.stringify({ event: 'sample', elapsedSeconds: Math.round(process.uptime()),
        ...state, memory: metric?.memory }))
    } catch (error) {
      console.error(error)
    }
  }, 10_000)
  setTimeout(async () => {
    clearInterval(interval)
    await window.webContents.executeJavaScript('window.stopRepro()').catch(() => undefined)
    window.destroy()
    app.quit()
  }, durationMs)
}).catch((error) => {
  console.error(error)
  rmSync(profile, { recursive: true, force: true })
  app.exit(1)
})

app.on('quit', () => rmSync(profile, { recursive: true, force: true }))
