import { describe, expect, it } from 'vitest'
import { setupWizardSteps } from '../../src/renderer/components/setup/setupWizardSteps'

describe('setupWizardSteps', () => {
  it('guides the user through the required app setup in order', () => {
    expect(setupWizardSteps.map((step) => step.id)).toEqual([
      'welcome',
      'obs-websocket',
      'obs-replay',
      'folders',
      'trade-source',
      'test-clip',
      'done'
    ])
  })

  it('keeps every screen self-contained with title, goal, and actions', () => {
    for (const step of setupWizardSteps) {
      expect(step.title.length).toBeGreaterThan(0)
      expect(step.goal.length).toBeGreaterThan(0)
      expect(step.actions.length).toBeGreaterThan(0)
    }
  })
})
