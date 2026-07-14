import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMER_AUTOMATION_CONFIG,
  readTimerAutomationConfig,
  sanitizeTimerAutomationConfig,
  shouldAutoStartOnPageEnter,
} from './timer-automation-config'

describe('timer automation config', () => {
  beforeEach(() => window.localStorage.clear())

  it('uses one global click-idle rule by default', () => {
    const config = readTimerAutomationConfig()
    expect(config.mode).toBe('global')
    expect(config.shared).toMatchObject({
      autoStartOnPageEnter: false,
      inactiveAutoPauseSeconds: 120,
      inactivePauseGraceSeconds: 0,
      hiddenAutoPauseSeconds: 0,
      autoPauseRollbackSeconds: 0,
    })
    expect(config.practice).toEqual(config.shared)
    expect(config.english_reading).toEqual(config.shared)
  })

  it('migrates the legacy shared rule and keeps learning activity signals enabled', () => {
    const config = sanitizeTimerAutomationConfig({
      schemaVersion: 2,
      mode: 'scene',
      shared: { autoStartOnPageEnter: true, inactiveAutoPauseSeconds: 300 },
      actions: { countEditOperationsAsActivity: true, countPracticeInteractionsAsActivity: true },
    })
    expect(config.mode).toBe('global')
    expect(config.shared.autoStartOnPageEnter).toBe(true)
    expect(config.shared.inactiveAutoPauseSeconds).toBe(300)
    expect(config.actions).toEqual({
      autoResumeOnWindowReturn: false,
      countNodeSwitchAsActivity: false,
      countEditOperationsAsActivity: true,
      countPracticeInteractionsAsActivity: true,
    })
  })

  it('repairs schema v3 configs whose activity signals were forced off', () => {
    const config = sanitizeTimerAutomationConfig({
      schemaVersion: 3,
      mode: 'global',
      actions: {
        autoResumeOnWindowReturn: false,
        countNodeSwitchAsActivity: false,
        countEditOperationsAsActivity: false,
        countPracticeInteractionsAsActivity: false,
      },
      shared: {
        autoStartOnPageEnter: false,
        inactiveAutoPauseSeconds: 300,
      },
    })

    expect(config.actions.countEditOperationsAsActivity).toBe(true)
    expect(config.actions.countPracticeInteractionsAsActivity).toBe(true)
    expect(config.shared.autoStartOnPageEnter).toBe(false)
    expect(config.shared.inactiveAutoPauseSeconds).toBe(300)
  })

  it('uses the same auto-start choice for every scene', () => {
    const config = sanitizeTimerAutomationConfig({
      ...DEFAULT_TIMER_AUTOMATION_CONFIG,
      shared: { ...DEFAULT_TIMER_AUTOMATION_CONFIG.shared, autoStartOnPageEnter: true },
    })
    expect(shouldAutoStartOnPageEnter(config, 'palace_edit')).toBe(true)
    expect(shouldAutoStartOnPageEnter(config, 'quiz')).toBe(true)
  })
})
