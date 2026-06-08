const { promises: fs } = require('node:fs')
const path = require('node:path')

const ARCH_BY_VALUE = new Map([
  [0, 'ia32'],
  [1, 'x64'],
  [2, 'armv7l'],
  [3, 'arm64'],
  [4, 'universal']
])

const normalizeArch = (arch) => {
  if (typeof arch === 'string') return arch
  if (typeof arch === 'number') return ARCH_BY_VALUE.get(arch) ?? String(arch)
  return String(arch ?? '')
}

const findFfprobeBinDirs = async (root) => {
  const result = []
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const fullPath = path.join(root, entry.name)
    if (
      entry.name === 'bin' &&
      fullPath.includes(`${path.sep}app.asar.unpacked${path.sep}`) &&
      fullPath.endsWith(path.join('node_modules', 'ffprobe-static', 'bin'))
    ) {
      result.push(fullPath)
      continue
    }

    result.push(...await findFfprobeBinDirs(fullPath))
  }

  return result
}

const keepEntriesFor = (platform, arch) => {
  if (platform === 'darwin' && arch === 'universal') return new Set(['darwin/x64', 'darwin/arm64'])
  return new Set([`${platform}/${arch}`])
}

exports.default = async (context) => {
  const platform = context.electronPlatformName
  const arch = normalizeArch(context.arch)
  const keepEntries = keepEntriesFor(platform, arch)
  const binDirs = await findFfprobeBinDirs(context.appOutDir)

  for (const binDir of binDirs) {
    const platforms = await fs.readdir(binDir, { withFileTypes: true }).catch(() => [])

    for (const platformEntry of platforms) {
      if (!platformEntry.isDirectory()) continue

      const platformDir = path.join(binDir, platformEntry.name)
      const archEntries = await fs.readdir(platformDir, { withFileTypes: true }).catch(() => [])

      for (const archEntry of archEntries) {
        if (!archEntry.isDirectory()) continue

        const entryKey = `${platformEntry.name}/${archEntry.name}`
        if (keepEntries.has(entryKey)) continue

        await fs.rm(path.join(platformDir, archEntry.name), { recursive: true, force: true })
      }

      const remainingEntries = await fs.readdir(platformDir).catch(() => [])
      if (remainingEntries.length === 0) {
        await fs.rm(platformDir, { recursive: true, force: true })
      }
    }
  }
}
