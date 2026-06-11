import electronUpdater, { type ProgressInfo, type UpdateInfo } from 'electron-updater'

const { autoUpdater } = electronUpdater

export type AppUpdateStatusKind =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

export type AppUpdateStatus = {
  status: AppUpdateStatusKind
  currentVersion: string
  version?: string
  releaseName?: string
  releaseDate?: string
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  message: string
}

export type AppUpdateService = {
  getStatus: () => AppUpdateStatus
  checkForUpdates: () => Promise<AppUpdateStatus>
  downloadUpdate: () => Promise<AppUpdateStatus>
  installUpdate: () => AppUpdateStatus
  startBackgroundCheck: () => void
}

type AppUpdateServiceInput = {
  currentVersion: string
  isPackaged: boolean
  isInstalledBuild: boolean
  hasUpdateConfig: boolean
  platform: NodeJS.Platform
  broadcast: (status: AppUpdateStatus) => void
  onUpdateAvailable?: (status: AppUpdateStatus) => void
}

const supportedPlatforms = new Set<NodeJS.Platform>(['win32', 'darwin'])
const githubFeed = {
  provider: 'github' as const,
  owner: 'JaysonFrost',
  repo: 'TradeTools'
}

const toUpdateFields = (info?: UpdateInfo): Pick<AppUpdateStatus, 'version' | 'releaseName' | 'releaseDate'> => ({
  ...(info?.version ? { version: info.version } : {}),
  ...(info?.releaseName ? { releaseName: info.releaseName } : {}),
  ...(info?.releaseDate ? { releaseDate: info.releaseDate } : {})
})

const toProgressFields = (progress: ProgressInfo): Pick<AppUpdateStatus, 'percent' | 'transferred' | 'total' | 'bytesPerSecond'> => ({
  percent: Number.isFinite(progress.percent) ? Math.round(progress.percent) : 0,
  transferred: progress.transferred,
  total: progress.total,
  bytesPerSecond: progress.bytesPerSecond
})

const toErrorMessage = (error: unknown): string => error instanceof Error ? error.message : 'Не удалось проверить обновления'

export const createAppUpdateService = ({
  currentVersion,
  isPackaged,
  isInstalledBuild,
  hasUpdateConfig,
  platform,
  broadcast,
  onUpdateAvailable
}: AppUpdateServiceInput): AppUpdateService => {
  const updatesSupported = supportedPlatforms.has(platform)
  const updatesEnabled = updatesSupported && (isPackaged || isInstalledBuild || hasUpdateConfig)
  const forceConfigForUnpackagedBuild = updatesEnabled && !isPackaged
  let lastUpdateInfo: UpdateInfo | undefined
  let checking = false
  let downloading = false
  let backgroundCheckStarted = false
  let notifiedUpdateVersion = ''
  let status: AppUpdateStatus = updatesEnabled
    ? {
        status: 'idle',
        currentVersion,
        message: 'Автообновления готовы'
      }
    : {
        status: 'disabled',
        currentVersion,
        message: updatesSupported
          ? 'Автообновления доступны только в установленной сборке TradeTools'
          : 'Автообновления поддерживаются только на Windows и macOS'
      }

  const setStatus = (nextStatus: AppUpdateStatus) => {
    status = nextStatus
    broadcast(status)
  }

  const setEnabledStatus = (patch: Omit<AppUpdateStatus, 'currentVersion'>) => {
    setStatus({
      currentVersion,
      ...patch
    })
  }

  if (updatesEnabled) {
    if (forceConfigForUnpackagedBuild) {
      autoUpdater.forceDevUpdateConfig = true
    }
    autoUpdater.setFeedURL(githubFeed)
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false

    autoUpdater.on('checking-for-update', () => {
      checking = true
      setEnabledStatus({
        status: 'checking',
        message: 'Проверяем обновления...'
      })
    })

    autoUpdater.on('update-available', (info) => {
      checking = false
      lastUpdateInfo = info
      const nextStatus: Omit<AppUpdateStatus, 'currentVersion'> = {
        status: 'available',
        ...toUpdateFields(info),
        message: `Доступна новая версия TradeTools ${info.version}`
      }
      setEnabledStatus(nextStatus)

      if (info.version && notifiedUpdateVersion !== info.version) {
        notifiedUpdateVersion = info.version
        onUpdateAvailable?.({
          currentVersion,
          ...nextStatus
        })
      }
    })

    autoUpdater.on('update-not-available', (info) => {
      checking = false
      lastUpdateInfo = info
      setEnabledStatus({
        status: 'not-available',
        ...toUpdateFields(info),
        message: 'У вас уже установлена последняя версия'
      })
    })

    autoUpdater.on('download-progress', (progress) => {
      setEnabledStatus({
        status: 'downloading',
        ...toUpdateFields(lastUpdateInfo),
        ...toProgressFields(progress),
        message: `Скачиваем обновление${lastUpdateInfo?.version ? ` ${lastUpdateInfo.version}` : ''}`
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      downloading = false
      lastUpdateInfo = info
      setEnabledStatus({
        status: 'downloaded',
        ...toUpdateFields(info),
        percent: 100,
        message: `Обновление ${info.version} скачано. Перезапустите приложение, чтобы установить его.`
      })
    })

    autoUpdater.on('error', (error) => {
      checking = false
      downloading = false
      setEnabledStatus({
        status: 'error',
        ...toUpdateFields(lastUpdateInfo),
        message: toErrorMessage(error)
      })
    })
  }

  const ensureEnabled = () => {
    if (!updatesEnabled) {
      setStatus(status)
      return false
    }

    return true
  }

  const checkForUpdates = async (): Promise<AppUpdateStatus> => {
    if (!ensureEnabled()) return status
    if (checking || downloading) return status

    checking = true
    setEnabledStatus({
      status: 'checking',
      message: 'Проверяем обновления...'
    })

    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      checking = false
      setEnabledStatus({
        status: 'error',
        ...toUpdateFields(lastUpdateInfo),
        message: toErrorMessage(error)
      })
    }

    return status
  }

  const downloadUpdate = async (): Promise<AppUpdateStatus> => {
    if (!ensureEnabled()) return status
    if (downloading) return status
    if (!lastUpdateInfo || status.status !== 'available') {
      setEnabledStatus({
        status: 'error',
        ...toUpdateFields(lastUpdateInfo),
        message: 'Сначала проверьте наличие обновления'
      })
      return status
    }

    downloading = true
    setEnabledStatus({
      status: 'downloading',
      ...toUpdateFields(lastUpdateInfo),
      percent: 0,
      message: `Скачиваем обновление ${lastUpdateInfo.version}`
    })

    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      downloading = false
      setEnabledStatus({
        status: 'error',
        ...toUpdateFields(lastUpdateInfo),
        message: toErrorMessage(error)
      })
    }

    return status
  }

  const installUpdate = (): AppUpdateStatus => {
    if (!ensureEnabled()) return status
    if (status.status !== 'downloaded') {
      setEnabledStatus({
        status: 'error',
        ...toUpdateFields(lastUpdateInfo),
        message: 'Обновление ещё не скачано'
      })
      return status
    }

    setEnabledStatus({
      status: 'installing',
      ...toUpdateFields(lastUpdateInfo),
      percent: 100,
      message: 'Перезапускаем TradeTools и устанавливаем обновление...'
    })
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 250)
    return status
  }

  const startBackgroundCheck = () => {
    if (!updatesEnabled || backgroundCheckStarted) return
    backgroundCheckStarted = true
    setTimeout(() => {
      void checkForUpdates()
    }, 7_500)
  }

  return {
    getStatus: () => status,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    startBackgroundCheck
  }
}
