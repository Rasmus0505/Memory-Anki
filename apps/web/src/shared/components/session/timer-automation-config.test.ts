import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMER_AUTOMATION_CONFIG,
  isActivityEnabled,
  readTimerAutomationConfig,
  sanitizeTimerAutomationConfig,
  shouldAutoStartOnPageEnter,
} from './timer-automation-config'

describe('timer automation config', () => {
  beforeEach(() => window.localStorage.clear())

  it('ships one flat rule with a real grace window and background debounce', () => {
    expect(readTimerAutomationConfig()).toEqual({
      schemaVersion: 5,
      autoStartOnPageEnter: false,
      keepScreenAwake: true,
      idleTimeoutSeconds: 120,
      idleGraceSeconds: 30,
      backgroundGraceSeconds: 20,
    })
  })

  it('migrates the legacy shared rule to the flat schema', () => {
    const config = sanitizeTimerAutomationConfig({
      schemaVersion: 2,
      mode: 'scene',
      shared: { autoStartOnPageEnter: true, inactiveAutoPauseSeconds: 300 },
      actions: { countEditOperationsAsActivity: true },
      palace_edit: { autoStartOnPageEnter: false, inactiveAutoPauseSeconds: 20 },
    })

    expect(config).toEqual({
      schemaVersion: 5,
      autoStartOnPageEnter: true,
      keepScreenAwake: true,
      idleTimeoutSeconds: 180,
      idleGraceSeconds: 30,
      backgroundGraceSeconds: 20,
    })
  })

  it('discards the zeroed grace values that schema v3 forced on every config', () => {
    const config = sanitizeTimerAutomationConfig({
      schemaVersion: 3,
      mode: 'global',
      shared: {
        autoStartOnPageEnter: false,
        inactiveAutoPauseSeconds: 300,
        inactivePauseGraceSeconds: 0,
        hiddenAutoPauseSeconds: 0,
        autoPauseRollbackSeconds: 0,
      },
    })

    expect(config.idleTimeoutSeconds).toBe(180)
    expect(config.idleGraceSeconds).toBe(30)
    expect(config.backgroundGraceSeconds).toBe(20)
  })

  it('keeps explicit v4 values and rejects negative or unparsable seconds', () => {
    const config = sanitizeTimerAutomationConfig({
      schemaVersion: 5,
      autoStartOnPageEnter: true,
      idleTimeoutSeconds: 90,
      idleGraceSeconds: -5,
      backgroundGraceSeconds: 'nope',
    })

    expect(config.autoStartOnPageEnter).toBe(true)
    expect(config.idleTimeoutSeconds).toBe(90)
    expect(config.idleGraceSeconds).toBe(DEFAULT_TIMER_AUTOMATION_CONFIG.idleGraceSeconds)
    expect(config.backgroundGraceSeconds).toBe(DEFAULT_TIMER_AUTOMATION_CONFIG.backgroundGraceSeconds)
  })

  it('accepts a zero background grace as "pause immediately"', () => {
    const config = sanitizeTimerAutomationConfig({
      ...DEFAULT_TIMER_AUTOMATION_CONFIG,
      backgroundGraceSeconds: 0,
    })
    expect(config.backgroundGraceSeconds).toBe(0)
  })

  it('uses one auto-start choice for every scene', () => {
    const config = sanitizeTimerAutomationConfig({
      ...DEFAULT_TIMER_AUTOMATION_CONFIG,
      autoStartOnPageEnter: true,
    })
    expect(shouldAutoStartOnPageEnter(config)).toBe(true)
  })

  it('counts study interactions as activity but not window returns', () => {
    expect(isActivityEnabled('edit_operation')).toBe(true)
    expect(isActivityEnabled('practice_interaction')).toBe(true)
    expect(isActivityEnabled('window_return')).toBe(false)
    expect(isActivityEnabled('node_switch')).toBe(false)
  })
})
