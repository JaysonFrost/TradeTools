import { describe, expect, it, vi } from 'vitest'
import { findTmmTradeUrl, findTmmTradeUrls, updateTmmTradeVideoPath } from '../../src/main/services/trades/tmmTradeMatcher'

describe('tmmTradeMatcher', () => {
  it('writes the local clip path into the matched TMM trade video link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'success' })))
    const fetch = fetchMock as unknown as typeof globalThis.fetch
    const videoPath = 'C:\\Users\\Igor\\Videos\\BTCUSDT 06.08.26.mp4'

    await expect(updateTmmTradeVideoPath({
      apiKey: 'tmm-key',
      tradeUrl: 'https://tradermake.money/app2/account/my-trades/42',
      videoPath
    }, { fetch })).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://tradermake.money/api/v2/trades/42/update',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'API-KEY': 'tmm-key',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ video_link: videoPath })
      })
    )
  })

  it('does not update an invalid trade URL and reports rejected TMM updates', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    const fetch = fetchMock as unknown as typeof globalThis.fetch

    await expect(updateTmmTradeVideoPath({
      apiKey: 'tmm-key',
      tradeUrl: 'https://example.com/trades/42',
      videoPath: 'C:\\clips\\trade.mp4'
    }, { fetch })).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()

    await expect(updateTmmTradeVideoPath({
      apiKey: 'tmm-key',
      tradeUrl: 'https://tradermake.money/app2/account/my-trades/42',
      videoPath: 'C:\\clips\\trade.mp4'
    }, { fetch })).resolves.toBe(false)
  })

  it('finds the closest same-symbol trade within the time tolerance and builds its journal URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: 31, symbol: 'BTC/USDT', open_time: 1_784_168_400, close_time: 1_784_168_470_000 },
        { id: 32, symbol: 'BTCUSDT', open_time: 1_784_168_410, close_time: 1_784_168_500_000 },
        { id: 33, symbol: 'ETHUSDT', open_time: 1_784_168_400, close_time: 1_784_168_470_000 }
      ]
    })))
    const fetch = fetchMock as unknown as typeof globalThis.fetch

    const url = await findTmmTradeUrl({
      apiKey: 'tmm-key',
      trade: {
        symbol: 'BTCUSDT',
        entryTimeMs: 1_784_168_400_000,
        exitTimeMs: 1_784_168_470_000
      }
    }, { fetch })

    expect(url).toBe('https://tradermake.money/app2/account/my-trades/31')
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(requestUrl.pathname).toBe('/api/v2/trades/')
    expect(requestUrl.searchParams.get('symbol')).toBe('BTCUSDT')
    expect(requestUrl.searchParams.get('openBetween')).toMatch(/^2026-07-\d{2},2026-07-\d{2}$/)
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ headers: { 'API-KEY': 'tmm-key' } }))
  })

  it('selects the nearest same-symbol trade when TMM timestamps differ by minutes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: 41, symbol: 'BTCUSDT', open_time: 1_784_168_880_000, close_time: 1_784_168_950_000 },
        { id: 42, symbol: 'BTC/USDT', open_time: 1_784_168_700_000, close_time: 1_784_168_770_000 }
      ]
    })))
    const fetch = fetchMock as unknown as typeof globalThis.fetch

    await expect(findTmmTradeUrl({
      apiKey: 'tmm-key',
      trade: { symbol: 'BTCUSDT', entryTimeMs: 1_784_168_400_000, exitTimeMs: 1_784_168_470_000 }
    }, { fetch })).resolves.toBe('https://tradermake.money/app2/account/my-trades/42')
  })

  it('does not link an unrelated same-symbol trade outside the safety window', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 31, symbol: 'BTCUSDT', open_time: 1_784_170_800_000, close_time: 1_784_170_870_000 }]
    })))
    const fetch = fetchMock as unknown as typeof globalThis.fetch

    await expect(findTmmTradeUrl({
      apiKey: 'tmm-key',
      trade: { symbol: 'BTCUSDT', entryTimeMs: 1_784_168_400_000, exitTimeMs: 1_784_168_470_000 }
    }, { fetch })).resolves.toBeUndefined()
  })

  it('synchronizes same-day trades for one ticker with one request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: 31, symbol: 'BTCUSDT', open_time: 1_784_168_400_000, close_time: 1_784_168_470_000 },
        { id: 32, symbol: 'BTCUSDT', open_time: 1_784_168_600_000, close_time: 1_784_168_680_000 }
      ]
    })))
    const fetch = fetchMock as unknown as typeof globalThis.fetch

    await expect(findTmmTradeUrls({
      apiKey: 'tmm-key',
      trades: [
        { symbol: 'BTCUSDT', entryTimeMs: 1_784_168_400_000, exitTimeMs: 1_784_168_470_000 },
        { symbol: 'BTC/USDT', entryTimeMs: 1_784_168_600_000, exitTimeMs: 1_784_168_680_000 }
      ]
    }, { fetch })).resolves.toEqual([
      'https://tradermake.money/app2/account/my-trades/31',
      'https://tradermake.money/app2/account/my-trades/32'
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('assigns each TMM trade to only one local clip', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: 31, symbol: 'BTCUSDT', open_time: 1_784_168_400_000, close_time: 1_784_168_470_000 },
        { id: 32, symbol: 'BTCUSDT', open_time: 1_784_168_550_000, close_time: 1_784_168_620_000 }
      ]
    })))
    const fetch = fetchMock as unknown as typeof globalThis.fetch

    await expect(findTmmTradeUrls({
      apiKey: 'tmm-key',
      trades: [
        { symbol: 'BTCUSDT', entryTimeMs: 1_784_168_410_000, exitTimeMs: 1_784_168_480_000 },
        { symbol: 'BTCUSDT', entryTimeMs: 1_784_168_430_000, exitTimeMs: 1_784_168_500_000 }
      ]
    }, { fetch })).resolves.toEqual([
      'https://tradermake.money/app2/account/my-trades/31',
      'https://tradermake.money/app2/account/my-trades/32'
    ])
  })
})
