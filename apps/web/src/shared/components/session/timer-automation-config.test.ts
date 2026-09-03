import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMER_AUTOMATION_CONFIG,
  readTimerAutomationConfig,
  sanitizeTimerAutomationConfig,
  shouldAutoStartOnPageEnter,
} from './timer-automation-config'

describe('timer automation config', () => {
  beforeEach(() => window.localStorage.clear())

  it('uses only auto-start, screen wake and schema version', () => {
    expect(readTimerAutomationConfig()).toEqual(DEFAULT_TIMER_AUTOMATION_CONFIG)
    expect(Object.keys(readTimerAutomationConfig()).sort()).toEqual([
      'autoStartOnPageEnter',
      'keepScreenAwake',
      'schemaVersion',
    ])
  })

  it('keeps the two supported settings and ignores removed idle fields', () => {
    expect(
      sanitizeTimerAutomationConfig({
        schemaVersion: 3,
        autoStartOnPageEnter: true,
        keepScreenAwake: false,
        idleTimeoutSeconds: 300,
        idleGraceSeconds: 30,
        backgroundGraceSeconds: 45,
      }),
    ).toEqual({
      schemaVersion: DEFAULT_TIMER_AUTOMATION_CONFIG.schemaVersion,
      autoStartOnPageEnter: true,
      keepScreenAwake: false,
    })
  })

  it('reads auto-start from the legacy nested shared rule', () => {
    expect(
      sanitizeTimerAutomationConfig({
        schemaVersion: 2,
        shared: { autoStartOnPageEnter: true, inactiveAutoPauseSeconds: 300 },
        actions: { countEditOperationsAsActivity: true },
      }),
    ).toEqual({
      schemaVersion: DEFAULT_TIMER_AUTOMATION_CONFIG.schemaVersion,
      autoStartOnPageEnter: true,
      keepScreenAwake: true,
    })
  })

  it('defaults malformed values and exposes one auto-start decision', () => {
    const config = sanitizeTimerAutomationConfig({
      autoStartOnPageEnter: 'yes',
      keepScreenAwake: 1,
    })
    expect(config).toEqual(DEFAULT_TIMER_AUTOMATION_CONFIG)
    expect(shouldAutoStartOnPageEnter(config)).toBe(false)
  })
})
