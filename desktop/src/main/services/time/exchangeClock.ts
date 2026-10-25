export type ClockSample = {
  requestedAtMs: number
  serverTimeMs: number
  receivedAtMs: number
}

export type ExchangeClock = {
  offsetMs: () => number
  refresh: () => Promise<void>
  start: () => void
  stop: () => void
}

const maxSampleRoundTripMs = 1_500
const binanceServerTimeUrl = 'https://fapi.binance.com/fapi/v1/time'

export const estimateClockOffsetMs = (samples: ClockSample[]): number | undefined => {
  const best = samples
    .filter((sample) => (
      Number.isFinite(sample.serverTimeMs) &&
      sample.serverTimeMs > 0 &&
      sample.receivedAtMs >= sample.requestedAtMs &&
      sample.receivedAtMs - sample.requestedAtMs <= maxSampleRoundTripMs
    ))
    .sort((left, right) => (left.receivedAtMs - left.requestedAtMs) - (right.receivedAtMs - right.requestedAtMs))[0]
  return best ? Math.round(best.serverTimeMs - (best.requestedAtMs + best.receivedAtMs) / 2) : undefined
}

export const createExchangeClock = ({
  fetchServerTimeMs,
  now = Date.now,
  sampleCount = 3,
  refreshIntervalMs = 10 * 60_000,
  onOffset
}: {
  fetchServerTimeMs: () => Promise<number>
  now?: () => number
  sampleCount?: number
  refreshIntervalMs?: number
  onOffset?: (offsetMs: number) => void
}): ExchangeClock => {
  let offsetMs = 0
  let timer: NodeJS.Timeout | undefined

  const refresh = async () => {
    const samples: ClockSample[] = []
    for (let index = 0; index < sampleCount; index += 1) {
      try {
        const requestedAtMs = now()
        const serverTimeMs = await fetchServerTimeMs()
        samples.push({ requestedAtMs, serverTimeMs, receivedAtMs: now() })
      } catch {
        break
      }
    }
    const estimate = estimateClockOffsetMs(samples)
    if (estimate === undefined) return
    offsetMs = estimate
    onOffset?.(estimate)
  }

  return {
    offsetMs: () => offsetMs,
    refresh,
    start: () => {
      if (timer) return
      void refresh()
      timer = setInterval(() => void refresh(), refreshIntervalMs)
      timer.unref?.()
    },
    stop: () => {
      if (timer) clearInterval(timer)
      timer = undefined
    }
  }
}

export const fetchBinanceServerTimeMs = async (
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch,
  timeoutMs = 5_000
): Promise<number> => {
  const response = await fetcher(binanceServerTimeUrl, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = await response.json() as { serverTime?: unknown }
  const serverTimeMs = Number(body.serverTime)
  if (!Number.isFinite(serverTimeMs)) throw new Error('Binance server time is missing')
  return serverTimeMs
}
