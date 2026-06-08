import { describe, expect, it } from 'vitest'
import { explainSshConnectionFailure } from '../../src/main/services/proxies/sshConnectionCheck'

describe('sshConnectionCheck', () => {
  it('explains authentication failures with actionable SSH guidance', () => {
    expect(explainSshConnectionFailure('All configured authentication methods failed', 'root')).toBe(
      'SSH-авторизация не прошла для логина "root". Проверьте пароль, правильность логина и разрешён ли вход по паролю/root на VPS.'
    )
  })
})

