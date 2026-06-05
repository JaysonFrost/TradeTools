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
  exchange: {
    binanceFutures: {
      enabled: boolean
      testnet: boolean
      apiKeyConfigured: boolean
      apiSecretConfigured: boolean
    }
  }
  youtube: {
    oauthClientConfigured: boolean
    authorized: boolean
    defaultPrivacyStatus: 'private' | 'unlisted' | 'public'
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
  exchange: {
    binanceFutures?: Partial<AppSettings['exchange']['binanceFutures']>
  }
  youtube: Partial<AppSettings['youtube']>
  access: Partial<AppSettings['access']>
}>

export type SettingsUpdateInput = PartialSettings & {
  obsPassword?: string
  binanceFuturesApiKey?: string
  binanceFuturesApiSecret?: string
  googleOAuthClientId?: string
  googleOAuthClientSecret?: string
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const normalizePrivacyStatus = (value: unknown, fallback: AppSettings['youtube']['defaultPrivacyStatus']): AppSettings['youtube']['defaultPrivacyStatus'] => {
  return value === 'public' || value === 'unlisted' || value === 'private' ? value : fallback
}

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
  exchange: {
    binanceFutures: {
      enabled: false,
      testnet: false,
      apiKeyConfigured: false,
      apiSecretConfigured: false
    }
  },
  youtube: {
    oauthClientConfigured: false,
    authorized: false,
    defaultPrivacyStatus: 'private'
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
    exchange: {
      binanceFutures: {
        enabled: settings.exchange?.binanceFutures?.enabled ?? defaults.exchange.binanceFutures.enabled,
        testnet: settings.exchange?.binanceFutures?.testnet ?? defaults.exchange.binanceFutures.testnet,
        apiKeyConfigured: settings.exchange?.binanceFutures?.apiKeyConfigured ?? defaults.exchange.binanceFutures.apiKeyConfigured,
        apiSecretConfigured: settings.exchange?.binanceFutures?.apiSecretConfigured ?? defaults.exchange.binanceFutures.apiSecretConfigured
      }
    },
    youtube: {
      oauthClientConfigured: settings.youtube?.oauthClientConfigured ?? defaults.youtube.oauthClientConfigured,
      authorized: settings.youtube?.authorized ?? defaults.youtube.authorized,
      defaultPrivacyStatus: normalizePrivacyStatus(settings.youtube?.defaultPrivacyStatus, defaults.youtube.defaultPrivacyStatus)
    },
    access: {
      subscriptionRequired: settings.access?.subscriptionRequired ?? defaults.access.subscriptionRequired,
      telegramBotRequired: settings.access?.telegramBotRequired ?? defaults.access.telegramBotRequired,
      discordGuildGateEnabled: settings.access?.discordGuildGateEnabled ?? defaults.access.discordGuildGateEnabled,
      adminPanelEnabled: settings.access?.adminPanelEnabled ?? defaults.access.adminPanelEnabled
    }
  }
}
