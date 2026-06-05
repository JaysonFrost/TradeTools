import { describe, expect, it } from 'vitest'
import { formatGoogleOAuthTokenError } from '../../src/main/services/youtube/googleOAuthErrors'

describe('googleOAuthErrors', () => {
  it('explains Google client_secret requirements in user-facing Russian', () => {
    expect(formatGoogleOAuthTokenError({
      error: 'invalid_request',
      error_description: 'client_secret is missing.'
    }, 400)).toContain('TRADECUT_GOOGLE_OAUTH_CLIENT_SECRET')
  })

  it('keeps the original Google message for unrelated OAuth errors', () => {
    expect(formatGoogleOAuthTokenError({
      error: 'invalid_grant',
      error_description: 'Bad Request'
    }, 400)).toBe('Bad Request')
  })
})
