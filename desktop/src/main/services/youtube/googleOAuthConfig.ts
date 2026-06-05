import type { GoogleOAuthCredentials } from '../security/secretStore'

export type GoogleOAuthEnv = Partial<Record<string, string>>

const bundledGoogleOAuthClientId = '174480335890-qig5c1401fi1hdvap3nuv3a9ipcsagqu.apps.googleusercontent.com'
const bundledGoogleOAuthClientSecret = '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'
const legacyEnvPrefix = ['TRADE', 'CLIPPER'].join('')

const firstValue = (env: GoogleOAuthEnv, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = env[key]?.trim()
    if (value) return value
  }

  return undefined
}

export const getGoogleOAuthCredentialsFromEnv = (env: GoogleOAuthEnv = process.env): GoogleOAuthCredentials | undefined => {
  const configuredClientId = firstValue(env, ['TRADECUT_GOOGLE_OAUTH_CLIENT_ID', `${legacyEnvPrefix}_GOOGLE_OAUTH_CLIENT_ID`, 'GOOGLE_OAUTH_CLIENT_ID'])
  const configuredClientSecret = firstValue(env, ['TRADECUT_GOOGLE_OAUTH_CLIENT_SECRET', `${legacyEnvPrefix}_GOOGLE_OAUTH_CLIENT_SECRET`, 'GOOGLE_OAUTH_CLIENT_SECRET'])
  const clientId = configuredClientId ?? bundledGoogleOAuthClientId
  const clientSecret = configuredClientSecret ?? (configuredClientId ? undefined : bundledGoogleOAuthClientSecret)

  return { clientId, clientSecret }
}
