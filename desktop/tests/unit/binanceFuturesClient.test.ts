import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createBinanceFuturesClient } from '../../src/main/services/exchanges/binanceFuturesClient'

const signatureFor = (query: string): string => createHmac('sha256', 'api-secret').update(query).digest('hex')

describe('binanceFuturesClient', () => {
  it('signs account requests with API key header and HMAC query signature', async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => new Response(JSON.stringify({
      assets: [],
      positions: [
        { symbol: 'BTCUSDT', positionAmt: '0' },
        { symbol: 'ETHUSDT', positionAmt: '1.25' }
      ]
    }), { status: 200 }))
    const client = createBinanceFuturesClient({
      credentials: { apiKey: 'api-key', apiSecret: 'api-secret' },
      now: () => 1_700_000_000_000,
      fetch: fetchMock as unknown as typeof fetch
    })

    await expect(client.testConnection()).resolves.toEqual({
      ok: true,
      message: 'Binance Futures подключён, открытых позиций: 1',
      openPositions: 1
    })

    const query = 'timestamp=1700000000000'
    expect(fetchMock).toHaveBeenCalledWith(
      `https://fapi.binance.com/fapi/v3/account?${query}&signature=${signatureFor(query)}`,
      {
        method: 'GET',
        headers: {
          'X-MBX-APIKEY': 'api-key'
        }
      }
    )
  })

  it('uses Binance Futures testnet base URL when enabled', async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => new Response(JSON.stringify({ positions: [] }), { status: 200 }))
    const client = createBinanceFuturesClient({
      credentials: { apiKey: 'api-key', apiSecret: 'api-secret' },
      testnet: true,
      now: () => 1_700_000_000_000,
      fetch: fetchMock as unknown as typeof fetch
    })

    await client.testConnection()

    expect(fetchMock).toHaveBeenCalled()
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('https://testnet.binancefuture.com/fapi/v3/account')
  })

  it('returns Binance error messages for failed account checks', async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => new Response(JSON.stringify({
      code: -2015,
      msg: 'Invalid API-key, IP, or permissions for action.'
    }), { status: 401 }))
    const client = createBinanceFuturesClient({
      credentials: { apiKey: 'api-key', apiSecret: 'api-secret' },
      now: () => 1_700_000_000_000,
      fetch: fetchMock as unknown as typeof fetch
    })

    await expect(client.testConnection()).resolves.toEqual({
      ok: false,
      message: 'Binance Futures недоступен: Invalid API-key, IP, or permissions for action.'
    })
  })

  it('explains Binance restricted-location errors in Russian', async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => new Response(JSON.stringify({
      code: 0,
      msg: "Service unavailable from a restricted location according to 'b. Eligibility' in https://www.binance.com/en/terms. Please contact customer service if you believe you received this message in error."
    }), { status: 451 }))
    const client = createBinanceFuturesClient({
      credentials: { apiKey: 'api-key', apiSecret: 'api-secret' },
      now: () => 1_700_000_000_000,
      fetch: fetchMock as unknown as typeof fetch
    })

    await expect(client.testConnection()).resolves.toEqual({
      ok: false,
      message: 'Binance Futures недоступен: Binance.com Futures API недоступен для текущей локации или аккаунта. TradeTools не может получать сделки через этот API; используйте биржу/API, доступные в вашей юрисдикции.'
    })
  })

  it('throws a Russian restricted-location error while polling positions', async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => new Response(JSON.stringify({
      msg: "Service unavailable from a restricted location according to 'b. Eligibility' in https://www.binance.com/en/terms."
    }), { status: 451 }))
    const client = createBinanceFuturesClient({
      credentials: { apiKey: 'api-key', apiSecret: 'api-secret' },
      now: () => 1_700_000_000_000,
      fetch: fetchMock as unknown as typeof fetch
    })

    await expect(client.listPositions()).rejects.toThrow('Binance.com Futures API недоступен для текущей локации или аккаунта')
  })

  it('lists current futures positions from the signed account response', async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => new Response(JSON.stringify({
      positions: [
        { symbol: 'BTCUSDT', positionAmt: '0' },
        { symbol: 'ETHUSDT', positionAmt: '-1.5', updateTime: 1_778_672_345_000 }
      ]
    }), { status: 200 }))
    const client = createBinanceFuturesClient({
      credentials: { apiKey: 'api-key', apiSecret: 'api-secret' },
      now: () => 1_700_000_000_000,
      fetch: fetchMock as unknown as typeof fetch
    })

    await expect(client.listPositions()).resolves.toEqual([
      { symbol: 'BTCUSDT', positionAmt: '0' },
      { symbol: 'ETHUSDT', positionAmt: '-1.5', updateTime: 1_778_672_345_000 }
    ])
  })

  it('reconstructs recently closed trades from realized PnL income and account trades', async () => {
    const entryTimeMs = Date.parse('2026-05-13T12:00:00.000Z')
    const exitTimeMs = Date.parse('2026-05-13T12:04:00.000Z')
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(String(input))
      if (url.pathname === '/fapi/v1/income') {
        return new Response(JSON.stringify([
          { symbol: 'BTCUSDT', incomeType: 'REALIZED_PNL', income: '42.5', time: exitTimeMs, tranId: 9001 }
        ]), { status: 200 })
      }

      if (url.pathname === '/fapi/v1/userTrades') {
        return new Response(JSON.stringify([
          { symbol: 'BTCUSDT', id: 101, orderId: 5001, side: 'BUY', positionSide: 'BOTH', qty: '0.25', time: entryTimeMs, realizedPnl: '0' },
          { symbol: 'BTCUSDT', id: 102, orderId: 5002, side: 'SELL', positionSide: 'BOTH', qty: '0.25', time: exitTimeMs, realizedPnl: '42.5' }
        ]), { status: 200 })
      }

      return new Response(JSON.stringify({ msg: 'unexpected path' }), { status: 404 })
    })
    const client = createBinanceFuturesClient({
      credentials: { apiKey: 'api-key', apiSecret: 'api-secret' },
      now: () => 1_778_673_000_000,
      fetch: fetchMock as unknown as typeof fetch
    })

    await expect(client.listRecentClosedTrades({
      startTimeMs: Date.parse('2026-05-13T11:55:00.000Z'),
      endTimeMs: Date.parse('2026-05-13T12:05:00.000Z')
    })).resolves.toEqual([
      {
        id: `binance-futures-BTCUSDT-${entryTimeMs}`,
        exchange: 'BINANCE',
        marketType: 'FUTURES',
        symbol: 'BTCUSDT',
        side: 'LONG',
        status: 'closed',
        entryTimeMs,
        exitTimeMs
      }
    ])

    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('incomeType')).toBe('REALIZED_PNL')
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get('symbol')).toBe('BTCUSDT')
  })
})
