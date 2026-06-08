import { randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { ProxyRecord } from '../settings/settings'
import { parseSshEndpoint } from './sshConnectionCheck'

export type VpnBypassRoute = {
  host: string
  address: string
  ok: boolean
  added: boolean
  message: string
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

type ResolvedBypassTarget = {
  host: string
  address: string
}

const powershellLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`

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
  outputPath: string
}): string => {
  const targetsJson = JSON.stringify(input.targets).replace(/'/g, "''")

  return [
    '$ErrorActionPreference = "Stop"',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    `$outputPath = ${powershellLiteral(input.outputPath)}`,
    `$targets = '${targetsJson}' | ConvertFrom-Json`,
    "$tunnelPattern = 'vpn|wireguard|tailscale|zerotier|openvpn|wintun|utun|tun|tap|ppp|ipsec|clash|sing-box|v2ray|outline|nord|proton|surfshark|windscribe|warp|adguard|antizapret|антизапрет|zapret'",
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
    "        $result.routes += [ordered]@{ host = [string]$target.host; address = [string]$target.address; ok = $true; added = $false; message = 'Маршрут уже настроен через обычный gateway' }",
    '      } else {',
    '        $current = $existing | Select-Object -First 1',
    "        $result.routes += [ordered]@{ host = [string]$target.host; address = [string]$target.address; ok = $false; added = $false; message = \"Уже есть /32 маршрут через $($current.NextHop), IF $($current.InterfaceIndex). Не перезаписываю чужой маршрут автоматически.\" }",
    '      }',
    '      continue',
    '    }',
    '    $routeOutput = & route.exe -p ADD $target.address MASK 255.255.255.255 $candidate.NextHop METRIC 1 IF $candidate.InterfaceIndex 2>&1',
    '    if ($LASTEXITCODE -ne 0) { throw (($routeOutput | Out-String).Trim()) }',
    "    $result.routes += [ordered]@{ host = [string]$target.host; address = [string]$target.address; ok = $true; added = $true; message = 'Persistent route добавлен мимо VPN' }",
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
  chain: ProxyRecord[]
  appDataDir: string
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

  const targets = await resolveVpnBypassTargets(input.chain)
  if (targets.length === 0) throw new Error('Нет VPS-адресов для настройки обхода VPN')

  const workDir = join(input.appDataDir, 'vpn-bypass')
  await mkdir(workDir, { recursive: true })
  const id = randomUUID()
  const scriptPath = join(workDir, `configure-${id}.ps1`)
  const outputPath = join(workDir, `result-${id}.json`)
  await writeFile(scriptPath, `\uFEFF${createWindowsVpnBypassRouteScript({ targets, outputPath })}`, 'utf8')

  try {
    await runElevatedWindowsScript(scriptPath)
    const raw = await readFile(outputPath, 'utf8').catch(() => '')
    const json = raw.trim().replace(/^\uFEFF/, '')
    if (!json) throw new Error('Маршруты не были применены: UAC мог быть отменён пользователем.')
    const result = JSON.parse(json) as VpnBypassRouteResult
    return {
      ...result,
      checkedAtMs: Number(result.checkedAtMs) || Date.now()
    }
  } finally {
    await rm(scriptPath, { force: true }).catch(() => undefined)
    await rm(outputPath, { force: true }).catch(() => undefined)
  }
}
