const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')

const plistBuddy = '/usr/libexec/PlistBuddy'
const permissionKeys = {
  NSAudioCaptureUsageDescription: 'TradeTools records system audio into trade video clips.',
  NSMicrophoneUsageDescription: 'TradeTools records microphone audio into trade video clips.'
}

const hasPlistKey = (plistPath, key) => {
  try {
    execFileSync(plistBuddy, ['-c', `Print :${key}`, plistPath], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

if (process.platform === 'darwin') {
  const plistPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Info.plist')

  if (existsSync(plistPath)) {
    for (const [key, value] of Object.entries(permissionKeys)) {
      if (!hasPlistKey(plistPath, key)) {
        execFileSync(plistBuddy, ['-c', `Add :${key} string ${value}`, plistPath])
      }
    }
  }
}
