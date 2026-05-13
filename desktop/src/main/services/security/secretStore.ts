import * as keytar from 'keytar'

export type KeychainAdapter = {
  setPassword: (service: string, account: string, password: string) => Promise<void>
  getPassword: (service: string, account: string) => Promise<string | null>
  deletePassword: (service: string, account: string) => Promise<boolean>
}

export type SecretStore = {
  setObsPassword: (password: string) => Promise<void>
  getObsPassword: () => Promise<string | undefined>
  clearObsPassword: () => Promise<boolean>
}

const serviceName = 'Trade Clipper'
const obsPasswordAccount = 'obs-websocket-password'

export const createSecretStore = (adapter: KeychainAdapter = keytar): SecretStore => ({
  async setObsPassword(password) {
    await adapter.setPassword(serviceName, obsPasswordAccount, password)
  },
  async getObsPassword() {
    return (await adapter.getPassword(serviceName, obsPasswordAccount)) ?? undefined
  },
  clearObsPassword() {
    return adapter.deletePassword(serviceName, obsPasswordAccount)
  }
})
