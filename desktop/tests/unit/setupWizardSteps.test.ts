import { describe, expect, it } from 'vitest'
import { proxySetupWizardSteps, setupWizardSteps, videoSetupWizardSteps } from '../../src/renderer/components/setup/setupWizardSteps'

describe('setupWizardSteps', () => {
  it('guides the user through video setup in order', () => {
    expect(videoSetupWizardSteps.map((step) => step.id)).toEqual([
      'video-welcome',
      'obs-websocket',
      'obs-replay',
      'folders',
      'trade-source',
      'test-clip',
      'video-done'
    ])
    expect(videoSetupWizardSteps[0].actions).toContain('Добавим read-only API ключи Binance Futures')
    expect(videoSetupWizardSteps.find((step) => step.id === 'trade-source')?.title).toBe('API-ключи Binance Futures')
    expect(setupWizardSteps).toBe(videoSetupWizardSteps)
  })

  it('guides the user through proxy setup in order', () => {
    expect(proxySetupWizardSteps.map((step) => step.id)).toEqual([
      'proxy-welcome',
      'proxy-server',
      'proxy-chain',
      'proxy-check',
      'proxy-done'
    ])
  })

  it('keeps every screen self-contained with title, goal, and actions', () => {
    for (const step of [...videoSetupWizardSteps, ...proxySetupWizardSteps]) {
      expect(step.title.length).toBeGreaterThan(0)
      expect(step.goal.length).toBeGreaterThan(0)
      expect(step.actions.length).toBeGreaterThan(0)
    }
  })
})
