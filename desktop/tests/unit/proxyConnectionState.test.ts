import { describe, expect, it } from 'vitest'
import { createProxyConnectionSummary } from '../../src/renderer/components/settings/proxyConnectionState'

describe('proxyConnectionState', () => {
  it('shows a connected proxy and protected VPS as separate successful states', () => {
    expect(createProxyConnectionSummary({
      connected: true,
      bypassState: 'protected'
    })).toMatchObject({
      title: 'Прокси подключён',
      bypassLabel: 'VPS идёт напрямую',
      tone: 'success'
    })
  })

  it('keeps an active proxy connected while Windows confirmation is needed', () => {
    expect(createProxyConnectionSummary({
      connected: true,
      bypassState: 'needs-uac'
    })).toMatchObject({
      title: 'Прокси подключён',
      bypassLabel: 'Требуется подтверждение Windows',
      bypassTone: 'warning'
    })
  })
})
