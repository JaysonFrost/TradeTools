import { describe, expect, it, vi } from 'vitest'
import { createSecretStore, type KeychainAdapter } from '../../src/main/services/security/secretStore'

const createAdapter = (): KeychainAdapter => ({
  setPassword: vi.fn().mockResolvedValue(undefined),
  getPassword: vi.fn().mockResolvedValue('secret'),
  deletePassword: vi.fn().mockResolvedValue(true)
})
const legacyServiceName = ['Trade', 'Clipper'].join(' ')

describe('secretStore', () => {
  it('stores OBS password under a stable service and account', async () => {
    const adapter = createAdapter()
    const store = createSecretStore(adapter)

    await store.setObsPassword('secret')

    expect(adapter.setPassword).toHaveBeenCalledWith('TradeCut', 'obs-websocket-password', 'secret')
  })

  it('uses the default export when keytar is loaded as an ESM namespace', async () => {
    const adapter = createAdapter()
    const store = createSecretStore({ default: adapter } as unknown as KeychainAdapter)

    await store.setObsPassword('secret')

    expect(adapter.setPassword).toHaveBeenCalledWith('TradeCut', 'obs-websocket-password', 'secret')
  })

  it('reads OBS password without exposing it through settings JSON', async () => {
    const adapter = createAdapter()
    const store = createSecretStore(adapter)

    await expect(store.getObsPassword()).resolves.toBe('secret')
    expect(adapter.getPassword).toHaveBeenCalledWith('TradeCut', 'obs-websocket-password')
  })

  it('can read existing secrets saved under the old keychain service', async () => {
    const adapter = createAdapter()
    vi.mocked(adapter.getPassword)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('legacy-secret')
    const store = createSecretStore(adapter)

    await expect(store.getObsPassword()).resolves.toBe('legacy-secret')
    expect(adapter.getPassword).toHaveBeenCalledWith('TradeCut', 'obs-websocket-password')
    expect(adapter.getPassword).toHaveBeenCalledWith(legacyServiceName, 'obs-websocket-password')
  })

  it('clears OBS password', async () => {
    const adapter = createAdapter()
    const store = createSecretStore(adapter)

    await expect(store.clearObsPassword()).resolves.toBe(true)
    expect(adapter.deletePassword).toHaveBeenCalledWith('TradeCut', 'obs-websocket-password')
  })

  it('stores Binance Futures API credentials under separate keychain accounts', async () => {
    const adapter = createAdapter()
    const store = createSecretStore(adapter)

    await store.setBinanceFuturesCredentials({ apiKey: 'binance-key', apiSecret: 'binance-secret' })

    expect(adapter.setPassword).toHaveBeenCalledWith('TradeCut', 'binance-futures-api-key', 'binance-key')
    expect(adapter.setPassword).toHaveBeenCalledWith('TradeCut', 'binance-futures-api-secret', 'binance-secret')
  })

  it('reads Binance Futures API credentials only when both key and secret exist', async () => {
    const adapter = createAdapter()
    vi.mocked(adapter.getPassword)
      .mockResolvedValueOnce('binance-key')
      .mockResolvedValueOnce('binance-secret')
      .mockResolvedValueOnce('binance-key')
      .mockResolvedValueOnce(null)
    const store = createSecretStore(adapter)

    await expect(store.getBinanceFuturesCredentials()).resolves.toEqual({
      apiKey: 'binance-key',
      apiSecret: 'binance-secret'
    })
    await expect(store.getBinanceFuturesCredentials()).resolves.toBeUndefined()
  })

  it('stores Google OAuth client credentials and tokens under keychain accounts', async () => {
    const adapter = createAdapter()
    const store = createSecretStore(adapter)

    await store.setGoogleOAuthCredentials({ clientId: 'google-client-id', clientSecret: 'google-client-secret' })
    await store.setGoogleOAuthTokens({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAtMs: 1_700_000_000_000,
      scope: 'https://www.googleapis.com/auth/youtube.upload',
      tokenType: 'Bearer'
    })

    expect(adapter.setPassword).toHaveBeenCalledWith('TradeCut', 'google-oauth-client-id', 'google-client-id')
    expect(adapter.setPassword).toHaveBeenCalledWith('TradeCut', 'google-oauth-client-secret', 'google-client-secret')
    expect(adapter.setPassword).toHaveBeenCalledWith('TradeCut', 'google-oauth-tokens', JSON.stringify({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAtMs: 1_700_000_000_000,
      scope: 'https://www.googleapis.com/auth/youtube.upload',
      tokenType: 'Bearer'
    }))
  })
})
