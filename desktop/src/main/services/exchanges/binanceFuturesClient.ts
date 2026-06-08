import { createHmac } from 'node:crypto'
import type { BinanceFuturesCredentials } from '../security/secretStore'
import type { BinanceFuturesPosition } from './binanceFuturesTradeState'
import { reconstructClosedTradesFromAccountTrades, type BinanceFuturesAccountTrade } from './binanceFuturesTradeHistory'
import type { ClosedTrade } from '../trades/simulatedTradePipeline'

export type BinanceFuturesConnectionStatus = {
  ok: boolean
  message: string
  openPositions?: number
}

export type BinanceFuturesClientDeps = {
  credentials: BinanceFuturesCredentials
  testnet?: boolean
  now?: () => number
  fetch?: typeof fetch
}

export type BinanceFuturesClient = {
  testConnection: () => Promise<BinanceFuturesConnectionStatus>
  listPositions: () => Promise<BinanceFuturesPosition[]>
  listRecentClosedTrades: (input: BinanceFuturesHistoryInput) => Promise<ClosedTrade[]>
}

export type BinanceFuturesHistoryInput = {
  startTimeMs: number
  endTimeMs: number
}

type BinanceAccountPosition = {
  symbol?: string
  positionAmt?: string
  updateTime?: number
}

type BinanceAccountResponse = {
  positions?: BinanceAccountPosition[]
}

type BinanceIncomeRecord = {
  symbol?: string
  incomeType?: string
  time?: number
}

type BinanceAccountTradeResponseItem = Partial<BinanceFuturesAccountTrade>

type BinanceErrorResponse = {
  msg?: string
}

const productionBaseUrl = 'https://fapi.binance.com'
const testnetBaseUrl = 'https://testnet.binancefuture.com'

const signQuery = (query: string, apiSecret: string): string => createHmac('sha256', apiSecret).update(query).digest('hex')

const countOpenPositions = (response: BinanceAccountResponse): number =>
  response.positions?.filter((position) => Number(position.positionAmt ?? '0') !== 0).length ?? 0

const normalizePositions = (response: BinanceAccountResponse): BinanceFuturesPosition[] =>
  response.positions
    ?.filter((position): position is BinanceAccountPosition & { symbol: string, positionAmt: string } => Boolean(position.symbol && position.positionAmt !== undefined))
    .map((position) => ({
      symbol: position.symbol,
      positionAmt: position.positionAmt,
      ...(Number.isFinite(position.updateTime) && (position.updateTime ?? 0) > 0 ? { updateTime: position.updateTime } : {})
    })) ?? []

const normalizeIncomeRecords = (response: unknown): BinanceIncomeRecord[] =>
  Array.isArray(response)
    ? response.filter((record): record is BinanceIncomeRecord => {
      const item = record as BinanceIncomeRecord
      return item.incomeType === 'REALIZED_PNL' && Boolean(item.symbol) && Number.isFinite(item.time)
    })
    : []

const normalizeAccountTrades = (response: unknown): BinanceFuturesAccountTrade[] =>
  Array.isArray(response)
    ? response.filter((record): record is BinanceFuturesAccountTrade => {
      const item = record as BinanceAccountTradeResponseItem
      return Boolean(item.symbol && item.side && item.qty !== undefined && Number.isFinite(item.time))
    })
    : []

const uniqueClosedTrades = (trades: ClosedTrade[]): ClosedTrade[] => {
  const seen = new Set<string>()
  return trades.filter((trade) => {
    if (seen.has(trade.id)) return false
    seen.add(trade.id)
    return true
  })
}

const restrictedLocationMessage = 'Binance.com Futures API недоступен для текущей локации или аккаунта. TradeTools не может получать сделки через этот API; используйте биржу/API, доступные в вашей юрисдикции.'

const normalizeBinanceErrorMessage = (message: string): string => {
  const normalized = message.toLowerCase()
  return normalized.includes('restricted location') || normalized.includes('eligibility')
    ? restrictedLocationMessage
    : message
}

const binanceErrorMessage = (payload: unknown, fallback: string): string => {
  if (payload && typeof payload === 'object' && 'msg' in payload && typeof payload.msg === 'string') {
    return normalizeBinanceErrorMessage(payload.msg)
  }

  return normalizeBinanceErrorMessage(fallback)
}

export const createBinanceFuturesClient = (deps: BinanceFuturesClientDeps): BinanceFuturesClient => {
  const now = deps.now ?? (() => Date.now())
  const fetchImpl = deps.fetch ?? fetch
  const baseUrl = deps.testnet ? testnetBaseUrl : productionBaseUrl

  const signedUrl = (path: string, params: Record<string, string | number | undefined> = {}): string => {
    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) searchParams.set(key, String(value))
    }
    searchParams.set('timestamp', String(now()))
    const query = searchParams.toString()
    const signature = signQuery(query, deps.credentials.apiSecret)
    return `${baseUrl}${path}?${query}&signature=${signature}`
  }

  const getSignedJson = async <T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> => {
    const response = await fetchImpl(signedUrl(path, params), {
      method: 'GET',
      headers: {
        'X-MBX-APIKEY': deps.credentials.apiKey
      }
    })
    const payload = await response.json() as T | BinanceErrorResponse

    if (!response.ok) {
      const message = binanceErrorMessage(payload, `HTTP ${response.status}`)
      throw new Error(message)
    }

    return payload as T
  }

  const getAccount = async (): Promise<BinanceAccountResponse | BinanceErrorResponse> =>
    getSignedJson<BinanceAccountResponse | BinanceErrorResponse>('/fapi/v3/account')

  const listRealizedPnlIncome = async (input: BinanceFuturesHistoryInput): Promise<BinanceIncomeRecord[]> =>
    normalizeIncomeRecords(await getSignedJson<unknown>('/fapi/v1/income', {
      incomeType: 'REALIZED_PNL',
      startTime: input.startTimeMs,
      endTime: input.endTimeMs,
      limit: 1000
    }))

  const listAccountTrades = async (symbol: string, input: BinanceFuturesHistoryInput): Promise<BinanceFuturesAccountTrade[]> =>
    normalizeAccountTrades(await getSignedJson<unknown>('/fapi/v1/userTrades', {
      symbol,
      startTime: input.startTimeMs,
      endTime: input.endTimeMs,
      limit: 1000
    }))

  return {
    async testConnection() {
      try {
        const payload = await getAccount()
        const openPositions = countOpenPositions(payload as BinanceAccountResponse)
        return {
          ok: true,
          message: `Binance Futures подключён, открытых позиций: ${openPositions}`,
          openPositions
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'неизвестная ошибка'
        return {
          ok: false,
          message: `Binance Futures недоступен: ${message}`
        }
      }
    },
    async listPositions() {
      return normalizePositions(await getAccount() as BinanceAccountResponse)
    },
    async listRecentClosedTrades(input) {
      const incomeRecords = await listRealizedPnlIncome(input)
      const symbols = [...new Set(incomeRecords.map((record) => record.symbol).filter((symbol): symbol is string => Boolean(symbol)))]
      if (symbols.length === 0) return []

      const accountTrades = (await Promise.all(symbols.map((symbol) => listAccountTrades(symbol, input)))).flat()
      return uniqueClosedTrades(reconstructClosedTradesFromAccountTrades(accountTrades)
        .filter((trade) => trade.exitTimeMs >= input.startTimeMs && trade.exitTimeMs <= input.endTimeMs))
    }
  }
}
