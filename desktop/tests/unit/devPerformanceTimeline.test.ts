import { performance, PerformanceObserver } from 'node:perf_hooks'
import { afterEach, expect, it, vi } from 'vitest'
import { startDevPerformanceCleanup } from '../../src/renderer/lib/devPerformanceTimeline'

afterEach(() => vi.unstubAllGlobals())

it('releases both buffered and newly produced render measurements', async () => {
  vi.stubGlobal('performance', performance)
  vi.stubGlobal('PerformanceObserver', PerformanceObserver)
  performance.measure('previous render', { start: 0, detail: { props: 'x'.repeat(10_000) } })
  const stop = startDevPerformanceCleanup()
  try {
    for (let batch = 0; batch < 2; batch += 1) {
      for (let i = 0; i < 100; i += 1) performance.measure('render', { start: 0 })
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(performance.getEntriesByType('measure')).toHaveLength(0)
    }
  } finally {
    stop()
    performance.clearMeasures()
  }
})
