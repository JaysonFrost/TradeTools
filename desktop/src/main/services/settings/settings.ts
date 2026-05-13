import { join } from 'node:path'

export type AppSettings = {
  language: 'ru'
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
  access: {
    subscriptionRequired: boolean
    telegramBotRequired: boolean
    discordGuildGateEnabled: boolean
    adminPanelEnabled: boolean
  }
}

export type PartialSettings = Partial<{
  language: string
  clip: Partial<AppSettings['clip']>
  obs: Partial<AppSettings['obs']>
  access: Partial<AppSettings['access']>
}>

export type SettingsUpdateInput = PartialSettings & {
  obsPassword?: string
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

export const createDefaultSettings = (appDataDir: string): AppSettings => ({
  language: 'ru',
  clip: {
    paddingBeforeSeconds: 3,
    paddingAfterSeconds: 5,
    replayBufferSeconds: 1800,
    replaySourceDir: join(appDataDir, 'obs-replays'),
    outputDir: join(appDataDir, 'clips')
  },
  obs: {
    host: '127.0.0.1',
    port: 4455,
    passwordConfigured: false
  },
  access: {
    subscriptionRequired: true,
    telegramBotRequired: true,
    discordGuildGateEnabled: true,
    adminPanelEnabled: true
  }
})

export const normalizeSettings = (settings: PartialSettings, appDataDir: string): AppSettings => {
  const defaults = createDefaultSettings(appDataDir)

  return {
    language: 'ru',
    clip: {
      paddingBeforeSeconds: clamp(settings.clip?.paddingBeforeSeconds ?? defaults.clip.paddingBeforeSeconds, 0, 60),
      paddingAfterSeconds: clamp(settings.clip?.paddingAfterSeconds ?? defaults.clip.paddingAfterSeconds, 0, 60),
      replayBufferSeconds: clamp(settings.clip?.replayBufferSeconds ?? defaults.clip.replayBufferSeconds, 120, 7200),
      replaySourceDir: settings.clip?.replaySourceDir ?? defaults.clip.replaySourceDir,
      outputDir: settings.clip?.outputDir ?? defaults.clip.outputDir
    },
    obs: {
      host: settings.obs?.host ?? defaults.obs.host,
      port: clamp(settings.obs?.port ?? defaults.obs.port, 1, 65535),
      passwordConfigured: settings.obs?.passwordConfigured ?? defaults.obs.passwordConfigured
    },
    access: {
      subscriptionRequired: settings.access?.subscriptionRequired ?? defaults.access.subscriptionRequired,
      telegramBotRequired: settings.access?.telegramBotRequired ?? defaults.access.telegramBotRequired,
      discordGuildGateEnabled: settings.access?.discordGuildGateEnabled ?? defaults.access.discordGuildGateEnabled,
      adminPanelEnabled: settings.access?.adminPanelEnabled ?? defaults.access.adminPanelEnabled
    }
  }
}
