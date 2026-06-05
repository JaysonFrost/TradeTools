import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import type { GoogleOAuthCredentials, GoogleOAuthTokens } from '../security/secretStore'
import { formatGoogleOAuthTokenError } from './googleOAuthErrors'

export type YouTubePrivacyStatus = 'private' | 'unlisted' | 'public'

export type YouTubeUploadVideoInput = {
  videoPath: string
  title: string
  description?: string
  privacyStatus: YouTubePrivacyStatus
}

export type YouTubeUploadVideoResult = {
  videoId: string
  youtubeUrl: string
}

export type YouTubeUploaderDeps = {
  getCredentials: () => Promise<GoogleOAuthCredentials | undefined>
  getTokens: () => Promise<GoogleOAuthTokens | undefined>
  setTokens: (tokens: GoogleOAuthTokens) => Promise<void>
  fetch?: typeof fetch
  now?: () => number
}

export type YouTubeUploader = {
  uploadVideo: (input: YouTubeUploadVideoInput) => Promise<YouTubeUploadVideoResult>
}

type GoogleRefreshTokenResponse = {
  access_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

type YouTubeVideoResponse = {
  id?: string
  error?: {
    message?: string
  }
}

const tokenEndpoint = 'https://oauth2.googleapis.com/token'
const uploadEndpoint = 'https://www.googleapis.com/upload/youtube/v3/videos'

const mimeTypes = new Map([
  ['.mp4', 'video/mp4'],
  ['.mkv', 'video/x-matroska'],
  ['.mov', 'video/quicktime'],
  ['.flv', 'video/x-flv'],
  ['.ts', 'video/mp2t']
])

const mimeTypeForPath = (videoPath: string): string => mimeTypes.get(extname(videoPath).toLowerCase()) ?? 'application/octet-stream'

const responseError = async (response: Response): Promise<string> => {
  try {
    const payload = await response.json() as YouTubeVideoResponse & GoogleRefreshTokenResponse
    return payload.error?.message ?? payload.error_description ?? payload.error ?? `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

export const createYouTubeUploader = (deps: YouTubeUploaderDeps): YouTubeUploader => {
  const fetchImpl = deps.fetch ?? fetch
  const now = deps.now ?? (() => Date.now())

  const refreshAccessToken = async (credentials: GoogleOAuthCredentials, tokens: GoogleOAuthTokens): Promise<GoogleOAuthTokens> => {
    if (!tokens.refreshToken) throw new Error('Google OAuth refresh token не сохранён. Авторизуйтесь в Google заново.')
    const body = new URLSearchParams({
      client_id: credentials.clientId,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken
    })
    if (credentials.clientSecret) body.set('client_secret', credentials.clientSecret)

    const response = await fetchImpl(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    const payload = await response.json() as GoogleRefreshTokenResponse

    if (!response.ok || !payload.access_token) {
      throw new Error(formatGoogleOAuthTokenError(payload, response.status))
    }

    const nextTokens: GoogleOAuthTokens = {
      ...tokens,
      accessToken: payload.access_token,
      expiresAtMs: now() + Math.max(0, payload.expires_in ?? 0) * 1_000,
      scope: payload.scope ?? tokens.scope,
      tokenType: payload.token_type ?? tokens.tokenType
    }
    await deps.setTokens(nextTokens)
    return nextTokens
  }

  const getValidTokens = async (): Promise<GoogleOAuthTokens> => {
    const [credentials, tokens] = await Promise.all([deps.getCredentials(), deps.getTokens()])
    if (!credentials) throw new Error('Google OAuth не настроен в этой сборке приложения')
    if (!tokens) throw new Error('Google OAuth не авторизован')
    if (tokens.expiresAtMs > now() + 60_000) return tokens
    return refreshAccessToken(credentials, tokens)
  }

  return {
    async uploadVideo(input) {
      const tokens = await getValidTokens()
      const fileStat = await stat(input.videoPath)
      const mimeType = mimeTypeForPath(input.videoPath)
      const metadata = {
        snippet: {
          title: input.title,
          description: input.description ?? '',
          categoryId: '22'
        },
        status: {
          privacyStatus: input.privacyStatus
        }
      }

      const startResponse = await fetchImpl(`${uploadEndpoint}?uploadType=resumable&part=snippet,status`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(fileStat.size),
          'X-Upload-Content-Type': mimeType
        },
        body: JSON.stringify(metadata)
      })
      if (!startResponse.ok) throw new Error(`YouTube upload init failed: ${await responseError(startResponse)}`)

      const uploadUrl = startResponse.headers.get('location')
      if (!uploadUrl) throw new Error('YouTube не вернул resumable upload URL')

      const videoBuffer = await readFile(input.videoPath)
      const uploadResponse = await fetchImpl(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Length': String(fileStat.size),
          'Content-Type': mimeType
        },
        body: new Uint8Array(videoBuffer)
      })
      if (!uploadResponse.ok) throw new Error(`YouTube upload failed: ${await responseError(uploadResponse)}`)

      const payload = await uploadResponse.json() as YouTubeVideoResponse
      if (!payload.id) throw new Error('YouTube не вернул video id после загрузки')

      return {
        videoId: payload.id,
        youtubeUrl: `https://youtu.be/${payload.id}`
      }
    }
  }
}
