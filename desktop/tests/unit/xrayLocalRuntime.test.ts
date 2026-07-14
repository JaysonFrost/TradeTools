import { describe, expect, it } from 'vitest'
import * as xrayLocalRuntime from '../../src/main/services/proxies/xrayLocalRuntime'

type LocalXrayOwnerPredicate = (owner: {
  pid: number
  name?: string
  path?: string
  commandLine?: string
}, configPath: string) => boolean

const isManagedLocalXrayOwner = (xrayLocalRuntime as unknown as {
  isManagedLocalXrayOwner: LocalXrayOwnerPredicate
}).isManagedLocalXrayOwner

describe('isManagedLocalXrayOwner', () => {
  it('requires the TradeTools config path in an Xray listener command line', () => {
    const configPath = 'C:\\Users\\Igor\\AppData\\Roaming\\TradeTools\\xray-runtime\\config.json'
    const xrayPath = 'C:\\Users\\Igor\\AppData\\Roaming\\TradeTools\\xray-runtime\\xray.exe'

    expect(isManagedLocalXrayOwner({
      pid: 1234,
      name: 'xray.exe',
      path: xrayPath,
      commandLine: `"${xrayPath}" run -config "C:\\Users\\Igor\\other-xray-config.json"`
    }, configPath)).toBe(false)
    expect(isManagedLocalXrayOwner({
      pid: 1235,
      name: 'xray.exe',
      path: xrayPath,
      commandLine: `"${xrayPath}" run -config "${configPath}"`
    }, configPath)).toBe(true)
  })
})
