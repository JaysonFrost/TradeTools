// React's development profiler retains a PerformanceMeasure for every render.
// ponytail: keep no dev measure history; use DevTools tracing when profiling.
export const startDevPerformanceCleanup = (): (() => void) => {
  const observer = new PerformanceObserver(() => performance.clearMeasures())
  observer.observe({ type: 'measure', buffered: true })
  return () => observer.disconnect()
}
