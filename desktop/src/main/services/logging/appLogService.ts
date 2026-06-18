import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type AppLogLevel = 'info' | 'warn' | 'error'

export type AppLogSnapshot = {
  path: string
  text: string
}

export type AppLogService = {
  getPath: () => string
  getSnapshot: () => Promise<AppLogSnapshot>
  info: (area: string, message: string, details?: Record<string, unknown>) => Promise<void>
  warn: (area: string, message: string, details?: Record<string, unknown>) => Promise<void>
  error: (area: string, message: string, error?: unknown, details?: Record<string, unknown>) => Promise<void>
}

export type AppLogServiceDeps = {
  appDataDir: string
  now?: () => number
}

const maxLogTextLength = 200_000
const pad = (value: number, size = 2): string => String(value).padStart(size, '0')

const formatLocalTimestamp = (timeMs: number): string => {
  const date = new Date(timeMs)
  const offsetMinutes = -date.getTimezoneOffset()
  const offsetSign = offsetMinutes >= 0 ? '+' : '-'
  const offsetAbs = Math.abs(offsetMinutes)

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`,
    `UTC${offsetSign}${pad(Math.floor(offsetAbs / 60))}:${pad(offsetAbs % 60)}`
  ].join(' ')
}

const newestFirst = (text: string): string => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  return lines.length ? `${lines.reverse().join('\n')}\n` : ''
}

const errorDetails = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    return {
      error: error.message,
      ...(error.stack ? { stack: error.stack } : {})
    }
  }

  return typeof error === 'undefined' ? {} : { error }
}

const toLine = (
  timeMs: number,
  level: AppLogLevel,
  area: string,
  message: string,
  details?: Record<string, unknown>
): string => {
  const suffix = details && Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : ''
  return `${formatLocalTimestamp(timeMs)} [${level.toUpperCase()}] [${area}] ${message}${suffix}\n`
}

export const createAppLogService = ({ appDataDir, now = () => Date.now() }: AppLogServiceDeps): AppLogService => {
  const logPath = join(appDataDir, 'logs', 'tradetools.log')

  const append = async (level: AppLogLevel, area: string, message: string, details?: Record<string, unknown>) => {
    await mkdir(join(appDataDir, 'logs'), { recursive: true })
    await appendFile(logPath, toLine(now(), level, area, message, details), 'utf8')
  }

  return {
    getPath: () => logPath,
    async getSnapshot() {
      const text = await readFile(logPath, 'utf8').catch(() => '')
      const visibleText = text.length > maxLogTextLength ? text.slice(-maxLogTextLength) : text
      return {
        path: logPath,
        text: newestFirst(visibleText)
      }
    },
    info: (area, message, details) => append('info', area, message, details),
    warn: (area, message, details) => append('warn', area, message, details),
    error: (area, message, error, details) => append('error', area, message, {
      ...errorDetails(error),
      ...(details ?? {})
    })
  }
}
