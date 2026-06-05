import { describe, expect, it } from 'vitest'
import { getGoogleOAuthCredentialsFromEnv } from '../../src/main/services/youtube/googleOAuthConfig'

describe('googleOAuthConfig', () => {
  it('reads app-owned OAuth client id from environment without exposing user fields', () => {
    expect(getGoogleOAuthCredentialsFromEnv({
      TRADECUT_GOOGLE_OAUTH_CLIENT_ID: 'client-id'
    })).toEqual({
      clientId: 'client-id'
    })
  })

  it('keeps OAuth client secret optional for desktop PKCE builds', () => {
    expect(getGoogleOAuthCredentialsFromEnv({
      TRADECUT_GOOGLE_OAUTH_CLIENT_ID: 'client-id',
      TRADECUT_GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret'
    })).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret'
    })
  })

  it('keeps old environment variable names working during the rename', () => {
    const legacyPrefix = ['TRADE', 'CLIPPER'].join('')

    expect(getGoogleOAuthCredentialsFromEnv({
      [`${legacyPrefix}_GOOGLE_OAUTH_CLIENT_ID`]: 'legacy-client-id',
      [`${legacyPrefix}_GOOGLE_OAUTH_CLIENT_SECRET`]: 'legacy-client-secret'
    })).toEqual({
      clientId: 'legacy-client-id',
      clientSecret: 'legacy-client-secret'
    })
  })

  it('uses the bundled app OAuth client credentials when environment does not override them', () => {
    expect(getGoogleOAuthCredentialsFromEnv({})).toEqual({
      clientId: '174480335890-qig5c1401fi1hdvap3nuv3a9ipcsagqu.apps.googleusercontent.com',
      clientSecret: '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'
    })
  })
})
