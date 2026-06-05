import * as keytar from 'keytar'

export type KeychainAdapter = {
  setPassword: (service: string, account: string, password: string) => Promise<void>
  getPassword: (service: string, account: string) => Promise<string | null>
  deletePassword: (service: string, account: string) => Promise<boolean>
}

export type BinanceFuturesCredentials = {
  apiKey: string
  apiSecret: string
}

type KeychainAdapterModule = KeychainAdapter | {
  default?: unknown
}

export type SecretStore = {
  setObsPassword: (password: string) => Promise<void>
  getObsPassword: () => Promise<string | undefined>
  clearObsPassword: () => Promise<boolean>
  setBinanceFuturesCredentials: (credentials: BinanceFuturesCredentials) => Promise<void>
  getBinanceFuturesCredentials: () => Promise<BinanceFuturesCredentials | undefined>
  clearBinanceFuturesCredentials: () => Promise<boolean>
}

const serviceName = 'TradeCut'
const legacyServiceName = ['Trade', 'Clipper'].join(' ')
const keychainServiceNames = [serviceName, legacyServiceName]
const obsPasswordAccount = 'obs-websocket-password'
const binanceFuturesApiKeyAccount = 'binance-futures-api-key'
const binanceFuturesApiSecretAccount = 'binance-futures-api-secret'

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
  const getPasswordPair = async (firstAccount: string, secondAccount: string) => {
    for (const service of keychainServiceNames) {
      const [first, second] = await Promise.all([
        adapter.getPassword(service, firstAccount),
        adapter.getPassword(service, secondAccount)
      ])
      if (first && second) return [first, second] as const
      if (first || second) return undefined
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
    async setBinanceFuturesCredentials(credentials) {
      await Promise.all([
        adapter.setPassword(serviceName, binanceFuturesApiKeyAccount, credentials.apiKey),
        adapter.setPassword(serviceName, binanceFuturesApiSecretAccount, credentials.apiSecret)
      ])
    },
    async getBinanceFuturesCredentials() {
      const credentials = await getPasswordPair(binanceFuturesApiKeyAccount, binanceFuturesApiSecretAccount)
      if (!credentials) return undefined

      const [apiKey, apiSecret] = credentials
      return { apiKey, apiSecret }
    },
    async clearBinanceFuturesCredentials() {
      const [apiKeyDeleted, apiSecretDeleted] = await Promise.all([
        deletePassword(binanceFuturesApiKeyAccount),
        deletePassword(binanceFuturesApiSecretAccount)
      ])
      return apiKeyDeleted || apiSecretDeleted
    }
  }
}
