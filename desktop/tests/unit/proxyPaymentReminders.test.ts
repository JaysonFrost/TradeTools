import { describe, expect, it } from 'vitest'
import { listProxyPaymentReminders } from '../../src/main/services/notifications/proxyPaymentReminders'
import { createDefaultSettings } from '../../src/main/services/settings/settings'

describe('proxyPaymentReminders', () => {
  it('returns due proxy reminders once per local day', () => {
    const settings = {
      ...createDefaultSettings('/app-data'),
      system: {
        ...createDefaultSettings('/app-data').system,
        paymentReminderDaysBefore: 3
      },
      proxies: [{
        id: 'proxy-1',
        name: 'London proxy',
        server: 'gb.proxy.test:9000',
        login: 'trader',
        passwordConfigured: true,
        nextProxyId: '',
        localProxyPort: 1081,
        paymentDueDay: 10,
        dashboardUrl: 'https://proxy.example.com/account',
        notes: ''
      }]
    }

    const reminders = listProxyPaymentReminders(settings, Date.parse('2026-06-08T12:00:00.000Z'))

    expect(reminders).toHaveLength(1)
    expect(reminders[0]).toMatchObject({
      key: 'proxy-1:10:2026-06-08',
      title: 'Срок оплаты прокси',
      body: 'London proxy: оплата через 2 дн.'
    })
    expect(listProxyPaymentReminders({
      ...settings,
      proxies: [{
        ...settings.proxies[0],
        lastPaymentReminderKey: reminders[0].key
      }]
    }, Date.parse('2026-06-08T18:00:00.000Z'))).toEqual([])
  })

  it('treats payment day as a monthly recurring day instead of a fixed date', () => {
    const settings = {
      ...createDefaultSettings('/app-data'),
      system: {
        ...createDefaultSettings('/app-data').system,
        paymentReminderDaysBefore: 30
      },
      proxies: [{
        id: 'proxy-1',
        name: 'Edgecenter',
        server: 'edge.proxy.test',
        login: 'trader',
        passwordConfigured: true,
        nextProxyId: '',
        localProxyPort: 1081,
        paymentDueDay: 5,
        dashboardUrl: '',
        notes: ''
      }]
    }

    const reminders = listProxyPaymentReminders(settings, Date.parse('2026-06-08T12:00:00.000Z'))

    expect(reminders).toHaveLength(1)
    expect(reminders[0].body).toBe('Edgecenter: оплата через 27 дн.')
  })
})
