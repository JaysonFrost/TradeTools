import { createHash, randomBytes } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { GoogleOAuthCredentials, GoogleOAuthTokens } from '../security/secretStore'
import { formatGoogleOAuthTokenError } from './googleOAuthErrors'

export type GoogleOAuthLoopbackDeps = {
  credentials: GoogleOAuthCredentials
  openExternal: (url: string) => Promise<unknown>
  fetch?: typeof fetch
  now?: () => number
}

type GoogleOAuthTokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

const authEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth'
const tokenEndpoint = 'https://oauth2.googleapis.com/token'
export const youtubeUploadScope = 'https://www.googleapis.com/auth/youtube.upload'

const base64Url = (value: Buffer): string => value
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/g, '')

const sendHtml = (response: ServerResponse, statusCode: number, body: string) => {
  response.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(body)
}

const exchangeAuthorizationCode = async (input: {
  credentials: GoogleOAuthCredentials
  code: string
  redirectUri: string
  codeVerifier: string
  fetchImpl: typeof fetch
  now: () => number
}): Promise<GoogleOAuthTokens> => {
  const body = new URLSearchParams({
    client_id: input.credentials.clientId,
    code: input.code,
    code_verifier: input.codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri
  })
  if (input.credentials.clientSecret) body.set('client_secret', input.credentials.clientSecret)

  const response = await input.fetchImpl(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const payload = await response.json() as GoogleOAuthTokenResponse

  if (!response.ok || !payload.access_token) {
    throw new Error(formatGoogleOAuthTokenError(payload, response.status))
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAtMs: input.now() + Math.max(0, payload.expires_in ?? 0) * 1_000,
    scope: payload.scope,
    tokenType: payload.token_type
  }
}

export const authorizeGoogleWithLoopback = async (deps: GoogleOAuthLoopbackDeps): Promise<GoogleOAuthTokens> => {
  const fetchImpl = deps.fetch ?? fetch
  const now = deps.now ?? (() => Date.now())
  const state = base64Url(randomBytes(24))
  const codeVerifier = base64Url(randomBytes(48))
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest())
  const server = createServer()

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      resolve(address.port)
    })
  })
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`

  const codePromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Google OAuth авторизация истекла по времени')), 300_000)

    server.on('request', (request, response) => {
      try {
        const requestUrl = new URL(request.url ?? '/', redirectUri)
        if (requestUrl.pathname !== '/oauth2callback') {
          sendHtml(response, 404, 'Not found')
          return
        }

        const error = requestUrl.searchParams.get('error')
        if (error) {
          sendHtml(response, 400, 'Google authorization failed. Return to TradeCut.')
          reject(new Error(error))
          return
        }

        if (requestUrl.searchParams.get('state') !== state) {
          sendHtml(response, 400, 'Invalid state. Return to TradeCut.')
          reject(new Error('Google OAuth state mismatch'))
          return
        }

        const code = requestUrl.searchParams.get('code')
        if (!code) {
          sendHtml(response, 400, 'Authorization code missing. Return to TradeCut.')
          reject(new Error('Google OAuth code missing'))
          return
        }

        clearTimeout(timeout)
        sendHtml(response, 200, 'Google authorization complete. You can return to TradeCut.')
        resolve(code)
      } catch (error) {
        reject(error)
      }
    })
  })

  try {
    const authUrl = new URL(authEndpoint)
    authUrl.search = new URLSearchParams({
      access_type: 'offline',
      client_id: deps.credentials.clientId,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'consent',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: youtubeUploadScope,
      state
    }).toString()

    await deps.openExternal(authUrl.toString())
    const code = await codePromise
    return await exchangeAuthorizationCode({
      credentials: deps.credentials,
      code,
      redirectUri,
      codeVerifier,
      fetchImpl,
      now
    })
  } finally {
    server.close()
  }
}
