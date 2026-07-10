import { randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { ProxyRecord } from '../settings/settings'
import { parseSshEndpoint } from './sshConnectionCheck'
import { localXrayConfigPath, resolveXrayBypassTargets, type XrayBypassTarget } from './xrayBypassTargets'

export type VpnBypassRoute = {
  host: string
  address: string
  ok: boolean
  added: boolean
  updated?: boolean
  message: string
}

export type ManagedVpnBypassRoute = {
  address: string
  gateway: string
  interfaceIndex: number
}

type ManagedVpnBypassRouteFile = {
  version: 1
  routes: ManagedVpnBypassRoute[]
}

export type VpnBypassRouteResult = {
  ok: boolean
  platform: NodeJS.Platform
  supported: boolean
  gateway: string
  interfaceName: string
  interfaceIndex: number
  routes: VpnBypassRoute[]
  message: string
  checkedAtMs: number
}

export type VpnBypassStatus = {
  state: 'idle' | 'checking' | 'protected' | 'not-required' | 'needs-uac' | 'attention'
  message: string
  fingerprint: string
  targets: XrayBypassTarget[]
  gateway: string
  interfaceName: string
  checkedAtMs: number
}

type ResolvedBypassTarget = XrayBypassTarget

type CurrentVpnBypassRoute = {
  address: string
  nextHop: string
  interfaceIndex: number
}

const tunnelPatternSource = 'vpn|wireguard|tailscale|zerotier|openvpn|wintun|utun|tun|tap|ppp|ipsec|clash|sing-box|v2ray|outline|nord|proton|surfshark|windscribe|warp|adguard|antizapret|антизапрет|zapret'

const powershellLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`

export const createVpnBypassStatus = (input: {
  targets: XrayBypassTarget[]
  tunnelActive: boolean
  gateway: string
  interfaceName: string
  interfaceIndex: number
  routes: CurrentVpnBypassRoute[]
  managedRoutes: ManagedVpnBypassRoute[]
}): VpnBypassStatus => {
  const fingerprint = JSON.stringify({
    targets: input.targets.map((target) => target.address),
    tunnelActive: input.tunnelActive,
    gateway: input.gateway,
    interfaceIndex: input.interfaceIndex,
    routes: input.routes.map((route) => [route.address, route.nextHop, route.interfaceIndex])
  })
  const base = {
    fingerprint,
    targets: input.targets,
    gateway: input.gateway,
    interfaceName: input.interfaceName,
    checkedAtMs: Date.now()
  }
  if (!input.tunnelActive) return { ...base, state: 'not-required', message: 'VPN/TUN не обнаружен: обход не требуется' }
  if (!input.gateway || input.interfaceIndex <= 0) return { ...base, state: 'attention', message: 'Не найден обычный Wi-Fi/Ethernet gateway' }

  const incomplete = input.targets.filter((target) => !input.routes.some((route) => (
    route.address === target.address && route.nextHop === input.gateway && route.interfaceIndex === input.interfaceIndex
  )))
  if (incomplete.length === 0) return { ...base, state: 'protected', message: 'VPS идёт напрямую через обычный gateway' }

  const foreignRoute = incomplete.map((target) => {
    const route = input.routes.find((candidate) => candidate.address === target.address)
    if (!route) return undefined
    const managed = input.managedRoutes.some((candidate) => (
      candidate.address === route.address && candidate.gateway === route.nextHop && candidate.interfaceIndex === route.interfaceIndex
    ))
    return managed ? undefined : route
  }).find(Boolean)
  if (foreignRoute) {
    return {
      ...base,
      state: 'attention',
      message: `Уже есть /32 маршрут через ${foreignRoute.nextHop}, IF ${foreignRoute.interfaceIndex}. Не перезаписываю чужой маршрут автоматически.`
    }
  }
  return { ...base, state: 'needs-uac', message: 'Для прямого маршрута к VPS требуется подтверждение Windows' }
}

const runProcess = async (command: string, args: string[], timeoutMs = 120_000): Promise<{ stdout: string, stderr: string }> => {
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

export const resolveVpnBypassTargets = async (chain: ProxyRecord[]): Promise<ResolvedBypassTarget[]> => {
  const targets = await Promise.all(chain.map(async (proxy) => {
    const endpoint = parseSshEndpoint(proxy.server)
    if (!endpoint.host) throw new Error(`У сервера "${proxy.name || proxy.server || 'сервер'}" не указан IP или домен`)

    if (isIP(endpoint.host) === 4) {
      return {
        host: endpoint.host,
        address: endpoint.host
      }
    }

    const resolved = await lookup(endpoint.host, { family: 4 })
    return {
      host: endpoint.host,
      address: resolved.address
    }
  }))

  const seen = new Set<string>()
  return targets.filter((target) => {
    if (seen.has(target.address)) return false
    seen.add(target.address)
    return true
  })
}

export const createWindowsVpnBypassRouteScript = (input: {
  targets: ResolvedBypassTarget[]
  managedRoutes?: ManagedVpnBypassRoute[]
  outputPath: string
}): string => {
  const targetsJson = JSON.stringify(input.targets).replace(/'/g, "''")
  const managedRoutesJson = JSON.stringify(input.managedRoutes ?? []).replace(/'/g, "''")

  return [
    '$ErrorActionPreference = "Stop"',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    `$outputPath = ${powershellLiteral(input.outputPath)}`,
    `$targets = '${targetsJson}' | ConvertFrom-Json`,
    `$managedRoutes = '${managedRoutesJson}' | ConvertFrom-Json`,
    `$tunnelPattern = '${tunnelPatternSource}'`,
    "$result = [ordered]@{ ok = $false; platform = 'win32'; supported = $true; gateway = ''; interfaceName = ''; interfaceIndex = 0; routes = @(); message = ''; checkedAtMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }",
    'try {',
    "  $routes = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -AddressFamily IPv4 -ErrorAction Stop | Sort-Object RouteMetric, InterfaceMetric",
    '  $candidate = $null',
    '  foreach ($route in $routes) {',
    "    if (-not $route.NextHop -or $route.NextHop -eq '0.0.0.0') { continue }",
    '    $adapter = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue',
    '    if (-not $adapter -or $adapter.Status -ne "Up") { continue }',
    '    $label = "$($adapter.Name) $($adapter.InterfaceDescription)"',
    '    if ($label -match $tunnelPattern) { continue }',
    '    $candidate = [PSCustomObject]@{ NextHop = $route.NextHop; InterfaceIndex = $route.InterfaceIndex; InterfaceName = $adapter.Name; InterfaceDescription = $adapter.InterfaceDescription }',
    '    break',
    '  }',
    '  if (-not $candidate) { throw "Не найден обычный Wi-Fi/Ethernet gateway. Отключите TUN/VPN на минуту или настройте split tunneling в VPN-клиенте." }',
    '  $result.gateway = $candidate.NextHop',
    '  $result.interfaceName = if ($candidate.InterfaceDescription) { "$($candidate.InterfaceName) ($($candidate.InterfaceDescription))" } else { $candidate.InterfaceName }',
    '  $result.interfaceIndex = [int]$candidate.InterfaceIndex',
    '  foreach ($target in $targets) {',
    '    $prefix = "$($target.address)/32"',
    '    $existing = Get-NetRoute -DestinationPrefix $prefix -AddressFamily IPv4 -ErrorAction SilentlyContinue | Sort-Object RouteMetric, InterfaceMetric',
    '    if ($existing) {',
    '      $same = $existing | Where-Object { $_.NextHop -eq $candidate.NextHop -and $_.InterfaceIndex -eq $candidate.InterfaceIndex } | Select-Object -First 1',
    '      if ($same) {',
    "        $result.routes += [ordered]@{ host = [string]$target.host; address = [string]$target.address; ok = $true; added = $false; updated = $false; message = 'Маршрут уже настроен через обычный gateway' }",
    '      } else {',
    '        $managed = $managedRoutes | Where-Object { $_.address -eq $target.address } | Select-Object -First 1',
    '        $owned = if ($managed) { $existing | Where-Object { $_.NextHop -eq $managed.gateway -and $_.InterfaceIndex -eq [int]$managed.interfaceIndex } | Select-Object -First 1 } else { $null }',
    '        if ($owned) {',
    '          $deleteOutput = & route.exe DELETE $target.address MASK 255.255.255.255 $managed.gateway IF $managed.interfaceIndex 2>&1',
    '          if ($LASTEXITCODE -ne 0) { throw (($deleteOutput | Out-String).Trim()) }',
    '          $routeOutput = & route.exe -p ADD $target.address MASK 255.255.255.255 $candidate.NextHop METRIC 1 IF $candidate.InterfaceIndex 2>&1',
    '          if ($LASTEXITCODE -ne 0) { throw (($routeOutput | Out-String).Trim()) }',
    "          $result.routes += [ordered]@{ host = [string]$target.host; address = [string]$target.address; ok = $true; added = $false; updated = $true; message = 'Persistent route обновлён мимо VPN' }",
    '        } else {',
    '          $current = $existing | Select-Object -First 1',
    "          $result.routes += [ordered]@{ host = [string]$target.host; address = [string]$target.address; ok = $false; added = $false; updated = $false; message = \"Уже есть /32 маршрут через $($current.NextHop), IF $($current.InterfaceIndex). Не перезаписываю чужой маршрут автоматически.\" }",
    '        }',
    '      }',
    '      continue',
    '    }',
    '    $routeOutput = & route.exe -p ADD $target.address MASK 255.255.255.255 $candidate.NextHop METRIC 1 IF $candidate.InterfaceIndex 2>&1',
    '    if ($LASTEXITCODE -ne 0) { throw (($routeOutput | Out-String).Trim()) }',
    "    $result.routes += [ordered]@{ host = [string]$target.host; address = [string]$target.address; ok = $true; added = $true; updated = $false; message = 'Persistent route добавлен мимо VPN' }",
    '  }',
    '  $failed = @($result.routes | Where-Object { -not $_.ok })',
    '  $result.ok = $failed.Count -eq 0',
    "  $result.message = if ($result.ok) { 'Обход VPN для VPS настроен. Перезапустите локальный proxy/связку и терминал, если пинг не изменился сразу.' } else { 'Часть маршрутов не была изменена. Проверьте строки с ошибками.' }",
    '} catch {',
    '  $result.ok = $false',
    '  $result.message = $_.Exception.Message',
    '} finally {',
    '  $result | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath $outputPath',
    '}'
  ].join('\n')
}

const managedRoutesPath = (appDataDir: string): string => join(appDataDir, 'vpn-bypass', 'routes.json')

const loadManagedRoutes = async (appDataDir: string): Promise<ManagedVpnBypassRoute[]> => {
  try {
    const parsed = JSON.parse(await readFile(managedRoutesPath(appDataDir), 'utf8')) as Partial<ManagedVpnBypassRouteFile>
    if (parsed.version !== 1 || !Array.isArray(parsed.routes)) return []
    return parsed.routes.filter((route): route is ManagedVpnBypassRoute => (
      typeof route?.address === 'string' && typeof route.gateway === 'string' && Number.isInteger(route.interfaceIndex)
    ))
  } catch {
    return []
  }
}

const saveManagedRoutes = async (appDataDir: string, routes: ManagedVpnBypassRoute[]): Promise<void> => {
  const path = managedRoutesPath(appDataDir)
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify({ version: 1, routes } satisfies ManagedVpnBypassRouteFile, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

const parseJsonObject = <T>(text: string): T => JSON.parse(text.trim().replace(/^\uFEFF/, '')) as T

export const inspectVpnBypassState = async (input: {
  appDataDir: string
  configPath?: string
}): Promise<VpnBypassStatus> => {
  const targets = await resolveXrayBypassTargets(input.configPath ?? localXrayConfigPath(input.appDataDir))
  if (process.platform !== 'win32') {
    return {
      state: 'attention',
      message: 'Автоматический обход VPN сейчас реализован только для Windows',
      fingerprint: JSON.stringify({ platform: process.platform, targets: targets.map((target) => target.address) }),
      targets,
      gateway: '',
      interfaceName: '',
      checkedAtMs: Date.now()
    }
  }

  const targetsJson = JSON.stringify(targets).replace(/'/g, "''")
  const script = [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    `$targets = '${targetsJson}' | ConvertFrom-Json`,
    `$tunnelPattern = '${tunnelPatternSource}'`,
    '$adapters = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq "Up" }',
    '$tunnelActive = @($adapters | Where-Object { "$($_.Name) $($_.InterfaceDescription)" -match $tunnelPattern }).Count -gt 0',
    "$defaultRoutes = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -AddressFamily IPv4 -ErrorAction SilentlyContinue | Sort-Object RouteMetric, InterfaceMetric",
    '$candidate = $null',
    'foreach ($route in $defaultRoutes) {',
    "  if (-not $route.NextHop -or $route.NextHop -eq '0.0.0.0') { continue }",
    '  $adapter = $adapters | Where-Object { $_.ifIndex -eq $route.InterfaceIndex } | Select-Object -First 1',
    '  if (-not $adapter -or "$($adapter.Name) $($adapter.InterfaceDescription)" -match $tunnelPattern) { continue }',
    '  $candidate = [PSCustomObject]@{ gateway = $route.NextHop; interfaceName = $adapter.Name; interfaceIndex = [int]$route.InterfaceIndex }',
    '  break',
    '}',
    '$targetRoutes = foreach ($target in $targets) {',
    '  $route = Get-NetRoute -DestinationPrefix "$($target.address)/32" -AddressFamily IPv4 -ErrorAction SilentlyContinue | Sort-Object RouteMetric, InterfaceMetric | Select-Object -First 1',
    '  if ($route) { [PSCustomObject]@{ address = [string]$target.address; nextHop = [string]$route.NextHop; interfaceIndex = [int]$route.InterfaceIndex } }',
    '}',
    '[PSCustomObject]@{ tunnelActive = $tunnelActive; gateway = if ($candidate) { $candidate.gateway } else { "" }; interfaceName = if ($candidate) { $candidate.interfaceName } else { "" }; interfaceIndex = if ($candidate) { $candidate.interfaceIndex } else { 0 }; routes = @($targetRoutes) } | ConvertTo-Json -Compress'
  ].join('; ')
  const result = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 8_000)
  const snapshot = parseJsonObject<{
    tunnelActive?: unknown
    gateway?: unknown
    interfaceName?: unknown
    interfaceIndex?: unknown
    routes?: CurrentVpnBypassRoute[]
  }>(result.stdout)
  return createVpnBypassStatus({
    targets,
    tunnelActive: snapshot.tunnelActive === true,
    gateway: typeof snapshot.gateway === 'string' ? snapshot.gateway : '',
    interfaceName: typeof snapshot.interfaceName === 'string' ? snapshot.interfaceName : '',
    interfaceIndex: Number(snapshot.interfaceIndex) || 0,
    routes: Array.isArray(snapshot.routes) ? snapshot.routes : [],
    managedRoutes: await loadManagedRoutes(input.appDataDir)
  })
}

const runElevatedWindowsScript = async (scriptPath: string): Promise<void> => {
  const command = [
    'Start-Process',
    '-FilePath powershell.exe',
    `-ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',${powershellLiteral(scriptPath)}`,
    '-Verb RunAs',
    '-Wait'
  ].join(' ')

  await runProcess('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], 180_000)
}

export const configureVpnBypassRoutes = async (input: {
  appDataDir: string
  configPath?: string
  chain?: ProxyRecord[]
}): Promise<VpnBypassRouteResult> => {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      platform: process.platform,
      supported: false,
      gateway: '',
      interfaceName: '',
      interfaceIndex: 0,
      routes: [],
      message: 'Автоматический обход VPN сейчас реализован только для Windows. На macOS добавьте host routes до VPS через обычный gateway вручную.',
      checkedAtMs: Date.now()
    }
  }

  const targets = await resolveXrayBypassTargets(input.configPath ?? localXrayConfigPath(input.appDataDir))
  if (targets.length === 0) throw new Error('Нет VPS-адресов для настройки обхода VPN')

  const workDir = join(input.appDataDir, 'vpn-bypass')
  await mkdir(workDir, { recursive: true })
  const managedRoutes = await loadManagedRoutes(input.appDataDir)
  const id = randomUUID()
  const scriptPath = join(workDir, `configure-${id}.ps1`)
  const outputPath = join(workDir, `result-${id}.json`)
  await writeFile(scriptPath, `\uFEFF${createWindowsVpnBypassRouteScript({ targets, managedRoutes, outputPath })}`, 'utf8')

  try {
    await runElevatedWindowsScript(scriptPath)
    const raw = await readFile(outputPath, 'utf8').catch(() => '')
    const json = raw.trim().replace(/^\uFEFF/, '')
    if (!json) throw new Error('Маршруты не были применены: UAC мог быть отменён пользователем.')
    const result = JSON.parse(json) as VpnBypassRouteResult
    const normalized = {
      ...result,
      checkedAtMs: Number(result.checkedAtMs) || Date.now()
    }
    if (normalized.gateway && normalized.interfaceIndex > 0) {
      const updatedByAddress = new Map(managedRoutes.map((route) => [route.address, route]))
      for (const route of normalized.routes) {
        if (route.ok && (route.added || route.updated)) {
          updatedByAddress.set(route.address, {
            address: route.address,
            gateway: normalized.gateway,
            interfaceIndex: normalized.interfaceIndex
          })
        }
      }
      await saveManagedRoutes(input.appDataDir, [...updatedByAddress.values()])
    }
    return normalized
  } finally {
    await rm(scriptPath, { force: true }).catch(() => undefined)
    await rm(outputPath, { force: true }).catch(() => undefined)
  }
}
