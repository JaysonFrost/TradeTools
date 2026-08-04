import { EventEmitter } from 'node:events'
import type { UpdateInfo } from 'electron-updater'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppUpdateService, isSameAppVersion } from '../../src/main/services/updates/appUpdateService'

type ServiceInput = Parameters<typeof createAppUpdateService>[0]
type UpdaterInput = NonNullable<ServiceInput['updater']>

const updateInfo = (version: string): UpdateInfo => ({
  version,
  files: [],
  path: `TradeTools-${version}.exe`,
  sha512: 'test',
  releaseDate: '2026-08-04T00:00:00.000Z'
})

const createUpdater = () => {
  const emitter = new EventEmitter()
  const checkForUpdates = vi.fn(async () => null)
  const downloadUpdate = vi.fn(async () => [])
  const quitAndInstall = vi.fn()
  const updater = Object.assign(emitter, {
    forceDevUpdateConfig: false,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    setFeedURL: vi.fn(),
    checkForUpdates,
    downloadUpdate,
    quitAndInstall
  }) as unknown as UpdaterInput

  return { emitter, updater, checkForUpdates, downloadUpdate, quitAndInstall }
}

const createService = (overrides: Partial<ServiceInput> = {}) => {
  const updater = createUpdater()
  const service = createAppUpdateService({
    currentVersion: '0.4.7',
    isPackaged: true,
    isInstalledBuild: true,
    hasUpdateConfig: true,
    platform: 'win32',
    broadcast: () => undefined,
    updater: updater.updater,
    ...overrides
  })

  return { service, updater }
}

describe('appUpdateService', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('treats v-prefixed and build-qualified versions as the installed version', () => {
    expect(isSameAppVersion('v0.4.7+release.2', '0.4.7')).toBe(true)
    expect(isSameAppVersion('0.4.8', '0.4.7')).toBe(false)
  })

  it('suppresses a repeated offer for the installed version', () => {
    const onUpdateAvailable = vi.fn()
    const { service, updater } = createService({ onUpdateAvailable })

    updater.emitter.emit('update-available', updateInfo('0.4.7+rebuilt'))

    expect(service.getStatus()).toMatchObject({
      status: 'not-available',
      currentVersion: '0.4.7',
      version: '0.4.7+rebuilt'
    })
    expect(onUpdateAvailable).not.toHaveBeenCalled()
  })

  it('opens the release page for unsigned macOS updates', async () => {
    const openManualDownload = vi.fn(async () => undefined)
    const { service, updater } = createService({
      platform: 'darwin',
      openManualDownload
    })

    updater.emitter.emit('update-available', updateInfo('0.4.8'))
    expect(service.getStatus()).toMatchObject({ status: 'available', manualInstall: true })

    await service.downloadUpdate()

    expect(openManualDownload).toHaveBeenCalledOnce()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('waits for background cleanup and runs the Windows installer silently', async () => {
    vi.useFakeTimers()
    let finishCleanup: (() => void) | undefined
    const beforeInstall = vi.fn(() => new Promise<void>((resolve) => {
      finishCleanup = resolve
    }))
    const { service, updater } = createService({ beforeInstall })
    updater.emitter.emit('update-downloaded', updateInfo('0.4.8'))

    const installPromise = service.installUpdate()
    await Promise.resolve()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    finishCleanup?.()
    await installPromise
    await vi.advanceTimersByTimeAsync(250)

    expect(beforeInstall).toHaveBeenCalledOnce()
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })
})
