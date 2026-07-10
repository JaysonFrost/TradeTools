import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVpnBypassMonitor, type VpnBypassMonitorDependencies } from '../../src/main/services/proxies/vpnBypassMonitor'
import type { VpnBypassStatus } from '../../src/main/services/proxies/vpnBypassRoutes'

const needsUac = (fingerprint: string): VpnBypassStatus => ({
  state: 'needs-uac',
  message: 'Для прямого маршрута к VPS требуется подтверждение Windows',
  fingerprint,
  targets: [{ host: 'entry.example', address: '198.51.100.10' }],
  gateway: '192.168.1.1',
  interfaceName: 'Ethernet',
  checkedAtMs: 1
})

afterEach(() => vi.useRealTimers())

describe('vpnBypassMonitor', () => {
  it('suppresses cancelled UAC until the network fingerprint changes', async () => {
    vi.useFakeTimers()
    const inspect = vi.fn()
      .mockResolvedValueOnce(needsUac('wifi-1'))
      .mockResolvedValueOnce(needsUac('wifi-1'))
      .mockResolvedValueOnce(needsUac('wifi-2'))
    const configure = vi.fn().mockRejectedValue(new Error('UAC мог быть отменён пользователем'))
    const dependencies: VpnBypassMonitorDependencies = { inspect, configure }
    const monitor = createVpnBypassMonitor({
      appDataDir: 'C:\\TradeTools',
      configPath: 'C:\\TradeTools\\xray-runtime\\trade-chain.json',
      intervalMs: 15_000,
      onStatus: () => undefined,
      dependencies
    })

    await monitor.start()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(configure).toHaveBeenCalledTimes(2)
    monitor.stop()
  })

  it('does not schedule a new check after stop', async () => {
    vi.useFakeTimers()
    const inspect = vi.fn().mockResolvedValue(needsUac('wifi-1'))
    const configure = vi.fn().mockRejectedValue(new Error('UAC мог быть отменён пользователем'))
    const monitor = createVpnBypassMonitor({
      appDataDir: 'C:\\TradeTools',
      configPath: 'C:\\TradeTools\\xray-runtime\\trade-chain.json',
      intervalMs: 15_000,
      onStatus: () => undefined,
      dependencies: { inspect, configure }
    })

    await monitor.start()
    monitor.stop()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(inspect).toHaveBeenCalledTimes(1)
  })
})
