import { describe, expect, it } from 'vitest'
import type { WindowCaptureSource } from '../../src/main/services/recording/windowRecorderService'
import { detectSupportedTerminalWindow, isSupportedTerminalWindowName } from '../../src/shared/supportedTerminalWindows'
import { findAutoRecordedTerminalSources, findPreferredTerminalSource } from '../../src/renderer/lib/windowCaptureSources'

const source = (name: string): WindowCaptureSource => ({
  id: `window:${name}`,
  name,
  displayId: '',
  type: 'window'
})

describe('windowCaptureSources', () => {
  it.each([
    ['Vataga.terminal', 'vataga'],
    ['Ватага - SOLUSDT', 'vataga'],
    ['Tiger', 'tigertrade'],
    ['TigerTrade - BTCUSDT', 'tigertrade'],
    ['Tiger.com - ETH/USDT', 'tigertrade'],
    ['LootX', 'lootx'],
    ['Loot X - Trading Terminal', 'lootx'],
    ['MetaScalp - XRPUSDT', 'metascalp']
  ] as const)('classifies the supported terminal window %s', (name, terminal) => {
    expect(detectSupportedTerminalWindow(name)).toBe(terminal)
    expect(isSupportedTerminalWindowName(name)).toBe(true)
  })

  it.each([
    'Happ 3.3.6 (591)',
    'TradingView - BTCUSDT',
    'MetaTrader 5',
    'Binance',
    'Generic trading terminal',
    'Parallels Desktop',
    'TradeTools',
    'LootX - Google Chrome',
    'TradeTools - LootX clip',
    'LootX support - Codex',
    'MetaScalp parser - DevTools'
  ])('rejects the unsupported window %s', (name) => {
    expect(detectSupportedTerminalWindow(name)).toBeUndefined()
    expect(isSupportedTerminalWindowName(name)).toBe(false)
  })

  it('returns every open supported trading terminal and deduplicates source ids', () => {
    const tiger = source('Tiger.com - BTCUSDT')
    tiger.id = 'window:tiger'
    const duplicateTiger = { ...tiger, name: 'Tiger.com - ETHUSDT' }
    const terminals = findAutoRecordedTerminalSources([
      source('TradeTools'),
      source('Vataga - SOLUSDT'),
      tiger,
      duplicateTiger,
      source('LootX'),
      source('MetaScalp - XRPUSDT'),
      source('TradingView'),
      { ...source('LootX screen'), id: 'screen:lootx', type: 'screen' }
    ])

    expect(terminals.map((terminal) => terminal.id)).toEqual([
      'window:Vataga - SOLUSDT',
      'window:tiger',
      'window:LootX',
      'window:MetaScalp - XRPUSDT'
    ])
  })

  it('prefers only a supported terminal and never falls back to an unrelated window', () => {
    expect(findPreferredTerminalSource([
      source('Happ 3.3.6 (591)'),
      source('LootX')
    ])?.name).toBe('LootX')
    expect(findPreferredTerminalSource([
      source('Happ 3.3.6 (591)'),
      source('TradingView')
    ])).toBeUndefined()
  })
})
