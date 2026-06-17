import { join } from 'node:path'
import { defaultLocalProxyPort } from '../../../shared/defaults'
import { defaultClipPaddingAfterSeconds, defaultClipPaddingBeforeSeconds, defaultReplayBufferSeconds, maxClipPaddingSeconds, maxObsReplayBufferSeconds, maxWindowReplayBufferSeconds } from '../../../shared/videoDefaults'

export type RecordingSourceType = 'window' | 'screen'
export type RecordingSaveTargetMode = 'all' | 'selected'

export type CaptureTargetRef = {
  id: string
  name: string
  type: RecordingSourceType
  displayId?: string
}

export type ProxyRecord = {
  id: string
  name: string
  server: string
  login: string
  passwordConfigured: boolean
  nextProxyId: string
  localProxyPort: number
  paymentDueDay: number
  dashboardUrl: string
  notes: string
  lastPaymentReminderKey?: string
  lastPaymentReminderAtMs?: number
}

export type AppSettings = {
  language: 'ru'
  recording: {
    mode: 'obs' | 'window'
    sourceType: RecordingSourceType
    windowSourceId: string
    windowSourceName: string
    captureTargets: CaptureTargetRef[]
    saveTargetMode: RecordingSaveTargetMode
    saveTargetId: string
    frameRate: number
    segmentSeconds: number
    systemAudioEnabled: boolean
    microphoneEnabled: boolean
  }
  clip: {
    paddingBeforeSeconds: number
    paddingAfterSeconds: number
    replayBufferSeconds: number
    replaySourceDir: string
    outputDir: string
  }
  obs: {
    host: string
    port: number
    passwordConfigured: boolean
  }
  tradeSource: {
    mode: 'terminal-window'
  }
  system: {
    launchAtLogin: boolean
    proxyPaymentNotificationsEnabled: boolean
    clipSuccessNotificationsEnabled: boolean
    paymentReminderDaysBefore: number
  }
  proxyRuntime: {
    activeStartProxyId: string
    route: string
    entryHost: string
    entryPort: number
    localPort: number
    entryUuidConfigured: boolean
    configuredAtMs: number
  }
  proxies: ProxyRecord[]
}

export type PartialProxyRecord = Partial<ProxyRecord> & {
  endpointHost?: string
  localPort?: number
  paymentDueDate?: string
}

export type PartialSettings = Partial<{
  language: string
  recording: Partial<AppSettings['recording']>
  clip: Partial<AppSettings['clip']>
  obs: Partial<AppSettings['obs']>
  tradeSource: Partial<AppSettings['tradeSource']>
  system: Partial<AppSettings['system']>
  proxyRuntime: Partial<AppSettings['proxyRuntime']>
  proxies: PartialProxyRecord[]
}>

export type SettingsUpdateInput = PartialSettings & {
  obsPassword?: string
}

const clamp = (value: number, min: number, max: number): number => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/

const normalizeString = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

const normalizePort = (value: unknown, fallback = 0): number => {
  const port = Number(value)
  return Number.isFinite(port) && port > 0 && port <= 65535 ? Math.trunc(port) : fallback
}

const normalizePaymentDueDay = (value: unknown, legacyDate?: unknown): number => {
  const day = Number(value)
  if (Number.isFinite(day) && day >= 1 && day <= 31) return Math.trunc(day)

  const date = normalizeString(value)
  if (/^\d{1,2}$/.test(date)) {
    const dateDay = Number(date)
    return dateDay >= 1 && dateDay <= 31 ? dateDay : 0
  }

  const legacyDateText = normalizeString(legacyDate)
  if (!dateOnlyPattern.test(legacyDateText)) return 0

  const [yearText, monthText, dayText] = legacyDateText.split('-')
  const year = Number(yearText)
  const monthIndex = Number(monthText) - 1
  const legacyDay = Number(dayText)
  const parsed = new Date(year, monthIndex, legacyDay)
  return parsed.getFullYear() === year && parsed.getMonth() === monthIndex && parsed.getDate() === legacyDay ? legacyDay : 0
}

const normalizeHttpUrl = (value: unknown): string => {
  const url = normalizeString(value)
  if (!url) return ''

  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : ''
  } catch {
    return ''
  }
}

const normalizeRecordingMode = (value: unknown): AppSettings['recording']['mode'] => value === 'window' ? 'window' : 'obs'
const normalizeRecordingSourceType = (value: unknown, sourceId: unknown): AppSettings['recording']['sourceType'] => {
  if (value === 'screen') return 'screen'
  return normalizeString(sourceId).startsWith('screen:') ? 'screen' : 'window'
}
const normalizeRecordingSaveTargetMode = (value: unknown): RecordingSaveTargetMode => value === 'selected' ? 'selected' : 'all'

const normalizeCaptureTarget = (value: unknown, sourceType: RecordingSourceType): CaptureTargetRef | undefined => {
  if (typeof value !== 'object' || value === null) return undefined

  const input = value as Partial<CaptureTargetRef>
  const id = normalizeString(input.id)
  const name = normalizeString(input.name)
  const type = normalizeRecordingSourceType(input.type, id)
  if (!id || type !== sourceType) return undefined

  const displayId = normalizeString(input.displayId)
  return {
    id,
    name: name || (type === 'screen' ? 'Экран' : 'Окно'),
    type,
    ...(displayId ? { displayId } : {})
  }
}

const normalizeCaptureTargets = (value: unknown, sourceType: RecordingSourceType): CaptureTargetRef[] => {
  if (!Array.isArray(value)) return []

  const seenIds = new Set<string>()
  return value.flatMap((candidate) => {
    const target = normalizeCaptureTarget(candidate, sourceType)
    if (!target || seenIds.has(target.id)) return []
    seenIds.add(target.id)
    return [target]
  })
}

const legacyCaptureTarget = (recording: Partial<AppSettings['recording']> | undefined, sourceType: RecordingSourceType): CaptureTargetRef | undefined => {
  const id = normalizeString(recording?.windowSourceId)
  if (!id) return undefined

  const name = normalizeString(recording?.windowSourceName)
  return {
    id,
    name: name || (sourceType === 'screen' ? 'Экран' : 'Окно'),
    type: sourceType
  }
}

const normalizeProxyId = (value: unknown, fallbackIndex: number): string => {
  const id = normalizeString(value)
  return id.length > 0 ? id : `proxy-${fallbackIndex + 1}`
}

const normalizeProxyRecords = (records: unknown): ProxyRecord[] => {
  if (!Array.isArray(records)) return []

  const seenIds = new Set<string>()
  return records.flatMap((record, index) => {
    if (typeof record !== 'object' || record === null) return []

    const candidate = record as Partial<ProxyRecord> & Record<string, unknown>
    const id = normalizeProxyId(candidate.id, index)
    if (seenIds.has(id)) return []
    seenIds.add(id)

    const server = normalizeString(candidate.server || candidate.endpointHost)
    const lastPaymentReminderAtMs = Number(candidate.lastPaymentReminderAtMs)
    return [{
      id,
      name: normalizeString(candidate.name),
      server,
      login: normalizeString(candidate.login) || 'root',
      passwordConfigured: candidate.passwordConfigured === true,
      nextProxyId: normalizeString(candidate.nextProxyId),
      localProxyPort: normalizePort(candidate.localProxyPort ?? candidate.localPort, defaultLocalProxyPort),
      paymentDueDay: normalizePaymentDueDay(candidate.paymentDueDay, candidate.paymentDueDate),
      dashboardUrl: normalizeHttpUrl(candidate.dashboardUrl),
      notes: normalizeString(candidate.notes),
      ...(typeof candidate.lastPaymentReminderKey === 'string' && candidate.lastPaymentReminderKey.trim()
        ? { lastPaymentReminderKey: candidate.lastPaymentReminderKey.trim() }
        : {}),
      ...(Number.isFinite(lastPaymentReminderAtMs) && lastPaymentReminderAtMs > 0
        ? { lastPaymentReminderAtMs }
        : {})
    }]
  })
}

const normalizeProxyRuntime = (value: unknown): AppSettings['proxyRuntime'] => {
  const input = typeof value === 'object' && value !== null ? value as Partial<AppSettings['proxyRuntime']> : {}
  const configuredAtMs = Number(input.configuredAtMs)

  return {
    activeStartProxyId: normalizeString(input.activeStartProxyId),
    route: normalizeString(input.route),
    entryHost: normalizeString(input.entryHost),
    entryPort: normalizePort(input.entryPort, 443),
    localPort: normalizePort(input.localPort, defaultLocalProxyPort),
    entryUuidConfigured: input.entryUuidConfigured === true,
    configuredAtMs: Number.isFinite(configuredAtMs) && configuredAtMs > 0 ? configuredAtMs : 0
  }
}

export const createDefaultSettings = (appDataDir: string): AppSettings => ({
  language: 'ru',
  recording: {
    mode: 'window',
    sourceType: 'window',
    windowSourceId: '',
    windowSourceName: '',
    captureTargets: [],
    saveTargetMode: 'all',
    saveTargetId: '',
    frameRate: 30,
    segmentSeconds: 2,
    systemAudioEnabled: false,
    microphoneEnabled: false
  },
  clip: {
    paddingBeforeSeconds: defaultClipPaddingBeforeSeconds,
    paddingAfterSeconds: defaultClipPaddingAfterSeconds,
    replayBufferSeconds: defaultReplayBufferSeconds,
    replaySourceDir: join(appDataDir, 'obs-replays'),
    outputDir: join(appDataDir, 'clips')
  },
  obs: {
    host: '127.0.0.1',
    port: 4455,
    passwordConfigured: false
  },
  tradeSource: {
    mode: 'terminal-window'
  },
  system: {
    launchAtLogin: false,
    proxyPaymentNotificationsEnabled: true,
    clipSuccessNotificationsEnabled: true,
    paymentReminderDaysBefore: 5
  },
  proxyRuntime: {
    activeStartProxyId: '',
    route: '',
    entryHost: '',
    entryPort: 443,
    localPort: defaultLocalProxyPort,
    entryUuidConfigured: false,
    configuredAtMs: 0
  },
  proxies: []
})

export const normalizeSettings = (settings: PartialSettings, appDataDir: string): AppSettings => {
  const defaults = createDefaultSettings(appDataDir)
  const recordingMode = normalizeRecordingMode(settings.recording?.mode ?? defaults.recording.mode)
  const sourceType = normalizeRecordingSourceType(settings.recording?.sourceType ?? defaults.recording.sourceType, settings.recording?.windowSourceId)
  const windowSourceId = normalizeString(settings.recording?.windowSourceId ?? defaults.recording.windowSourceId)
  const windowSourceName = normalizeString(settings.recording?.windowSourceName ?? defaults.recording.windowSourceName)
  const configuredCaptureTargets = normalizeCaptureTargets(settings.recording?.captureTargets, sourceType)
  const fallbackCaptureTarget = legacyCaptureTarget({ windowSourceId, windowSourceName }, sourceType)
  const captureTargets = configuredCaptureTargets.length > 0
    ? configuredCaptureTargets
    : fallbackCaptureTarget ? [fallbackCaptureTarget] : []
  const paddingBeforeSeconds = clamp(settings.clip?.paddingBeforeSeconds ?? defaults.clip.paddingBeforeSeconds, 0, maxClipPaddingSeconds)
  const paddingAfterSeconds = clamp(settings.clip?.paddingAfterSeconds ?? defaults.clip.paddingAfterSeconds, 0, maxClipPaddingSeconds)
  const maxReplayBufferSeconds = recordingMode === 'window' ? maxWindowReplayBufferSeconds : maxObsReplayBufferSeconds
  const minReplayBufferSeconds = recordingMode === 'window' ? Math.max(10, paddingBeforeSeconds) : 10

  return {
    language: 'ru',
    recording: {
      mode: recordingMode,
      sourceType,
      windowSourceId,
      windowSourceName,
      captureTargets,
      saveTargetMode: normalizeRecordingSaveTargetMode(settings.recording?.saveTargetMode ?? defaults.recording.saveTargetMode),
      saveTargetId: normalizeString(settings.recording?.saveTargetId ?? defaults.recording.saveTargetId),
      frameRate: clamp(settings.recording?.frameRate ?? defaults.recording.frameRate, 10, 60),
      segmentSeconds: clamp(settings.recording?.segmentSeconds ?? defaults.recording.segmentSeconds, 1, 10),
      systemAudioEnabled: settings.recording?.systemAudioEnabled === true,
      microphoneEnabled: settings.recording?.microphoneEnabled === true
    },
    clip: {
      paddingBeforeSeconds,
      paddingAfterSeconds,
      replayBufferSeconds: clamp(settings.clip?.replayBufferSeconds ?? defaults.clip.replayBufferSeconds, minReplayBufferSeconds, maxReplayBufferSeconds),
      replaySourceDir: settings.clip?.replaySourceDir ?? defaults.clip.replaySourceDir,
      outputDir: settings.clip?.outputDir ?? defaults.clip.outputDir
    },
    obs: {
      host: settings.obs?.host ?? defaults.obs.host,
      port: clamp(settings.obs?.port ?? defaults.obs.port, 1, 65535),
      passwordConfigured: settings.obs?.passwordConfigured ?? defaults.obs.passwordConfigured
    },
    tradeSource: {
      mode: 'terminal-window'
    },
    system: {
      launchAtLogin: settings.system?.launchAtLogin ?? defaults.system.launchAtLogin,
      proxyPaymentNotificationsEnabled: settings.system?.proxyPaymentNotificationsEnabled ?? defaults.system.proxyPaymentNotificationsEnabled,
      clipSuccessNotificationsEnabled: settings.system?.clipSuccessNotificationsEnabled ?? defaults.system.clipSuccessNotificationsEnabled,
      paymentReminderDaysBefore: clamp(settings.system?.paymentReminderDaysBefore ?? defaults.system.paymentReminderDaysBefore, 0, 30)
    },
    proxyRuntime: normalizeProxyRuntime(settings.proxyRuntime ?? defaults.proxyRuntime),
    proxies: normalizeProxyRecords(settings.proxies)
  }
}
