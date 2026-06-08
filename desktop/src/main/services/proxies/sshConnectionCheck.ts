import { Client, type ConnectConfig } from 'ssh2'

export type SshConnectionCheckInput = {
  server: string
  login: string
  password: string
  timeoutMs?: number
}

export type SshConnectionCheckResult = {
  ok: boolean
  host: string
  port: number
  login: string
  message: string
  serverInfo?: string
}

const defaultSshPort = 22

export const parseSshEndpoint = (server: string): { host: string, port: number } => {
  const trimmed = server.trim()
  if (!trimmed) return { host: '', port: defaultSshPort }

  const ipv6Match = trimmed.match(/^\[(.+)](?::(\d+))?$/)
  if (ipv6Match) {
    const port = Number(ipv6Match[2])
    return {
      host: ipv6Match[1] ?? '',
      port: Number.isFinite(port) && port > 0 && port <= 65535 ? Math.trunc(port) : defaultSshPort
    }
  }

  const lastColon = trimmed.lastIndexOf(':')
  if (lastColon > 0 && trimmed.indexOf(':') === lastColon) {
    const host = trimmed.slice(0, lastColon).trim()
    const port = Number(trimmed.slice(lastColon + 1))
    if (Number.isFinite(port) && port > 0 && port <= 65535) return { host, port: Math.trunc(port) }
  }

  return { host: trimmed, port: defaultSshPort }
}

const command = 'printf "user=%s system=%s\\n" "$(id -un 2>/dev/null || whoami)" "$(uname -srm 2>/dev/null || ver)"'

export const explainSshConnectionFailure = (message: string, login: string): string => {
  if (/all configured authentication methods failed/i.test(message)) {
    return `SSH-авторизация не прошла для логина "${login}". Проверьте пароль, правильность логина и разрешён ли вход по паролю/root на VPS.`
  }

  if (/ECONNREFUSED|Connection refused/i.test(message)) {
    return 'SSH-порт закрыт или сервер отклонил подключение. Проверьте IP, порт и firewall хостинга.'
  }

  if (/ETIMEDOUT|Timed out|timeout/i.test(message)) {
    return 'SSH timeout: сервер не ответил. Проверьте IP, порт 22, firewall и доступность VPS.'
  }

  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return 'Домен сервера не найден. Проверьте IP или DNS-имя.'
  }

  if (/No route to host|EHOSTUNREACH/i.test(message)) {
    return 'Нет маршрута до сервера. Проверьте сеть и firewall.'
  }

  return message || 'SSH-подключение не удалось'
}

export const checkSshConnection = (input: SshConnectionCheckInput): Promise<SshConnectionCheckResult> => {
  const endpoint = parseSshEndpoint(input.server)
  if (!endpoint.host) throw new Error('Некорректный SSH host')

  return new Promise((resolve) => {
    const client = new Client()
    let settled = false

    const finish = (result: SshConnectionCheckResult) => {
      if (settled) return
      settled = true
      client.end()
      resolve(result)
    }

    const config: ConnectConfig = {
      host: endpoint.host,
      port: endpoint.port,
      username: input.login,
      password: input.password,
      readyTimeout: input.timeoutMs ?? 12_000,
      tryKeyboard: false
    }

    client
      .on('ready', () => {
        client.exec(command, (error, stream) => {
          if (error) {
            finish({
              ok: true,
              host: endpoint.host,
              port: endpoint.port,
              login: input.login,
              message: 'SSH-подключение успешно, команду проверки выполнить не удалось'
            })
            return
          }

          let output = ''
          stream
            .on('close', () => {
              finish({
                ok: true,
                host: endpoint.host,
                port: endpoint.port,
                login: input.login,
                message: 'SSH-подключение успешно',
                serverInfo: output.trim()
              })
            })
            .on('data', (chunk: Buffer) => {
              output += chunk.toString('utf8')
            })
            .stderr.on('data', () => undefined)
        })
      })
      .on('error', (error) => {
        finish({
          ok: false,
          host: endpoint.host,
          port: endpoint.port,
          login: input.login,
          message: explainSshConnectionFailure(error.message, input.login)
        })
      })
      .on('timeout', () => {
        finish({
          ok: false,
          host: endpoint.host,
          port: endpoint.port,
          login: input.login,
          message: explainSshConnectionFailure('SSH timeout', input.login)
        })
      })
      .connect(config)
  })
}
