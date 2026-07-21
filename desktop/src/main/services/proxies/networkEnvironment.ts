import { spawn } from 'node:child_process'

export type NetworkDiagnosticStatus = 'ok' | 'warning' | 'info'

export type NetworkEnvironmentDiagnostic = {
  name: string
  status: NetworkDiagnosticStatus
  message: string
}

export type NetworkEnvironmentSnapshot = {
  likelyVpnActive: boolean
  systemProxyEnabled: boolean
  routeInterface: string
  routeRemoteAddress: string
  diagnostics: NetworkEnvironmentDiagnostic[]
  advice: string[]
  checkedAtMs: number
}

type CommandResult = {
  stdout: string
  stderr: string
}

type NetworkInterfaceHint = {
  name: string
  description: string
}

type RouteHint = {
  remoteAddress: string
  interfaceName: string
  interfaceDescription: string
  sourceAddress: string
  nextHop: string
}

type SystemProxyHint = {
  enabled: boolean
  message: string
}

const tunnelPattern = /(vpn|wireguard|tailscale|zerotier|openvpn|wintun|utun|tun|tap|ppp|ipsec|clash|sing-box|v2ray|outline|nord|proton|surfshark|windscribe|warp|adguard|antizapret|антизапрет|zapret)/i

const emptySnapshot = (message: string): NetworkEnvironmentSnapshot => ({
  likelyVpnActive: false,
  systemProxyEnabled: false,
  routeInterface: '',
  routeRemoteAddress: '',
  diagnostics: [
    {
      name: 'Сетевое окружение',
      status: 'info',
      message
    }
  ],
  advice: [],
  checkedAtMs: Date.now()
})

const runProcess = async (command: string, args: string[], timeoutMs = 6_000): Promise<CommandResult> => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: 'pipe'
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error(`${command} timeout`))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }

      reject(new Error(stderr.trim() || stdout.trim() || `${command} failed with code ${code ?? 'unknown'}`))
    })
  })
}

const psLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`

const parseJsonArray = <T>(text: string): T[] => {
  const trimmed = text.trim()
  if (!trimmed) return []

  const parsed = JSON.parse(trimmed) as T | T[]
  return Array.isArray(parsed) ? parsed : [parsed]
}

const normalizeText = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

export const findLikelyTunnelInterfaces = (interfaces: NetworkInterfaceHint[]): NetworkInterfaceHint[] => {
  return interfaces.filter((item) => tunnelPattern.test(`${item.name} ${item.description}`)).slice(0, 5)
}

const routeLooksLikeTunnel = (route?: RouteHint): boolean => {
  if (!route) return false
  return tunnelPattern.test(`${route.interfaceName} ${route.interfaceDescription}`)
}

export const createProxyNetworkAdvice = (input: {
  likelyVpnActive: boolean
  systemProxyEnabled: boolean
  entryHost?: string
  localPort?: number
}): string[] => {
  const advice: string[] = []

  if (input.likelyVpnActive) {
    advice.push('В VPN/антизапрет-клиенте включите split tunneling и исключите TradeTools и локальный Xray core из туннеля.')
    if (input.entryHost) advice.push(`Если VPN поддерживает правила маршрута, отправьте IP первого VPS (${input.entryHost}) напрямую, не через VPN.`)
  }

  if (input.systemProxyEnabled) {
    advice.push('Если включён системный proxy/PAC, добавьте 127.0.0.1 в bypass и не проксируйте локальный порт TradeTools.')
  }

  advice.push(`В торговом терминале укажите выбранный локальный proxy 127.0.0.1:${input.localPort ?? 1083}; внутри терминала не включайте второй VPN/proxy для этого же подключения.`)

  return advice
}

const inspectWindowsAdapters = async (): Promise<NetworkInterfaceHint[]> => {
  const script = [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    '$items = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq "Up" } | Select-Object Name, InterfaceDescription',
    '$items | ConvertTo-Json -Compress'
  ].join('; ')
  const result = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
  return parseJsonArray<{ Name?: unknown, InterfaceDescription?: unknown }>(result.stdout).map((item) => ({
    name: normalizeText(item.Name),
    description: normalizeText(item.InterfaceDescription)
  }))
}

const inspectWindowsSystemProxy = async (): Promise<SystemProxyHint> => {
  const script = [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    '$settings = Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -ErrorAction SilentlyContinue',
    '[PSCustomObject]@{ ProxyEnable = $settings.ProxyEnable; ProxyServer = $settings.ProxyServer; AutoConfigURL = $settings.AutoConfigURL } | ConvertTo-Json -Compress'
  ].join('; ')
  const result = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
  const [proxy] = parseJsonArray<{ ProxyEnable?: unknown, ProxyServer?: unknown, AutoConfigURL?: unknown }>(result.stdout)
  const proxyEnabled = Number(proxy?.ProxyEnable) === 1
  const proxyServer = normalizeText(proxy?.ProxyServer)
  const pacUrl = normalizeText(proxy?.AutoConfigURL)
  const enabled = proxyEnabled || Boolean(pacUrl)

  return {
    enabled,
    message: enabled
      ? `Включён системный proxy${proxyServer ? `: ${proxyServer}` : ''}${pacUrl ? `, PAC: ${pacUrl}` : ''}`
      : 'Системный proxy Windows не включён'
  }
}

const inspectWindowsRoute = async (entryHost?: string): Promise<RouteHint | undefined> => {
  if (!entryHost) return undefined

  const script = [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    '$ErrorActionPreference = "Stop"',
    `$hostName = ${psLiteral(entryHost)}`,
    '$address = [System.Net.Dns]::GetHostAddresses($hostName) | Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork } | Select-Object -First 1',
    'if (-not $address) { throw "IPv4 address not found" }',
    '$route = Find-NetRoute -RemoteIPAddress $address.IPAddressToString | Sort-Object RouteMetric, InterfaceMetric | Select-Object -First 1',
    '$adapter = if ($route) { Get-NetAdapter -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue } else { $null }',
    '[PSCustomObject]@{ remoteAddress = $address.IPAddressToString; interfaceName = $route.InterfaceAlias; interfaceDescription = $adapter.InterfaceDescription; sourceAddress = $route.SourceAddress; nextHop = $route.NextHop } | ConvertTo-Json -Compress'
  ].join('; ')
  const result = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 8_000)
  const [route] = parseJsonArray<Partial<RouteHint>>(result.stdout)
  if (!route) return undefined

  return {
    remoteAddress: normalizeText(route.remoteAddress),
    interfaceName: normalizeText(route.interfaceName),
    interfaceDescription: normalizeText(route.interfaceDescription),
    sourceAddress: normalizeText(route.sourceAddress),
    nextHop: normalizeText(route.nextHop)
  }
}

const inspectMacSystemProxy = async (): Promise<SystemProxyHint> => {
  const result = await runProcess('scutil', ['--proxy'])
  const text = result.stdout
  const enabled = /(?:HTTPEnable|HTTPSEnable|SOCKSEnable|ProxyAutoConfigEnable)\s*:\s*1/.test(text)
  const proxy = text.match(/(?:HTTPProxy|HTTPSProxy|SOCKSProxy)\s*:\s*(.+)/)?.[1]?.trim()
  const pac = text.match(/ProxyAutoConfigURLString\s*:\s*(.+)/)?.[1]?.trim()

  return {
    enabled,
    message: enabled
      ? `Включён системный proxy${proxy ? `: ${proxy}` : ''}${pac ? `, PAC: ${pac}` : ''}`
      : 'Системный proxy macOS не включён'
  }
}

const inspectUnixRoute = async (entryHost?: string): Promise<RouteHint | undefined> => {
  if (!entryHost) return undefined

  if (process.platform === 'darwin') {
    const result = await runProcess('route', ['-n', 'get', entryHost], 6_000)
    return {
      remoteAddress: result.stdout.match(/\bdestination:\s*(.+)/)?.[1]?.trim() || entryHost,
      interfaceName: result.stdout.match(/\binterface:\s*(.+)/)?.[1]?.trim() || '',
      interfaceDescription: '',
      sourceAddress: '',
      nextHop: result.stdout.match(/\bgateway:\s*(.+)/)?.[1]?.trim() || ''
    }
  }

  const result = await runProcess('ip', ['route', 'get', entryHost], 6_000)
  return {
    remoteAddress: result.stdout.trim().match(/^([^\s]+)/)?.[1]?.trim() || entryHost,
    interfaceName: result.stdout.match(/\bdev\s+([^\s]+)/)?.[1]?.trim() || '',
    interfaceDescription: '',
    sourceAddress: result.stdout.match(/\bsrc\s+([^\s]+)/)?.[1]?.trim() || '',
    nextHop: result.stdout.match(/\bvia\s+([^\s]+)/)?.[1]?.trim() || ''
  }
}

const inspectUnixAdapters = async (): Promise<NetworkInterfaceHint[]> => {
  if (process.platform === 'darwin') {
    const result = await runProcess('ifconfig', [])
    const matches = [...result.stdout.matchAll(/^([a-z0-9_.-]+):\s+flags=.*\bUP\b.*$/gim)]
    return matches.map((match) => ({
      name: match[1] ?? '',
      description: ''
    }))
  }

  const result = await runProcess('ip', ['-o', 'link', 'show', 'up'])
  return result.stdout.split('\n').flatMap((line) => {
    const match = line.match(/^\d+:\s+([^:]+):/)
    return match ? [{ name: match[1]?.trim() ?? '', description: '' }] : []
  })
}

const inspectLinuxSystemProxy = async (): Promise<SystemProxyHint> => {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || process.env.https_proxy || process.env.http_proxy || process.env.all_proxy || ''
  return {
    enabled: Boolean(proxy),
    message: proxy ? `В окружении включён proxy: ${proxy}` : 'Proxy-переменные окружения не заданы'
  }
}

const safeInspect = async <T>(reader: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await reader()
  } catch {
    return fallback
  }
}

export const inspectProxyNetworkEnvironment = async (input: {
  entryHost?: string
  localPort?: number
} = {}): Promise<NetworkEnvironmentSnapshot> => {
  try {
    const [interfaces, systemProxy, route] = await Promise.all([
      safeInspect(
        () => process.platform === 'win32' ? inspectWindowsAdapters() : inspectUnixAdapters(),
        []
      ),
      safeInspect(
        () => process.platform === 'win32'
          ? inspectWindowsSystemProxy()
          : process.platform === 'darwin'
            ? inspectMacSystemProxy()
            : inspectLinuxSystemProxy(),
        { enabled: false, message: 'Не удалось проверить системный proxy' }
      ),
      safeInspect(
        () => process.platform === 'win32' ? inspectWindowsRoute(input.entryHost) : inspectUnixRoute(input.entryHost),
        undefined
      )
    ])

    const tunnelInterfaces = findLikelyTunnelInterfaces(interfaces)
    const routeTunnel = routeLooksLikeTunnel(route)
    const likelyVpnActive = tunnelInterfaces.length > 0 || routeTunnel
    const routeDescription = route?.interfaceName
      ? `${route.interfaceName}${route.interfaceDescription ? ` (${route.interfaceDescription})` : ''}`
      : ''
    const diagnostics: NetworkEnvironmentDiagnostic[] = [
      {
        name: 'VPN / туннели',
        status: likelyVpnActive ? 'warning' : 'ok',
        message: likelyVpnActive
          ? `Найден активный VPN/туннель: ${[
              ...tunnelInterfaces.map((item) => item.description ? `${item.name} (${item.description})` : item.name),
              routeTunnel && routeDescription ? `маршрут к VPS через ${routeDescription}` : ''
            ].filter(Boolean).join(', ')}`
          : 'Явных активных VPN/туннелей не найдено'
      },
      {
        name: 'Системный proxy',
        status: systemProxy.enabled ? 'warning' : 'ok',
        message: systemProxy.message
      }
    ]

    if (route) {
      diagnostics.push({
        name: 'Маршрут к первому VPS',
        status: routeTunnel ? 'warning' : 'info',
        message: routeDescription
          ? `${route.remoteAddress || input.entryHost || 'VPS'} через ${routeDescription}${route.sourceAddress ? `, source ${route.sourceAddress}` : ''}`
          : 'Не удалось определить интерфейс маршрута'
      })
    } else if (input.entryHost) {
      diagnostics.push({
        name: 'Маршрут к первому VPS',
        status: 'info',
        message: 'Не удалось определить интерфейс маршрута автоматически'
      })
    }

    return {
      likelyVpnActive,
      systemProxyEnabled: systemProxy.enabled,
      routeInterface: routeDescription,
      routeRemoteAddress: route?.remoteAddress ?? '',
      diagnostics,
      advice: createProxyNetworkAdvice({
        likelyVpnActive,
        systemProxyEnabled: systemProxy.enabled,
        entryHost: input.entryHost,
        localPort: input.localPort
      }),
      checkedAtMs: Date.now()
    }
  } catch (error) {
    return emptySnapshot(error instanceof Error ? error.message : 'Не удалось проверить сетевое окружение')
  }
}
