import { describe, expect, it } from 'vitest'
import type { ProxyRecord } from '../../src/main/services/settings/settings'
import { createProxyNetworkAdvice, findLikelyTunnelInterfaces } from '../../src/main/services/proxies/networkEnvironment'
import { createVpnBypassStatus, createWindowsVpnBypassRouteScript } from '../../src/main/services/proxies/vpnBypassRoutes'
import { createLocalPortBusyMessage, createLocalXrayConfig, createPowerShellExpandArchiveCommand, createXrayReleaseDownloadUrl } from '../../src/main/services/proxies/xrayLocalRuntime'
import { createProxyChainRoute, createXrayServerConfig } from '../../src/main/services/proxies/proxyChainSetup'
import { defaultLocalProxyPort } from '../../src/shared/defaults'

const proxy = (id: string, name: string, server: string): ProxyRecord => ({
  id,
  name,
  server,
  login: 'root',
  passwordConfigured: true,
  nextProxyId: '',
  localProxyPort: defaultLocalProxyPort,
  paymentDueDay: 8,
  dashboardUrl: '',
  notes: ''
})

describe('proxyChainSetup', () => {
  it('builds a readable chain route from ordered proxies', () => {
    expect(createProxyChainRoute([
      proxy('proxy-1', 'Хабаровск', 'khabarovsk.example'),
      proxy('proxy-2', 'Токио', 'tokyo.example')
    ])).toBe('Хабаровск (khabarovsk.example) -> Токио (tokyo.example)')
  })

  it('builds a local Xray config with an HTTP terminal proxy', () => {
    const config = createLocalXrayConfig({
      localPort: defaultLocalProxyPort,
      entryHost: 'khabarovsk.example',
      entryPort: 443,
      entryUuid: '11111111-1111-4111-8111-111111111111'
    }) as {
      inbounds: Array<{ listen: string, port: number, protocol: string }>
      outbounds: Array<{ protocol: string, settings: { vnext: Array<{ address: string, port: number }> } }>
    }

    expect(config.inbounds[0]).toMatchObject({
      listen: '127.0.0.1',
      port: defaultLocalProxyPort,
      protocol: 'http'
    })
    expect(config.outbounds[0].protocol).toBe('vless')
    expect(config.outbounds[0].settings.vnext[0]).toMatchObject({
      address: 'khabarovsk.example',
      port: 443
    })
  })

  it('builds VLESS server config that points entry node to the next node', () => {
    const entry = {
      proxy: proxy('proxy-1', 'Хабаровск', 'khabarovsk.example'),
      host: 'khabarovsk.example',
      listenPort: 443,
      uuid: '11111111-1111-4111-8111-111111111111'
    }
    const exit = {
      proxy: proxy('proxy-2', 'Токио', 'tokyo.example'),
      host: 'tokyo.example',
      listenPort: 443,
      uuid: '22222222-2222-4222-8222-222222222222'
    }
    const config = createXrayServerConfig(entry, exit) as {
      inbounds: Array<{ protocol: string, settings: { decryption: string } }>
      outbounds: Array<{ protocol: string, settings: { vnext: Array<{ address: string, port: number }> } }>
    }

    expect(config.inbounds[0]).toMatchObject({
      protocol: 'vless',
      settings: { decryption: 'none' }
    })
    expect(config.outbounds[0].protocol).toBe('vless')
    expect(config.outbounds[0].settings.vnext[0]).toMatchObject({
      address: 'tokyo.example',
      port: 443
    })
  })

  it('uses Xray release assets for the common desktop platforms', () => {
    expect(createXrayReleaseDownloadUrl('win32', 'x64')).toContain('Xray-windows-64.zip')
    expect(createXrayReleaseDownloadUrl('darwin', 'arm64')).toContain('Xray-macos-arm64-v8a.zip')
  })

  it('builds a Windows archive extraction command without positional PowerShell args', () => {
    const command = createPowerShellExpandArchiveCommand(
      "C:\\Users\\Trader One\\AppData\\Roaming\\tradetools\\downloads\\xray's-core.zip",
      'C:\\Users\\Trader One\\AppData\\Roaming\\tradetools\\xray-core'
    )

    expect(command).not.toContain('$args')
    expect(command).toContain("-LiteralPath 'C:\\Users\\Trader One\\AppData\\Roaming\\tradetools\\downloads\\xray''s-core.zip'")
    expect(command).toContain("-DestinationPath 'C:\\Users\\Trader One\\AppData\\Roaming\\tradetools\\xray-core'")
  })

  it('explains which local process blocks the terminal proxy port', () => {
    const message = createLocalPortBusyMessage(1081, {
      pid: 1234,
      name: 'xraycore',
      path: 'C:\\Users\\Trader\\AppData\\Local\\Temp\\v2RayTun\\xraycore.exe'
    }, 1083)

    expect(message).toContain('127.0.0.1:1081')
    expect(message).toContain('xraycore')
    expect(message).toContain('PID 1234')
    expect(message).toContain('v2RayTun')
    expect(message).toContain('другой локальный proxy-клиент')
    expect(message).toContain('1083')
  })

  it('detects common VPN and tunnel interface names', () => {
    const matches = findLikelyTunnelInterfaces([
      { name: 'Ethernet', description: 'Intel(R) Ethernet Controller' },
      { name: 'vEthernet (WireGuard Tunnel)', description: 'WireGuard Tunnel Adapter' },
      { name: 'Wi-Fi', description: 'Realtek Wireless' }
    ])

    expect(matches).toHaveLength(1)
    expect(matches[0]?.description).toContain('WireGuard')
  })

  it('suggests split tunneling when VPN is likely active', () => {
    const advice = createProxyNetworkAdvice({
      likelyVpnActive: true,
      systemProxyEnabled: true,
      entryHost: '45.77.31.20',
      localPort: 1083
    })

    expect(advice.join('\n')).toContain('split tunneling')
    expect(advice.join('\n')).toContain('45.77.31.20')
    expect(advice.join('\n')).toContain('127.0.0.1:1083')
  })

  it('builds a Windows route script for persistent VPS bypass routes', () => {
    const script = createWindowsVpnBypassRouteScript({
      targets: [
        { host: '92.38.129.126', address: '92.38.129.126' },
        { host: '45.77.31.20', address: '45.77.31.20' }
      ],
      outputPath: 'C:\\Users\\Trader\\AppData\\Roaming\\TradeTools\\vpn-bypass\\result.json'
    })

    expect(script).toContain("Get-NetRoute -DestinationPrefix '0.0.0.0/0'")
    expect(script).toContain('route.exe -p ADD')
    expect(script).toContain('MASK 255.255.255.255')
    expect(script).toContain('METRIC 1 IF $candidate.InterfaceIndex')
    expect(script).toContain('Не перезаписываю чужой маршрут автоматически')
    expect(script).toContain('92.38.129.126')
    expect(script).toContain('45.77.31.20')
  })

  it('allows updating only a route recorded as managed by TradeTools', () => {
    const script = createWindowsVpnBypassRouteScript({
      targets: [{ host: 'entry.example', address: '198.51.100.10' }],
      managedRoutes: [{ address: '198.51.100.10', gateway: '192.168.1.1', interfaceIndex: 5 }],
      outputPath: 'C:\\Users\\Trader\\AppData\\Roaming\\TradeTools\\vpn-bypass\\result.json'
    })

    expect(script).toContain('route.exe DELETE $target.address')
    expect(script).toContain('Persistent route обновлён мимо VPN')
  })

  it('requires UAC only when a TUN route is missing or owned by TradeTools', () => {
    expect(createVpnBypassStatus({
      targets: [{ host: 'entry.example', address: '198.51.100.10' }],
      tunnelActive: true,
      gateway: '192.168.1.1',
      interfaceName: 'Ethernet',
      interfaceIndex: 5,
      routes: [{ address: '198.51.100.10', nextHop: '10.0.0.1', interfaceIndex: 42 }],
      managedRoutes: []
    })).toMatchObject({ state: 'attention', message: expect.stringContaining('Не перезаписываю чужой маршрут') })

    expect(createVpnBypassStatus({
      targets: [{ host: 'entry.example', address: '198.51.100.10' }],
      tunnelActive: true,
      gateway: '192.168.1.1',
      interfaceName: 'Ethernet',
      interfaceIndex: 5,
      routes: [],
      managedRoutes: []
    })).toMatchObject({ state: 'needs-uac' })
  })
})
