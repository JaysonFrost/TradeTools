const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { extractFile } = require('@electron/asar')

module.exports = ({ appOutDir, electronPlatformName, packager }) => {
  const resources = electronPlatformName === 'darwin'
    ? join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(appOutDir, 'resources')
  const icon = readFileSync(join(resources, 'icon.png'))
  if (!icon.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    throw new Error('Packaged application icon is not a PNG')
  }
  const appPackage = JSON.parse(extractFile(join(resources, 'app.asar'), 'package.json'))
  if (appPackage.version !== packager.appInfo.version) {
    throw new Error(`Packaged version ${appPackage.version} differs from ${packager.appInfo.version}`)
  }
  console.log(`Verified packaged TradeTools ${appPackage.version} and application icon`)
}
