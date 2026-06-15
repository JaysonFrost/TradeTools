import { describe, expect, it } from 'vitest'
import type { WindowCaptureSource } from '../../src/main/services/recording/windowRecorderService'
import { findPreferredTerminalSource } from '../../src/renderer/lib/windowCaptureSources'

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
})
