import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { Client, type ConnectConfig } from 'ssh2'
import type { AppSettings, LocalProxyType, ProxyRecord } from '../settings/settings'
import { inspectProxyNetworkEnvironment, type NetworkEnvironmentSnapshot, type NetworkDiagnosticStatus } from './networkEnvironment'
import { parseSshEndpoint } from './sshConnectionCheck'
import { setupLocalXrayRuntime, type LocalProxyDiagnostic } from './xrayLocalRuntime'
import { defaultLocalProxyPort } from '../../../shared/defaults'

export type ProxyChainSetupProgress = {
  proxyId?: string
  proxyName?: string
  step: string
  status: 'running' | 'success' | 'error' | 'info'
  message: string
  timestampMs: number
}

export type ProxyChainSetupResult = {
  ok: true
  route: string
  entryProxy: {
    host: '127.0.0.1'
    port: number
    type: LocalProxyType
    username: ''
    password: ''
    authRequired: false
  }
  diagnostics: LocalProxyDiagnostic[]
  network: NetworkEnvironmentSnapshot
  configuredAtMs: number
}

export type ProxyChainConnectionResult = ProxyChainSetupResult & {
  reusedRuntime: boolean
}

export type ProxyChainRuntimeConfig = {
  activeStartProxyId: string
  route: string
  entryHost: string
  entryPort: number
  entryUuid: string
  localPort: number
  localProxyType: LocalProxyType
  configuredAtMs: number
}

export type ProxyChainSetupInput = {
  chain: ProxyRecord[]
  getSshPassword: (proxyId: string) => Promise<string | undefined>
  appDataDir: string
  localProxyType?: LocalProxyType
  keepRunningAfterClose?: boolean
  onRuntimeConfigured?: (config: ProxyChainRuntimeConfig) => Promise<void> | void
  onProgress?: (progress: ProxyChainSetupProgress) => void
}

type ProxyChainNode = {
  proxy: ProxyRecord
  host: string
  listenPort: number
  uuid: string
}

const remoteXrayPort = 443

const proxyDisplayName = (proxy: ProxyRecord): string => proxy.name || proxy.server || 'сервер'
const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

const runRemoteCommand = async (client: Client, command: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(error)
        return
      }

      let stdout = ''
      let stderr = ''
      stream
        .on('close', (code: number | undefined) => {
          if (code === 0) {
            resolve(stdout.trim())
            return
          }

          reject(new Error(stderr.trim() || stdout.trim() || `Remote command failed with code ${code ?? 'unknown'}`))
        })
        .on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8')
        })
        .stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8')
        })
    })
  })
}

const connectSsh = (proxy: ProxyRecord, password: string): Promise<Client> => {
  const endpoint = parseSshEndpoint(proxy.server)
  if (!endpoint.host) throw new Error(`У сервера "${proxyDisplayName(proxy)}" не указан IP или домен`)

  return new Promise((resolve, reject) => {
    const client = new Client()
    const config: ConnectConfig = {
      host: endpoint.host,
      port: endpoint.port,
      username: proxy.login,
      password,
      readyTimeout: 15_000,
      tryKeyboard: false
    }

    client
      .on('ready', () => resolve(client))
      .on('error', reject)
      .on('timeout', () => reject(new Error('SSH timeout')))
      .connect(config)
  })
}

const sudoShell = (command: string, password: string): string => {
  const quoted = shellQuote(command)
  return `[ "$(id -u)" -eq 0 ] && sh -lc ${quoted} || printf '%s\\n' ${shellQuote(password)} | sudo -S -p '' sh -lc ${quoted}`
}

export const createProxyChainRoute = (chain: ProxyRecord[]): string => chain.map((proxy) => `${proxyDisplayName(proxy)} (${proxy.server})`).join(' -> ')

const safeNodeName = (proxy: ProxyRecord): string => proxyDisplayName(proxy).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 48) || 'node'

export const createXrayServerConfig = (node: ProxyChainNode, nextNode?: ProxyChainNode): Record<string, unknown> => ({
  log: {
    loglevel: 'warning'
  },
  inbounds: [
    {
      tag: 'trade-in',
      listen: '0.0.0.0',
      port: node.listenPort,
      protocol: 'vless',
      settings: {
        clients: [
          {
            id: node.uuid,
            email: `${safeNodeName(node.proxy)}@tradetools.local`
          }
        ],
        decryption: 'none'
      },
      streamSettings: {
        network: 'tcp'
      }
    }
  ],
  outbounds: [
    nextNode
      ? {
          tag: 'next-node',
          protocol: 'vless',
          settings: {
            vnext: [
              {
                address: nextNode.host,
                port: nextNode.listenPort,
                users: [
                  {
                    id: nextNode.uuid,
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
      : {
          tag: 'direct',
          protocol: 'freedom'
        }
  ],
  routing: {
    rules: [
      {
        type: 'field',
        inboundTag: ['trade-in'],
        outboundTag: nextNode ? 'next-node' : 'direct'
      }
    ]
  }
})

const buildXrayInstallCommand = (config: Record<string, unknown>, listenPort: number): string => {
  const configBase64 = Buffer.from(JSON.stringify(config, null, 2), 'utf8').toString('base64')

  return [
    'set -eu',
    'command -v systemctl >/dev/null 2>&1 || { echo "systemd не найден. Автоматическая настройка Xray пока поддерживает только systemd VPS." >&2; exit 42; }',
    'if ! command -v xray >/dev/null 2>&1; then if ! command -v curl >/dev/null 2>&1; then if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y curl ca-certificates; elif command -v dnf >/dev/null 2>&1; then dnf install -y curl ca-certificates; elif command -v yum >/dev/null 2>&1; then yum install -y curl ca-certificates; elif command -v apk >/dev/null 2>&1; then apk add --no-cache curl ca-certificates; else echo "curl не найден и пакетный менеджер не распознан" >&2; exit 41; fi; fi; bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install; fi',
    'command -v xray >/dev/null 2>&1 || { echo "Xray не установлен" >&2; exit 43; }',
    'systemctl disable --now tradetools-proxy-chain >/dev/null 2>&1 || true',
    'mkdir -p /usr/local/etc/xray',
    `printf '%s' ${shellQuote(configBase64)} | base64 -d > /usr/local/etc/xray/config.json`,
    'chmod 644 /usr/local/etc/xray/config.json',
    'if xray run -test -config /usr/local/etc/xray/config.json >/tmp/tradetools-xray-test.log 2>&1; then :; elif xray -test -config /usr/local/etc/xray/config.json >/tmp/tradetools-xray-test.log 2>&1; then :; else cat /tmp/tradetools-xray-test.log >&2; exit 45; fi',
    'systemctl enable xray >/dev/null',
    'systemctl restart xray',
    `if command -v ufw >/dev/null 2>&1; then ufw allow ${listenPort}/tcp >/dev/null 2>&1 || true; fi`,
    `if command -v firewall-cmd >/dev/null 2>&1; then firewall-cmd --add-port=${listenPort}/tcp --permanent >/dev/null 2>&1 && firewall-cmd --reload >/dev/null 2>&1 || true; fi`,
    'sleep 1',
    'systemctl is-active --quiet xray',
    'systemctl status xray --no-pager -l | sed -n "1,10p"'
  ].join('\n')
}

const redactSshPassword = (message: string, password: string): string => message.split(password).join('***')

const networkStatusToProgressStatus = (status: NetworkDiagnosticStatus): ProxyChainSetupProgress['status'] => {
  if (status === 'ok') return 'success'
  if (status === 'warning') return 'info'
  return 'info'
}

export const reconnectStoredProxyRuntime = async (input: {
  appDataDir: string
  runtime: AppSettings['proxyRuntime']
  entryUuid: string
  keepRunningAfterClose: boolean
}): Promise<ProxyChainConnectionResult> => {
  const entryProxy = await setupLocalXrayRuntime({
    appDataDir: input.appDataDir,
    localPort: input.runtime.localPort,
    entryHost: input.runtime.entryHost,
    entryPort: input.runtime.entryPort,
    entryUuid: input.entryUuid,
    localProxyType: input.runtime.localProxyType,
    keepRunningAfterClose: input.keepRunningAfterClose
  })
  const network = await inspectProxyNetworkEnvironment({
    entryHost: input.runtime.entryHost,
    localPort: input.runtime.localPort
  })
  return {
    ok: true,
    reusedRuntime: true,
    route: input.runtime.route,
    entryProxy,
    diagnostics: entryProxy.diagnostics,
    network,
    configuredAtMs: input.runtime.configuredAtMs
  }
}

export const setupProxyChainOnServers = async (input: ProxyChainSetupInput): Promise<ProxyChainConnectionResult> => {
  if (input.chain.length === 0) throw new Error('Связка пустая')

  const progress = (progress: Omit<ProxyChainSetupProgress, 'timestampMs'>) => {
    input.onProgress?.({ ...progress, timestampMs: Date.now() })
  }

  const passwords = new Map<string, string>()
  for (const proxy of input.chain) {
    if (!proxy.server) throw new Error(`У сервера "${proxyDisplayName(proxy)}" не указан IP или домен`)
    if (!proxy.login) throw new Error(`У сервера "${proxyDisplayName(proxy)}" не указан SSH-логин`)
    const password = await input.getSshPassword(proxy.id)
    if (!password) throw new Error(`У сервера "${proxyDisplayName(proxy)}" не сохранён SSH-пароль`)
    passwords.set(proxy.id, password)
  }

  const nodes = input.chain.map((proxy): ProxyChainNode => {
    const endpoint = parseSshEndpoint(proxy.server)
    if (!endpoint.host) throw new Error(`У сервера "${proxyDisplayName(proxy)}" не указан IP или домен`)

    return {
      proxy,
      host: endpoint.host,
      listenPort: remoteXrayPort,
      uuid: randomUUID()
    }
  })

  const firstNode = nodes[0]
  if (!firstNode) throw new Error('Связка пустая')
  const localPort = input.chain[0]?.localProxyPort || defaultLocalProxyPort
  const localProxyType = input.localProxyType ?? 'SOCKS5'

  progress({
    proxyId: firstNode.proxy.id,
    proxyName: proxyDisplayName(firstNode.proxy),
    step: 'network',
    status: 'running',
    message: 'Проверяем VPN, системный proxy и маршрут к первому VPS'
  })
  const network = await inspectProxyNetworkEnvironment({
    entryHost: firstNode.host,
    localPort
  })
  for (const diagnostic of network.diagnostics) {
    progress({
      proxyId: firstNode.proxy.id,
      proxyName: proxyDisplayName(firstNode.proxy),
      step: 'network',
      status: networkStatusToProgressStatus(diagnostic.status),
      message: `${diagnostic.name}: ${diagnostic.message}`
    })
  }

  for (const node of [...nodes].reverse()) {
    const password = passwords.get(node.proxy.id)
    if (!password) throw new Error(`У сервера "${proxyDisplayName(node.proxy)}" не сохранён SSH-пароль`)

    const index = nodes.findIndex((candidate) => candidate.proxy.id === node.proxy.id)
    const nextNode = nodes[index + 1]

    progress({
      proxyId: node.proxy.id,
      proxyName: proxyDisplayName(node.proxy),
      step: 'ssh',
      status: 'running',
      message: `Подключаемся к ${proxyDisplayName(node.proxy)} по SSH`
    })

    let client: Client | undefined
    try {
      client = await connectSsh(node.proxy, password)
      progress({
        proxyId: node.proxy.id,
        proxyName: proxyDisplayName(node.proxy),
        step: 'install',
        status: 'running',
        message: `Ставим Xray и настраиваем VLESS TCP на порту ${node.listenPort}`
      })

      const config = createXrayServerConfig(node, nextNode)
      await runRemoteCommand(client, sudoShell(buildXrayInstallCommand(config, node.listenPort), password))

      progress({
        proxyId: node.proxy.id,
        proxyName: proxyDisplayName(node.proxy),
        step: 'install',
        status: 'success',
        message: nextNode
          ? `${proxyDisplayName(node.proxy)} настроен: VLESS ${node.listenPort} -> ${nextNode.host}:${nextNode.listenPort}`
          : `${proxyDisplayName(node.proxy)} настроен как exit-сервер`
      })
    } catch (error) {
      progress({
        proxyId: node.proxy.id,
        proxyName: proxyDisplayName(node.proxy),
        step: 'install',
        status: 'error',
        message: error instanceof Error ? redactSshPassword(error.message, password) : 'Не удалось настроить сервер'
      })
      throw error
    } finally {
      client?.end()
    }
  }

  progress({
    proxyId: firstNode.proxy.id,
    proxyName: proxyDisplayName(firstNode.proxy),
    step: 'local-xray',
    status: 'running',
    message: `Поднимаем локальный proxy для терминала на 127.0.0.1:${localPort}`
  })

  let entryProxy: Awaited<ReturnType<typeof setupLocalXrayRuntime>>
  try {
    entryProxy = await setupLocalXrayRuntime({
      appDataDir: input.appDataDir,
      localPort,
      entryHost: firstNode.host,
      entryPort: firstNode.listenPort,
      entryUuid: firstNode.uuid,
      localProxyType,
      keepRunningAfterClose: input.keepRunningAfterClose,
      onProgress: (localProgress) => progress(localProgress)
    })
  } catch (error) {
    progress({
      proxyId: firstNode.proxy.id,
      proxyName: proxyDisplayName(firstNode.proxy),
      step: 'local-xray',
      status: 'error',
      message: error instanceof Error ? error.message : 'Не удалось запустить локальный proxy'
    })
    throw error
  }

  progress({
    proxyId: firstNode.proxy.id,
    proxyName: proxyDisplayName(firstNode.proxy),
    step: 'done',
    status: 'success',
    message: `Связка настроена. В терминале укажите ${localProxyType} 127.0.0.1 и локальный порт без логина и пароля.`
  })

  const configuredAtMs = Date.now()
  await input.onRuntimeConfigured?.({
    activeStartProxyId: firstNode.proxy.id,
    route: createProxyChainRoute(input.chain),
    entryHost: firstNode.host,
    entryPort: firstNode.listenPort,
    entryUuid: firstNode.uuid,
    localPort,
    localProxyType,
    configuredAtMs
  })

  return {
    ok: true,
    reusedRuntime: false,
    route: createProxyChainRoute(input.chain),
    entryProxy,
    diagnostics: entryProxy.diagnostics,
    network,
    configuredAtMs
  }
}
