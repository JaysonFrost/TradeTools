import { describe, expect, it } from 'vitest'
import {
  advanceLootxJournalSnapshot,
  parseLootxJournalSnapshot
} from '../../src/main/services/trades/lootxJournal'

const connectionTag = 'lootx-account:F'

const createTrade = (timeMs: number, side: 'Bid' | 'Ask', quantity: number, execId: string | number = timeMs) => ({
  TimestampMs: timeMs,
  Instrument: { ExchangeId: 'BINANCEF', Symbol: 'IRYSUSDT' },
  Side: side,
  QuantityRaw: quantity,
  QuantityScale: 1,
  TradeId: execId === 'SYNTHETIC_SEED' ? 0 : execId,
  ExecId: execId,
  OrderId: execId === 'SYNTHETIC_SEED' ? 0 : `order-${timeMs}`,
  CumulativeFilledQtyRaw: quantity,
  ConnectionTag: connectionTag
})

const createFlatSpan = (fromMs: number, toMs = 0) => ({
  ExchangeId: 'BINANCEF',
  Symbol: 'IRYSUSDT',
  ConnectionTag: connectionTag,
  FromMs: fromMs,
  ToMs: toMs
})

const parseJournal = (trades: unknown[], flatSpans: unknown[] = []) => parseLootxJournalSnapshot(JSON.stringify({
  ResetTimestampMs: 10,
  Trades: trades,
  RoundTrips: [],
  FlatSpans: flatSpans
}))!

describe('lootxJournal', () => {
  const baseMs = 1_900_000_100_000

  it('reads only open-ended LootX flat spans', () => {
    const snapshot = parseJournal([], [createFlatSpan(baseMs, baseMs + 500), createFlatSpan(baseMs + 1_000)])

    expect([...snapshot.flatSinceMsByPosition]).toEqual([['LOOTX-ACCOUNT:F:BINANCEF:IRYSUSDT', baseMs + 1_000]])
  })

  it('does not reconstruct a phantom position when a synthetic seed entry was closed by a real fill', () => {
    const seed = createTrade(baseMs, 'Ask', 89, 'SYNTHETIC_SEED')
    const close = createTrade(baseMs + 8_000, 'Bid', 89)

    const withoutFlatSpan = advanceLootxJournalSnapshot(parseJournal([seed, close]))
    expect(withoutFlatSpan.openPositions).toMatchObject([{ size: 89, side: 'LONG' }])

    const withFlatSpan = advanceLootxJournalSnapshot(parseJournal([seed, close], [createFlatSpan(baseMs + 8_000)]))
    expect(withFlatSpan.events).toEqual([])
    expect(withFlatSpan.openPositions).toEqual([])
  })

  it('does not reconstruct a phantom position when LootX dropped the closing fill', () => {
    const entry = createTrade(baseMs, 'Ask', 19)

    const advance = advanceLootxJournalSnapshot(parseJournal([entry], [createFlatSpan(baseMs + 56_000)]))

    expect(advance.openPositions).toEqual([])
  })

  it('closes a tracked position when LootX reports it flat without a closing fill', () => {
    const entry = createTrade(baseMs, 'Ask', 19)
    const initial = advanceLootxJournalSnapshot(parseJournal([entry]))
    expect(initial.openPositions).toMatchObject([{ size: -19, side: 'SHORT' }])

    const flat = advanceLootxJournalSnapshot(parseJournal([entry], [createFlatSpan(baseMs + 56_000)]), initial.cursor)

    expect(flat.events).toMatchObject([
      { source: 'lootx', size: 0, side: 'SHORT', isClosed: true, eventTimeMs: baseMs + 56_000 }
    ])
    expect(flat.openPositions).toEqual([])

    const lateClose = createTrade(baseMs + 50_000, 'Bid', 19)
    const afterLateClose = advanceLootxJournalSnapshot(
      parseJournal([entry, lateClose], [createFlatSpan(baseMs + 56_000)]),
      flat.cursor
    )
    expect(afterLateClose.events).toEqual([])
    expect(afterLateClose.openPositions).toEqual([])
  })

  it('emits no trade when a new snapshot only shows the real close of a seeded entry', () => {
    const initial = advanceLootxJournalSnapshot(parseJournal([]))
    const seed = createTrade(baseMs, 'Ask', 89, 'SYNTHETIC_SEED')
    const close = createTrade(baseMs + 8_000, 'Bid', 89)

    const advance = advanceLootxJournalSnapshot(
      parseJournal([seed, close], [createFlatSpan(baseMs + 8_000)]),
      initial.cursor
    )

    expect(advance.events).toEqual([])
    expect(advance.openPositions).toEqual([])
  })

  it('keeps a position opened after the last flat span', () => {
    const entry = createTrade(baseMs + 2_000, 'Bid', 5)
    const initial = advanceLootxJournalSnapshot(parseJournal([]))

    const advance = advanceLootxJournalSnapshot(parseJournal([entry], [createFlatSpan(baseMs)]), initial.cursor)

    expect(advance.events).toMatchObject([
      { source: 'lootx', size: 5, side: 'LONG', isClosed: false, eventTimeMs: baseMs + 2_000 }
    ])
    expect(advance.openPositions).toMatchObject([{ size: 5, side: 'LONG' }])
  })

  it('keeps a complete quick round trip inside one snapshot', () => {
    const initial = advanceLootxJournalSnapshot(parseJournal([]))
    const entry = createTrade(baseMs, 'Bid', 5)
    const close = createTrade(baseMs + 500, 'Ask', 5)

    const advance = advanceLootxJournalSnapshot(
      parseJournal([entry, close], [createFlatSpan(baseMs + 500)]),
      initial.cursor
    )

    expect(advance.events).toMatchObject([
      { size: 5, isClosed: false, eventTimeMs: baseMs },
      { size: 0, isClosed: true, eventTimeMs: baseMs + 500 }
    ])
  })
})
