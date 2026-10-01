const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')
const { app, shell } = require('electron')

app.whenReady().then(() => {
  const root = mkdtempSync(join(tmpdir(), 'tradetools-shortcuts-'))
  const programs = join(root, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  const pins = join(root, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar')
  const backup = join(root, 'backup')
  // A private identity keeps the check away from the user's real taskbar pins.
  const appId = `com.tradetools.shortcut-check.${process.pid}`
  const target = process.execPath
  const script = join(__dirname, 'repairWindowsShortcuts.ps1')
  mkdirSync(programs, { recursive: true })
  mkdirSync(pins, { recursive: true })
  const create = (path, id, executable, args = '') => assert(shell.writeShortcutLink(path, 'create', {
    target: executable, args, appUserModelId: id, icon: executable, iconIndex: 0
  }))
  const canonical = join(programs, 'TradeTools.lnk')
  const alias = join(programs, 'Electron.lnk')
  const brokenPin = join(pins, 'Electron.lnk')
  const healthyPin = join(pins, 'TradeTools.lnk')
  const unrelated = join(pins, 'Other Electron.lnk')
  // The installed target deliberately has a different filename from electron.exe.
  const installedTarget = join(root, 'TradeTools.exe')
  writeFileSync(installedTarget, '')
  create(canonical, appId, installedTarget)
  create(alias, appId, target)
  create(brokenPin, appId, target)
  create(healthyPin, appId, installedTarget)
  create(unrelated, 'com.some-other-app', target)
  const healthyBefore = readFileSync(healthyPin)
  const unrelatedBefore = readFileSync(unrelated)
  writeFileSync(join(pins, 'Unreadable.lnk'), 'invalid shortcut')
  const run = () => {
    if (!existsSync(script)) return // The pre-fix application only creates its canonical shortcut.
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-AppDataDir', root, '-BackupDir', backup, '-ExecutablePath', installedTarget, '-CanonicalShortcutPath', canonical, '-AppId', appId],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
  try {
    run()
    assert.equal(existsSync(alias), false, 'Legacy Electron registration must be removed')
    assert.equal(existsSync(brokenPin), false, 'Corrupted taskbar pin must be unregistered')
    assert.deepEqual(readFileSync(healthyPin), healthyBefore, 'Healthy pin must stay unchanged')
    assert.deepEqual(readFileSync(unrelated), unrelatedBefore, 'Another Electron app must stay unchanged')
    assert.equal(shell.readShortcutLink(canonical).target, realpathSync.native(installedTarget))
    const backupCount = readdirSync(backup).length
    assert.equal(backupCount, 2, 'Both original shortcuts must be backed up')
    run()
    assert.equal(readdirSync(backup).length, backupCount, 'Repeated startup must be harmless')
    console.log('Windows shortcut repair passed: legacy alias, pin, backup, unrelated apps, repeated startup')
  } finally {
    assert.equal(realpathSync.native(dirname(root)), realpathSync.native(tmpdir()))
    rmSync(root, { recursive: true, force: true })
  }
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })
