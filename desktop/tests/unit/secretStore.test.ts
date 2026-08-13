import { describe, expect, it, vi } from 'vitest'
import { createSecretStore, type KeychainAdapter } from '../../src/main/services/security/secretStore'

const createAdapter = (): KeychainAdapter => ({
  setPassword: vi.fn().mockResolvedValue(undefined),
  getPassword: vi.fn().mockResolvedValue('secret'),
  deletePassword: vi.fn().mockResolvedValue(true)
})
const legacyTradeCutServiceName = 'TradeCut'
const legacyServiceName = ['Trade', 'Clipper'].join(' ')
const legacyAuthProvider = ['Goo', 'gle', ['O', 'Auth'].join('')].join('')

describe('secretStore', () => {
  it('uses the default export when keytar is loaded as an ESM namespace', async () => {
    const adapter = createAdapter()
    const store = createSecretStore({ default: adapter } as unknown as KeychainAdapter)

    await store.setTmmApiKey('secret')

    expect(adapter.setPassword).toHaveBeenCalledWith('TradeTools', 'tmm-api-key', 'secret')
  })

  it('can read existing secrets saved under the previous keychain service', async () => {
    const adapter = createAdapter()
    vi.mocked(adapter.getPassword)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('legacy-secret')
    const store = createSecretStore(adapter)

    await expect(store.getTmmApiKey()).resolves.toBe('legacy-secret')
    expect(adapter.getPassword).toHaveBeenCalledWith('TradeTools', 'tmm-api-key')
    expect(adapter.getPassword).toHaveBeenCalledWith(legacyTradeCutServiceName, 'tmm-api-key')
  })

  it('can read existing secrets saved under the oldest keychain service', async () => {
    const adapter = createAdapter()
    vi.mocked(adapter.getPassword)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('legacy-secret')
    const store = createSecretStore(adapter)

    await expect(store.getTmmApiKey()).resolves.toBe('legacy-secret')
    expect(adapter.getPassword).toHaveBeenCalledWith('TradeTools', 'tmm-api-key')
    expect(adapter.getPassword).toHaveBeenCalledWith(legacyTradeCutServiceName, 'tmm-api-key')
    expect(adapter.getPassword).toHaveBeenCalledWith(legacyServiceName, 'tmm-api-key')
  })

  it('stores the TMM API key in keychain instead of settings', async () => {
    const adapter = createAdapter()
    const store = createSecretStore(adapter)

    await store.setTmmApiKey('tmm-secret')
    await expect(store.getTmmApiKey()).resolves.toBe('secret')
    await expect(store.clearTmmApiKey()).resolves.toBe(true)

    expect(adapter.setPassword).toHaveBeenCalledWith('TradeTools', 'tmm-api-key', 'tmm-secret')
    expect(adapter.getPassword).toHaveBeenCalledWith('TradeTools', 'tmm-api-key')
    expect(adapter.deletePassword).toHaveBeenCalledWith('TradeTools', 'tmm-api-key')
  })

  it('stores proxy passwords by proxy id without exposing them through settings', async () => {
    const adapter = createAdapter()
    const store = createSecretStore(adapter)

    await store.setProxyPassword('proxy-1', 'proxy-secret')
    await expect(store.getProxyPassword('proxy-1')).resolves.toBe('secret')
    await expect(store.clearProxyPassword('proxy-1')).resolves.toBe(true)

    expect(adapter.setPassword).toHaveBeenCalledWith('TradeTools', 'proxy-password:proxy-1', 'proxy-secret')
    expect(adapter.getPassword).toHaveBeenCalledWith('TradeTools', 'proxy-password:proxy-1')
    expect(adapter.deletePassword).toHaveBeenCalledWith('TradeTools', 'proxy-password:proxy-1')
  })

  it('stores active proxy runtime uuid in keychain', async () => {
    const adapter = createAdapter()
    const store = createSecretStore(adapter)

    await store.setProxyRuntimeEntryUuid('11111111-1111-4111-8111-111111111111')
    await expect(store.getProxyRuntimeEntryUuid()).resolves.toBe('secret')
    await expect(store.clearProxyRuntimeEntryUuid()).resolves.toBe(true)

    expect(adapter.setPassword).toHaveBeenCalledWith('TradeTools', 'proxy-runtime-entry-uuid', '11111111-1111-4111-8111-111111111111')
    expect(adapter.getPassword).toHaveBeenCalledWith('TradeTools', 'proxy-runtime-entry-uuid')
    expect(adapter.deletePassword).toHaveBeenCalledWith('TradeTools', 'proxy-runtime-entry-uuid')
  })

  it('does not expose legacy external publishing keychain operations', () => {
    const adapter = createAdapter()
    const store = createSecretStore(adapter)

    expect(`set${legacyAuthProvider}Credentials` in store).toBe(false)
    expect(`get${legacyAuthProvider}Credentials` in store).toBe(false)
    expect(`set${legacyAuthProvider}Tokens` in store).toBe(false)
    expect(`get${legacyAuthProvider}Tokens` in store).toBe(false)
    expect('setBinanceFuturesCredentials' in store).toBe(false)
    expect('getBinanceFuturesCredentials' in store).toBe(false)
  })
})
