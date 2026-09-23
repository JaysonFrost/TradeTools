// TT_WINDOW_HANDLE=<decimal HWND> node node_modules/electron/cli.js tests/diagnostics/nativeWindowId.cjs
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const handle = Number(process.env.TT_WINDOW_HANDLE)
if (!Number.isSafeInteger(handle) || handle <= 0) throw new Error('TT_WINDOW_HANDLE must be a positive HWND')
const directory = mkdtempSync(join(tmpdir(), 'tradetools-native-window-id-'))
app.setPath('userData', directory)
app.whenReady().then(async () => {
  const page = join(directory, 'index.html')
  writeFileSync(page, '<html><body></body></html>')
  const window = new BrowserWindow({ show: false })
  try {
    await window.loadFile(page)
    const track = await window.webContents.executeJavaScript(`(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: 'window:${handle}:0',
          maxFrameRate: 10
        }}
      })
      const settings = stream.getVideoTracks()[0].getSettings()
      stream.getTracks().forEach(track => track.stop())
      return settings
    })()`)
    console.log(JSON.stringify({ handle, width: track.width, height: track.height }))
  } finally {
    window.destroy()
    app.quit()
  }
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
app.on('quit', () => rmSync(directory, { recursive: true, force: true }))
