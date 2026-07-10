import { configureVpnBypassRoutes, inspectVpnBypassState, type VpnBypassStatus } from './vpnBypassRoutes'

export type VpnBypassMonitorDependencies = {
  inspect: typeof inspectVpnBypassState
  configure: typeof configureVpnBypassRoutes
}

export type VpnBypassMonitor = {
  start: () => Promise<void>
  stop: () => void
  refresh: (options?: { force?: boolean }) => Promise<VpnBypassStatus>
  getStatus: () => VpnBypassStatus
}

type CreateVpnBypassMonitorInput = {
  appDataDir: string
  configPath: string
  intervalMs?: number
  onStatus: (status: VpnBypassStatus) => void
  dependencies?: VpnBypassMonitorDependencies
}

const idleStatus = (): VpnBypassStatus => ({
  state: 'idle',
  message: 'Проверка VPN bypass ещё не запускалась',
  fingerprint: '',
  targets: [],
  gateway: '',
  interfaceName: '',
  checkedAtMs: Date.now()
})

const cancelledUacStatus = (status: VpnBypassStatus, error: unknown): VpnBypassStatus => ({
  ...status,
  state: 'attention',
  message: error instanceof Error && error.message.includes('UAC')
    ? 'Подтверждение Windows отменено; повторите проверку после смены сети или вручную'
    : error instanceof Error ? error.message : 'Не удалось обновить маршрут VPS'
})

export const createVpnBypassMonitor = (input: CreateVpnBypassMonitorInput): VpnBypassMonitor => {
  const dependencies = input.dependencies ?? {
    inspect: inspectVpnBypassState,
    configure: configureVpnBypassRoutes
  }
  let timer: NodeJS.Timeout | undefined
  let running = false
  let inFlight: Promise<VpnBypassStatus> | undefined
  let dismissedFingerprint = ''
  let status = idleStatus()

  const publish = (next: VpnBypassStatus): VpnBypassStatus => {
    status = next
    if (running) input.onStatus(next)
    return next
  }

  const refresh = (options: { force?: boolean } = {}): Promise<VpnBypassStatus> => {
    if (inFlight) return inFlight
    if (options.force) dismissedFingerprint = ''

    inFlight = (async () => {
      publish({ ...status, state: 'checking', message: 'Проверяем VPN и маршрут к VPS', checkedAtMs: Date.now() })
      const inspected = await dependencies.inspect({ appDataDir: input.appDataDir, configPath: input.configPath })
      if (!running) return inspected
      if (inspected.state !== 'needs-uac') return publish(inspected)
      if (dismissedFingerprint === inspected.fingerprint) return publish(cancelledUacStatus(inspected, new Error('UAC мог быть отменён пользователем')))

      try {
        await dependencies.configure({ appDataDir: input.appDataDir, configPath: input.configPath })
      } catch (error) {
        dismissedFingerprint = inspected.fingerprint
        return publish(cancelledUacStatus(inspected, error))
      }

      const verified = await dependencies.inspect({ appDataDir: input.appDataDir, configPath: input.configPath })
      return running ? publish(verified) : verified
    })().finally(() => {
      inFlight = undefined
    })
    return inFlight
  }

  return {
    async start() {
      if (running) return
      running = true
      await refresh()
      if (running) timer = setInterval(() => void refresh(), input.intervalMs ?? 15_000)
    },
    stop() {
      running = false
      if (timer) clearInterval(timer)
      timer = undefined
    },
    refresh,
    getStatus: () => status
  }
}
