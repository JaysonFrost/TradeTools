import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDefaultSettings, normalizeSettings, type AppSettings, type PartialSettings } from './settings'

export type SettingsStore = {
  load: () => Promise<AppSettings>
  update: (patch: PartialSettings) => Promise<AppSettings>
}

const settingsFileName = 'settings.json'

const mergeSettings = (current: AppSettings, patch: PartialSettings): PartialSettings => ({
  language: patch.language ?? current.language,
  recording: {
    ...current.recording,
    ...(patch.recording ?? {})
  },
  clip: {
    ...current.clip,
    ...(patch.clip ?? {})
  },
  obs: {
    ...current.obs,
    ...(patch.obs ?? {})
  },
  tradeSource: {
    ...current.tradeSource,
    ...(patch.tradeSource ?? {})
  },
  system: {
    ...current.system,
    ...(patch.system ?? {})
  },
  proxyRuntime: {
    ...current.proxyRuntime,
    ...(patch.proxyRuntime ?? {})
  },
  proxies: patch.proxies ?? current.proxies
})

export const createSettingsStore = (appDataDir: string): SettingsStore => {
  const filePath = join(appDataDir, settingsFileName)
  const temporaryPath = `${filePath}.tmp`
  let queue = Promise.resolve()

  const loadUnsafe = async (): Promise<AppSettings> => {
    try {
      const content = await readFile(filePath, 'utf8')
      const parsed = JSON.parse(content) as PartialSettings
      return normalizeSettings(parsed, appDataDir)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return createDefaultSettings(appDataDir)
      }
      throw error
    }
  }

  const save = async (settings: AppSettings): Promise<AppSettings> => {
    await mkdir(appDataDir, { recursive: true })
    await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, filePath)
    return settings
  }

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation)
    queue = result.then(() => undefined, () => undefined)
    return result
  }

  return {
    load: () => enqueue(loadUnsafe),
    update: (patch) => enqueue(async () => {
      const current = await loadUnsafe()
      return save(normalizeSettings(mergeSettings(current, patch), appDataDir))
    })
  }
}
