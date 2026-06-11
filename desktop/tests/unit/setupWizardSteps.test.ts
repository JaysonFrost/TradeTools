import { describe, expect, it } from 'vitest'
import { proxySetupWizardSteps, setupWizardSteps, videoSetupWizardSteps } from '../../src/renderer/components/setup/setupWizardSteps'

describe('setupWizardSteps', () => {
  it('guides the user through video setup in order', () => {
    expect(videoSetupWizardSteps.map((step) => step.id)).toEqual([
      'video-welcome',
      'obs-websocket',
      'obs-replay',
      'folders',
      'test-clip',
      'video-done'
    ])
    expect(videoSetupWizardSteps[0].actions).toContain('Включим встроенную запись открытого терминала без API')
    expect(videoSetupWizardSteps.map((step) => step.id)).not.toContain('trade-source')
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
    expect(proxySetupWizardSteps.find((step) => step.id === 'proxy-server')?.title).toBe('Добавьте два сервера')
    expect(proxySetupWizardSteps.find((step) => step.id === 'proxy-check')?.goal).toContain('поднимет локальный proxy')
  })

  it('keeps every screen self-contained with title, goal, and actions', () => {
    for (const step of [...videoSetupWizardSteps, ...proxySetupWizardSteps]) {
      expect(step.title.length).toBeGreaterThan(0)
      expect(step.goal.length).toBeGreaterThan(0)
      expect(step.actions.length).toBeGreaterThan(0)
    }
  })
})
