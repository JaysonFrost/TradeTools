import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('proxy connection type', () => {
  it('shows the selector in proxy settings and reconnects with the selected protocol', async () => {
    const [panelSource, appSource, runtimeSource, preloadSource] = await Promise.all([
      readFile(resolve('src/renderer/components/settings/ProxyVaultPanel.tsx'), 'utf8'),
      readFile(resolve('src/main/app.ts'), 'utf8'),
      readFile(resolve('src/main/services/proxies/proxyChainSetup.ts'), 'utf8'),
      readFile(resolve('src/preload/index.ts'), 'utf8')
    ])

    expect(panelSource).toContain('Тип подключения')
    expect(panelSource).toContain('value={localProxyType}')
    expect(panelSource).toContain('connectionResult?.entryProxy.type ?? localProxyType')
    expect(preloadSource).toContain('connectChain: (input: { proxyId: string, localProxyType: LocalProxyType })')
    expect(appSource).toContain('const localProxyType = asLocalProxyType(input?.localProxyType, runtime.localProxyType)')
    expect(appSource).toContain('await settingsStore.update({ proxyRuntime: { localProxyType } })')
    expect(runtimeSource).toContain('localProxyType: input.localProxyType')
  })
})
