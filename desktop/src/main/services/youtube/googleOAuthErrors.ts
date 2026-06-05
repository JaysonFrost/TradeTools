export type GoogleOAuthErrorPayload = {
  error?: string
  error_description?: string
}

export const formatGoogleOAuthTokenError = (payload: GoogleOAuthErrorPayload, status: number): string => {
  const message = payload.error_description ?? payload.error ?? `Google OAuth HTTP ${status}`
  if (message.toLowerCase().includes('client_secret is missing')) {
    return 'Google OAuth требует Client Secret для этого Client ID. В Google Cloud откройте этот OAuth Client и запустите TradeCut с переменной TRADECUT_GOOGLE_OAUTH_CLIENT_SECRET.'
  }

  return message
}
