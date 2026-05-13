import { describe, expect, it, vi } from 'vitest'
import { createSecretStore, type KeychainAdapter } from '../../src/main/services/security/secretStore'

const createAdapter = (): KeychainAdapter => ({
  setPassword: vi.fn().mockResolvedValue(undefined),
  getPassword: vi.fn().mockResolvedValue('secret'),
  deletePassword: vi.fn().mockResolvedValue(true)
})

describe('secretStore', () => {
  it('stores OBS password under a stable service and account', async () => {
    const adapter = createAdapter()
    const store = createSecretStore(adapter)

    await store.setObsPassword('secret')

    expect(adapter.setPassword).toHaveBeenCalledWith('Trade Clipper', 'obs-websocket-password', 'secret')
  })

  it('reads OBS password without exposing it through settings JSON', async () => {
    const adapter = createAdapter()
    const store = createSecretStore(adapter)

    await expect(store.getObsPassword()).resolves.toBe('secret')
    expect(adapter.getPassword).toHaveBeenCalledWith('Trade Clipper', 'obs-websocket-password')
  })

  it('clears OBS password', async () => {
    const adapter = createAdapter()
    const store = createSecretStore(adapter)

    await expect(store.clearObsPassword()).resolves.toBe(true)
    expect(adapter.deletePassword).toHaveBeenCalledWith('Trade Clipper', 'obs-websocket-password')
  })
})
