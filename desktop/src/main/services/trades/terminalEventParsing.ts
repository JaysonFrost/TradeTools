import { normalizeTerminalSymbolToken } from '../../../shared/terminalSymbol'

const zeroTolerance = 1e-12

export const normalizeText = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

export const normalizeAnyText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return ''
}

export const parseNumericValue = (value: unknown): number => {
  if (typeof value === 'number') return value
  const text = normalizeAnyText(value).replace(',', '.')
  if (!text) return Number.NaN
  return Number(text)
}

export const isNearlyZero = (value: number): boolean => Number.isFinite(value) && Math.abs(value) <= zeroTolerance

export const getField = (record: unknown, names: string[]): unknown => {
  if (!record || typeof record !== 'object') return undefined
  const entries = Object.entries(record as Record<string, unknown>)
  for (const name of names) {
    const match = entries.find(([key]) => key.toLowerCase() === name.toLowerCase())
    if (match) return match[1]
  }
  return undefined
}

export const normalizeTerminalSymbol = (value: unknown, fallback = 'TERMINAL'): string => {
  return normalizeTerminalSymbolToken(value) || fallback
}

export const normalizeExchangeName = (value: unknown, fallback: string): string => {
  const text = normalizeAnyText(value)
  if (!text) return fallback
  const firstChunk = text.split(/[\s:|/\\-]+/).find(Boolean) ?? text
  return firstChunk.toUpperCase().replace(/[^A-Z0-9]+/g, '') || fallback
}

export const normalizeSideFromSize = (size: number, fallback: unknown = undefined): string => {
  if (Number.isFinite(size) && !isNearlyZero(size)) return size > 0 ? 'LONG' : 'SHORT'

  const side = normalizeAnyText(fallback).toLowerCase()
  if (['buy', 'long', 'bought', '1'].includes(side)) return 'LONG'
  if (['sell', 'short', 'sold', '2', '-1'].includes(side)) return 'SHORT'
  return 'TRADE'
}

export const parseLocalDateTime = (
  day: string,
  month: string,
  year: string,
  hour: string,
  minute: string,
  second: string,
  millisecond = '0'
): number => {
  const time = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond.padEnd(3, '0').slice(0, 3))
  ).getTime()
  return Number.isFinite(time) && time > 0 ? time : 0
}

export const parseMaybeTime = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? value * 1000 : value
  }

  const text = normalizeAnyText(value)
  if (!text) return 0
  const localMatch = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(text)
  if (localMatch) {
    return parseLocalDateTime(localMatch[1], localMatch[2], localMatch[3], localMatch[4], localMatch[5], localMatch[6], localMatch[7] ?? '0')
  }

  const parsed = Date.parse(text)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}
