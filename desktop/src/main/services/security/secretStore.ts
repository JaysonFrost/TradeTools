import * as keytar from 'keytar'

export type KeychainAdapter = {
  setPassword: (service: string, account: string, password: string) => Promise<void>
  getPassword: (service: string, account: string) => Promise<string | null>
  deletePassword: (service: string, account: string) => Promise<boolean>
}

type KeychainAdapterModule = KeychainAdapter | {
  default?: unknown
}

export type SecretStore = {
  setObsPassword: (password: string) => Promise<void>
  getObsPassword: () => Promise<string | undefined>
  clearObsPassword: () => Promise<boolean>
  setProxyPassword: (proxyId: string, password: string) => Promise<void>
  getProxyPassword: (proxyId: string) => Promise<string | undefined>
  clearProxyPassword: (proxyId: string) => Promise<boolean>
  setProxyRuntimeEntryUuid: (uuid: string) => Promise<void>
  getProxyRuntimeEntryUuid: () => Promise<string | undefined>
  clearProxyRuntimeEntryUuid: () => Promise<boolean>
}

const serviceName = 'TradeTools'
const legacyTradeCutServiceName = 'TradeCut'
const legacyServiceName = ['Trade', 'Clipper'].join(' ')
const keychainServiceNames = [serviceName, legacyTradeCutServiceName, legacyServiceName]
const obsPasswordAccount = 'obs-websocket-password'
const proxyPasswordAccount = (proxyId: string): string => `proxy-password:${proxyId}`
const proxyRuntimeEntryUuidAccount = 'proxy-runtime-entry-uuid'

const isKeychainAdapter = (value: unknown): value is KeychainAdapter => {
  const adapter = value as Partial<KeychainAdapter> | undefined
  return typeof adapter?.setPassword === 'function' && typeof adapter.getPassword === 'function' && typeof adapter.deletePassword === 'function'
}

const resolveKeychainAdapter = (adapterModule: KeychainAdapterModule): KeychainAdapter => {
  if (isKeychainAdapter(adapterModule)) return adapterModule

  const defaultAdapter = (adapterModule as { default?: unknown }).default
  if (isKeychainAdapter(defaultAdapter)) return defaultAdapter

  throw new TypeError('Keychain adapter is missing keytar password methods')
}

export const createSecretStore = (adapterModule: KeychainAdapterModule = keytar): SecretStore => {
  const adapter = resolveKeychainAdapter(adapterModule)
  const getPassword = async (account: string) => {
    for (const service of keychainServiceNames) {
      const value = await adapter.getPassword(service, account)
      if (value) return value
    }

    return undefined
  }
  const deletePassword = async (account: string) => {
    const deleted = await Promise.all(keychainServiceNames.map((service) => adapter.deletePassword(service, account)))
    return deleted.some(Boolean)
  }

  return {
    async setObsPassword(password) {
      await adapter.setPassword(serviceName, obsPasswordAccount, password)
    },
    async getObsPassword() {
      return getPassword(obsPasswordAccount)
    },
    clearObsPassword() {
      return deletePassword(obsPasswordAccount)
    },
    async setProxyPassword(proxyId, password) {
      await adapter.setPassword(serviceName, proxyPasswordAccount(proxyId), password)
    },
    async getProxyPassword(proxyId) {
      return getPassword(proxyPasswordAccount(proxyId))
    },
    clearProxyPassword(proxyId) {
      return deletePassword(proxyPasswordAccount(proxyId))
    },
    async setProxyRuntimeEntryUuid(uuid) {
      await adapter.setPassword(serviceName, proxyRuntimeEntryUuidAccount, uuid)
    },
    async getProxyRuntimeEntryUuid() {
      return getPassword(proxyRuntimeEntryUuidAccount)
    },
    clearProxyRuntimeEntryUuid() {
      return deletePassword(proxyRuntimeEntryUuidAccount)
    }
  }
}
