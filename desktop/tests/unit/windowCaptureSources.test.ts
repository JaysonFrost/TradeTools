import { describe, expect, it } from 'vitest'
import type { WindowCaptureSource } from '../../src/main/services/recording/windowRecorderService'
import { findAutoRecordedTerminalSources, findPreferredTerminalSource } from '../../src/renderer/lib/windowCaptureSources'

const source = (name: string): WindowCaptureSource => ({
  id: `window:${name}`,
  name,
  displayId: '',
  type: 'window'
})

describe('windowCaptureSources', () => {
  it('recognizes macOS terminal wrapper windows before generic app windows', () => {
    const preferred = findPreferredTerminalSource([
      source('TradeTools'),
      source('Finder'),
      source('Parallels Desktop'),
      source('iTerm2')
    ])

    expect(preferred?.name).toBe('Parallels Desktop')
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
      source('MetaScalp - XRPUSDT'),
      source('TradingView')
    ])

    expect(terminals.map((terminal) => terminal.id)).toEqual([
      'window:Vataga - SOLUSDT',
      'window:tiger',
      'window:MetaScalp - XRPUSDT'
    ])
  })
})
