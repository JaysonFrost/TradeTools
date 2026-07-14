import { createWriteStream } from 'node:fs'
import { access, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { get as httpsGet } from 'node:https'
import { arch, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, connect as netConnect } from 'node:net'
import { localXrayConfigPath } from './xrayBypassTargets'

type RuntimeProgress = {
  step: string
  status: 'running' | 'success' | 'error' | 'info'
  message: string
}

type LocalPortOwner = {
  pid: number
  name?: string
  path?: string
  commandLine?: string
}

export type LocalProxyDiagnostic = {
  name: string
  ok: boolean
  message: string
}

export type LocalXrayRuntimeInput = {
  appDataDir: string
  localPort: number
  entryHost: string
  entryPort: number
  entryUuid: string
  keepRunningAfterClose?: boolean
  onProgress?: (progress: RuntimeProgress) => void
}

export type LocalXrayRuntimeResult = {
  host: '127.0.0.1'
  port: number
  type: 'HTTP'
  username: ''
  password: ''
  authRequired: false
  diagnostics: LocalProxyDiagnostic[]
}

let localXrayProcess: ChildProcess | undefined

const userAgent = 'TradeTools/0.1 Xray bootstrap'
const xrayExecutableName = process.platform === 'win32' ? 'xray.exe' : 'xray'

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const runProcess = async (command: string, args: string[], timeoutMs = 60_000): Promise<{ stdout: string, stderr: string }> => {
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

const canRunXray = async (path: string): Promise<boolean> => {
  try {
    await runProcess(path, ['version'], 8_000)
    return true
  } catch {
    return false
  }
}

const resolveExistingXray = async (appDataDir: string): Promise<string | undefined> => {
  const candidates = [
    process.env.TRADETOOLS_XRAY_PATH,
    process.env.XRAY_PATH,
    join(appDataDir, 'xray-core', xrayExecutableName),
    join(appDataDir, 'xray', xrayExecutableName)
  ].filter((path): path is string => Boolean(path))

  for (const candidate of candidates) {
    if (await fileExists(candidate) && await canRunXray(candidate)) return candidate
  }

  if (await canRunXray(xrayExecutableName)) return xrayExecutableName
  return undefined
}

export const createXrayReleaseDownloadUrl = (runtimePlatform = platform(), runtimeArch = arch()): string => {
  const assetByPlatform: Record<string, Partial<Record<string, string>>> = {
    win32: {
      x64: 'Xray-windows-64.zip',
      arm64: 'Xray-windows-arm64-v8a.zip'
    },
    darwin: {
      x64: 'Xray-macos-64.zip',
      arm64: 'Xray-macos-arm64-v8a.zip'
    },
    linux: {
      x64: 'Xray-linux-64.zip',
      arm64: 'Xray-linux-arm64-v8a.zip'
    }
  }
  const asset = assetByPlatform[runtimePlatform]?.[runtimeArch]
  if (!asset) throw new Error(`Автозагрузка Xray не поддержана для ${runtimePlatform}/${runtimeArch}`)

  return `https://github.com/XTLS/Xray-core/releases/latest/download/${asset}`
}

const downloadFile = async (url: string, destination: string, redirectCount = 0): Promise<void> => {
  if (redirectCount > 5) throw new Error('Слишком много redirects при скачивании Xray')
  await mkdir(dirname(destination), { recursive: true })

  await new Promise<void>((resolve, reject) => {
    const request = httpsGet(url, { headers: { 'User-Agent': userAgent } }, (response) => {
      const statusCode = response.statusCode ?? 0
      const location = response.headers.location
      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume()
        const redirectUrl = new URL(location, url).toString()
        downloadFile(redirectUrl, destination, redirectCount + 1).then(resolve, reject)
        return
      }

      if (statusCode !== 200) {
        response.resume()
        reject(new Error(`GitHub вернул HTTP ${statusCode} при скачивании Xray`))
        return
      }

      pipeline(response, createWriteStream(destination)).then(resolve, reject)
    })

    request.setTimeout(60_000, () => request.destroy(new Error('Timeout при скачивании Xray')))
    request.on('error', reject)
  })
}

const powershellLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`

export const createPowerShellExpandArchiveCommand = (archivePath: string, destinationDir: string): string => [
  '$ErrorActionPreference = "Stop"',
  `Expand-Archive -LiteralPath ${powershellLiteral(archivePath)} -DestinationPath ${powershellLiteral(destinationDir)} -Force`
].join('; ')

const extractArchive = async (archivePath: string, destinationDir: string): Promise<void> => {
  await rm(destinationDir, { recursive: true, force: true })
  await mkdir(destinationDir, { recursive: true })

  if (process.platform === 'win32') {
    try {
      await runProcess('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        createPowerShellExpandArchiveCommand(archivePath, destinationDir)
      ], 120_000)
    } catch {
      throw new Error('Не удалось распаковать Xray core. Проверьте, что архив скачался полностью, и попробуйте настроить связку еще раз.')
    }
    return
  }

  await runProcess('unzip', ['-o', archivePath, '-d', destinationDir], 120_000)
}

const ensureXrayCore = async (appDataDir: string, progress: (progress: RuntimeProgress) => void): Promise<string> => {
  const existing = await resolveExistingXray(appDataDir)
  if (existing) {
    progress({ step: 'local-xray', status: 'info', message: 'Локальный Xray core найден' })
    return existing
  }

  const xrayDir = join(appDataDir, 'xray-core')
  const archivePath = join(appDataDir, 'downloads', 'xray-core.zip')
  const downloadUrl = createXrayReleaseDownloadUrl()

  progress({ step: 'local-xray', status: 'running', message: 'Скачиваем Xray core для локального прокси' })
  await downloadFile(downloadUrl, archivePath)
  progress({ step: 'local-xray', status: 'running', message: 'Распаковываем Xray core' })
  await extractArchive(archivePath, xrayDir)

  const binaryPath = join(xrayDir, xrayExecutableName)
  if (process.platform !== 'win32') await chmod(binaryPath, 0o755).catch(() => undefined)
  if (!await canRunXray(binaryPath)) throw new Error('Xray core скачан, но не запускается')

  progress({ step: 'local-xray', status: 'success', message: 'Xray core готов' })
  return binaryPath
}

export const createLocalXrayConfig = (input: {
  localPort: number
  entryHost: string
  entryPort: number
  entryUuid: string
}): Record<string, unknown> => ({
  log: {
    loglevel: 'warning'
  },
  inbounds: [
    {
      tag: 'terminal-http',
      listen: '127.0.0.1',
      port: input.localPort,
      protocol: 'http',
      settings: {
        timeout: 300
      },
      sniffing: {
        enabled: true,
        destOverride: ['http', 'tls']
      }
    }
  ],
  outbounds: [
    {
      tag: 'trade-chain',
      protocol: 'vless',
      settings: {
        vnext: [
          {
            address: input.entryHost,
            port: input.entryPort,
            users: [
              {
                id: input.entryUuid,
                encryption: 'none'
              }
            ]
          }
        ]
      },
      streamSettings: {
        network: 'tcp'
      }
    }
  ]
})

export const stopLocalXrayRuntime = async (localPort?: number, appDataDir?: string): Promise<void> => {
  if (localXrayProcess) {
    localXrayProcess.kill()
    localXrayProcess = undefined
  } else if (localPort) {
    const owner = await describeLocalPortOwner(localPort)
    if (owner && appDataDir && isManagedLocalXrayOwner(owner, localXrayConfigPath(appDataDir))) process.kill(owner.pid)
  }
  await delay(500)
  if (localPort && await isLocalXrayRuntimeRunning(localPort, appDataDir)) {
    throw new Error(`Локальный Xray не остановился на порту 127.0.0.1:${localPort}`)
  }
}

const isPortAvailable = async (port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

const findAvailableLocalPort = async (startPort: number, attempts = 20): Promise<number | undefined> => {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = startPort + offset
    if (port > 65535) return undefined
    if (await isPortAvailable(port)) return port
  }

  return undefined
}

const parsePortOwner = (stdout: string): LocalPortOwner | undefined => {
  const text = stdout.trim()
  if (!text) return undefined

  try {
    const value = JSON.parse(text) as Partial<LocalPortOwner>
    const pid = Number(value.pid)
    if (!Number.isFinite(pid) || pid <= 0) return undefined

    return {
      pid,
      name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : undefined,
      path: typeof value.path === 'string' && value.path.trim() ? value.path.trim() : undefined,
      commandLine: typeof value.commandLine === 'string' && value.commandLine.trim() ? value.commandLine.trim() : undefined
    }
  } catch {
    return undefined
  }
}

const describeLocalPortOwner = async (port: number): Promise<LocalPortOwner | undefined> => {
  if (process.platform === 'win32') {
    try {
      const result = await runProcess('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        [
          '$ErrorActionPreference = "SilentlyContinue"',
          `$connection = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort ${port} -State Listen | Select-Object -First 1`,
          'if ($connection) {',
          '  $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue',
          '  $processInfo = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $connection.OwningProcess) -ErrorAction SilentlyContinue',
          '  [PSCustomObject]@{ pid = $connection.OwningProcess; name = $process.ProcessName; path = $process.Path; commandLine = $processInfo.CommandLine } | ConvertTo-Json -Compress',
          '}'
        ].join('; ')
      ], 5_000)
      return parsePortOwner(result.stdout)
    } catch {
      return undefined
    }
  }

  try {
    const result = await runProcess('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'pcn'], 5_000)
    const pid = Number(result.stdout.match(/^p(\d+)/m)?.[1])
    if (!Number.isFinite(pid) || pid <= 0) return undefined
    let commandLine: string | undefined
    try {
      commandLine = (await runProcess('ps', ['-p', String(pid), '-o', 'command='], 5_000)).stdout.trim() || undefined
    } catch {
      // Keep the existing port-owner result when the OS does not expose process arguments.
    }
    return {
      pid,
      name: result.stdout.match(/^c(.+)$/m)?.[1]?.trim() || undefined,
      commandLine
    }
  } catch {
    return undefined
  }
}

export const createLocalPortBusyMessage = (port: number, owner?: LocalPortOwner, suggestedPort?: number): string => {
  const ownerText = owner
    ? ` Его держит ${owner.name ? `${owner.name} ` : ''}(PID ${owner.pid})${owner.path ? `: ${owner.path}` : ''}.`
    : ''
  const tunnelHint = owner?.path && /v2raytun|xray|v2ray|clash|sing-box/i.test(owner.path)
    ? ' Похоже, это другой локальный proxy-клиент.'
    : ''
  const suggestion = suggestedPort ? ` Ближайший свободный порт сейчас: ${suggestedPort}.` : ''

  return `Порт 127.0.0.1:${port} занят.${ownerText}${tunnelHint}${suggestion} Закройте этот локальный proxy или выберите другой порт в настройках первого сервера.`
}

const waitForTcpPort = async (port: number, timeoutMs: number, getEarlyError: () => string | undefined): Promise<void> => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const earlyError = getEarlyError()
    if (earlyError) throw new Error(earlyError)

    const connected = await new Promise<boolean>((resolve) => {
      const socket = netConnect({ host: '127.0.0.1', port })
      socket.setTimeout(600)
      socket.once('connect', () => {
        socket.end()
        resolve(true)
      })
      socket.once('error', () => resolve(false))
      socket.once('timeout', () => {
        socket.destroy()
        resolve(false)
      })
    })

    if (connected) return
    await delay(200)
  }

  throw new Error(`Локальный Xray не открыл порт 127.0.0.1:${port}`)
}

const runProxyCurl = async (url: string, localPort: number): Promise<{ statusCode: number, body: string }> => {
  const result = await runProcess('curl', [
    '--silent',
    '--show-error',
    '--max-time',
    '12',
    '--proxy',
    `http://127.0.0.1:${localPort}`,
    '--write-out',
    '\nTT_HTTP_CODE:%{http_code}',
    url
  ], 15_000)
  const marker = '\nTT_HTTP_CODE:'
  const markerIndex = result.stdout.lastIndexOf(marker)
  if (markerIndex < 0) throw new Error(result.stderr.trim() || 'curl не вернул HTTP status')

  return {
    body: result.stdout.slice(0, markerIndex).trim(),
    statusCode: Number(result.stdout.slice(markerIndex + marker.length).trim())
  }
}

const runLocalProxyDiagnostics = async (localPort: number): Promise<LocalProxyDiagnostic[]> => {
  const checks: LocalProxyDiagnostic[] = []

  try {
    const ip = await runProxyCurl('https://api.ipify.org?format=json', localPort)
    checks.push({
      name: 'Exit IP',
      ok: ip.statusCode === 200,
      message: ip.statusCode === 200 ? ip.body : `HTTP ${ip.statusCode}`
    })
  } catch (error) {
    checks.push({
      name: 'Exit IP',
      ok: false,
      message: error instanceof Error ? error.message : 'Не удалось проверить exit IP'
    })
  }

  for (const check of [
    ['Binance Spot', 'https://api.binance.com/api/v3/time'],
    ['Binance Futures', 'https://fapi.binance.com/fapi/v1/time']
  ] as const) {
    try {
      const result = await runProxyCurl(check[1], localPort)
      checks.push({
        name: check[0],
        ok: result.statusCode === 200,
        message: result.statusCode === 200 ? 'HTTP 200' : `HTTP ${result.statusCode}`
      })
    } catch (error) {
      checks.push({
        name: check[0],
        ok: false,
        message: error instanceof Error ? error.message : 'Проверка не прошла'
      })
    }
  }

  return checks
}

export const isReusableLocalXrayOwner = (owner?: LocalPortOwner): boolean => {
  const name = owner?.name?.toLowerCase() ?? ''
  const ownerPath = owner?.path?.toLowerCase() ?? ''
  return /^xray(?:\.exe)?$/.test(name) || /(?:^|[\\/])xray(?:\.exe)?$/.test(ownerPath)
}

export const isManagedLocalXrayOwner = (owner: LocalPortOwner | undefined, configPath: string): boolean => {
  return isReusableLocalXrayOwner(owner) && owner?.commandLine?.includes(configPath) === true
}

export const isLocalXrayRuntimeRunning = async (localPort: number, appDataDir?: string): Promise<boolean> => {
  if (localXrayProcess && !localXrayProcess.killed) return true
  return appDataDir
    ? isManagedLocalXrayOwner(await describeLocalPortOwner(localPort), localXrayConfigPath(appDataDir))
    : false
}

export const storedLocalXrayConfigMatches = async (configPath: string, config: Record<string, unknown>): Promise<boolean> => {
  try {
    const stored = JSON.parse(await readFile(configPath, 'utf8')) as unknown
    return JSON.stringify(stored) === JSON.stringify(config)
  } catch {
    return false
  }
}

const finishLocalXrayRuntime = async (
  localPort: number,
  progress: (progress: RuntimeProgress) => void,
  readyMessage: string
): Promise<LocalXrayRuntimeResult> => {
  progress({ step: 'local-xray', status: 'success', message: readyMessage })
  progress({ step: 'diagnostics', status: 'running', message: 'Проверяем exit IP и доступность Binance через локальный proxy' })
  const diagnostics = await runLocalProxyDiagnostics(localPort)
  const failed = diagnostics.filter((check) => !check.ok)
  progress({
    step: 'diagnostics',
    status: failed.length === 0 ? 'success' : 'info',
    message: failed.length === 0
      ? 'Проверки через proxy прошли'
      : `Есть предупреждения проверки: ${failed.map((check) => check.name).join(', ')}`
  })

  return {
    host: '127.0.0.1',
    port: localPort,
    type: 'HTTP',
    username: '',
    password: '',
    authRequired: false,
    diagnostics
  }
}

export const setupLocalXrayRuntime = async (input: LocalXrayRuntimeInput): Promise<LocalXrayRuntimeResult> => {
  const progress = input.onProgress ?? (() => undefined)
  const keepRunningAfterClose = input.keepRunningAfterClose === true
  const binaryPath = await ensureXrayCore(input.appDataDir, progress)
  const configDir = join(input.appDataDir, 'xray-runtime')
  const configPath = localXrayConfigPath(input.appDataDir)
  const nextConfig = createLocalXrayConfig(input)
  await mkdir(configDir, { recursive: true })

  if (localXrayProcess) {
    await stopLocalXrayRuntime()
  } else if (!await isPortAvailable(input.localPort)) {
    const [owner, suggestedPort] = await Promise.all([
      describeLocalPortOwner(input.localPort),
      findAvailableLocalPort(input.localPort + 1)
    ])
    if (isReusableLocalXrayOwner(owner) && await storedLocalXrayConfigMatches(configPath, nextConfig)) {
      return finishLocalXrayRuntime(input.localPort, progress, `Локальный proxy уже запущен: 127.0.0.1:${input.localPort}`)
    }
    throw new Error(createLocalPortBusyMessage(input.localPort, owner, suggestedPort))
  }

  await writeFile(configPath, JSON.stringify(nextConfig, null, 2), 'utf8')
  if (!await isPortAvailable(input.localPort)) {
    const [owner, suggestedPort] = await Promise.all([
      describeLocalPortOwner(input.localPort),
      findAvailableLocalPort(input.localPort + 1)
    ])
    throw new Error(createLocalPortBusyMessage(input.localPort, owner, suggestedPort))
  }

  progress({ step: 'local-xray', status: 'running', message: `Запускаем локальный HTTP proxy 127.0.0.1:${input.localPort}` })
  const child = spawn(binaryPath, ['run', '-config', configPath], {
    detached: keepRunningAfterClose,
    windowsHide: true,
    stdio: keepRunningAfterClose ? 'ignore' : 'pipe'
  })
  let processLogs = ''
  let exited = false

  child.stdout?.on('data', (chunk: Buffer) => {
    processLogs = `${processLogs}${chunk.toString('utf8')}`.slice(-4_000)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    processLogs = `${processLogs}${chunk.toString('utf8')}`.slice(-4_000)
  })
  child.on('close', (code) => {
    exited = true
    if (localXrayProcess === child) localXrayProcess = undefined
    processLogs = `${processLogs}\nXray exited with code ${code ?? 'unknown'}`.slice(-4_000)
  })
  child.on('error', (error) => {
    exited = true
    processLogs = `${processLogs}\n${error.message}`.slice(-4_000)
  })
  localXrayProcess = child
  if (keepRunningAfterClose) child.unref()

  await waitForTcpPort(input.localPort, 8_000, () => exited ? processLogs.trim() || 'Локальный Xray завершился' : undefined)
  return finishLocalXrayRuntime(input.localPort, progress, `Локальный proxy готов: 127.0.0.1:${input.localPort}`)
}
