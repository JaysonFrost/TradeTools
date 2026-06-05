import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { createYouTubeUploader } from '../../src/main/services/youtube/youtubeUploader'

describe('youtubeUploader', () => {
  it('uploads a clip with YouTube resumable videos.insert using the stored access token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tradecut-youtube-'))
    const videoPath = join(dir, 'BTCUSDT Binance 22.05.26 14:32:11.mp4')
    await writeFile(videoPath, 'fake video bytes')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', {
        status: 200,
        headers: { Location: 'https://upload.youtube.test/session' }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'youtube-video-id' }), { status: 201 }))
    const uploader = createYouTubeUploader({
      getCredentials: async () => ({ clientId: 'client-id', clientSecret: 'client-secret' }),
      getTokens: async () => ({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAtMs: Date.now() + 120_000,
        tokenType: 'Bearer'
      }),
      setTokens: vi.fn(),
      fetch: fetchMock as unknown as typeof fetch,
      now: () => Date.now()
    })

    await expect(uploader.uploadVideo({
      videoPath,
      title: 'BTCUSDT Binance 22.05.26 14:32:11',
      description: 'TradeCut export',
      privacyStatus: 'private'
    })).resolves.toEqual({
      videoId: 'youtube-video-id',
      youtubeUrl: 'https://youtu.be/youtube-video-id'
    })

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('https://www.googleapis.com/upload/youtube/v3/videos')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer access-token',
        'X-Upload-Content-Type': 'video/mp4'
      })
    })
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://upload.youtube.test/session')
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'PUT',
      headers: expect.objectContaining({
        Authorization: 'Bearer access-token',
        'Content-Type': 'video/mp4'
      })
    })
  })
})
