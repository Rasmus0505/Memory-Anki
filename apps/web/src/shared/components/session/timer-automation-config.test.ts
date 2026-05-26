import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  DEFAULT_TIMER_AUTOMATION_CONFIG,
  readTimerAutomationConfig,
  resetTimerAutomationConfig,
  saveTimerAutomationConfig,
  TIMER_AUTOMATION_STORAGE_KEY,
} from '@/shared/components/session/timer-automation-config'

describe('timer automation config', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('returns defaults when storage is empty', () => {
    expect(readTimerAutomationConfig()).toEqual(DEFAULT_TIMER_AUTOMATION_CONFIG)
  })

  it('sanitizes invalid values when saving', () => {
    const saved = saveTimerAutomationConfig({
      actions: {
        autoStartOnPageEnter: true,
        autoResumeOnWindowReturn: 'bad' as unknown as boolean,
        countNodeSwitchAsActivity: false,
        countEditOperationsAsActivity: true,
        countPracticeInteractionsAsActivity: true,
      },
      palace_edit: {
        inactiveAutoPauseSeconds: -1,
        hiddenAutoPauseSeconds: 30,
        autoPauseRollbackSeconds: 45,
      },
      practice: {
        inactiveAutoPauseSeconds: 10,
        hiddenAutoPauseSeconds: Number.NaN,
        autoPauseRollbackSeconds: 20,
      },
      review: {
        inactiveAutoPauseSeconds: 15,
        hiddenAutoPauseSeconds: 18,
        autoPauseRollbackSeconds: -100,
      },
    })

    expect(saved.palace_edit.inactiveAutoPauseSeconds).toBe(
      DEFAULT_TIMER_AUTOMATION_CONFIG.palace_edit.inactiveAutoPauseSeconds,
    )
    expect(saved.practice.hiddenAutoPauseSeconds).toBe(
      DEFAULT_TIMER_AUTOMATION_CONFIG.practice.hiddenAutoPauseSeconds,
    )
    expect(saved.review.autoPauseRollbackSeconds).toBe(
      DEFAULT_TIMER_AUTOMATION_CONFIG.review.autoPauseRollbackSeconds,
    )
    expect(saved.actions.autoStartOnPageEnter).toBe(true)
    expect(saved.actions.autoResumeOnWindowReturn).toBe(
      DEFAULT_TIMER_AUTOMATION_CONFIG.actions.autoResumeOnWindowReturn,
    )
    expect(window.localStorage.getItem(TIMER_AUTOMATION_STORAGE_KEY)).toContain('"hiddenAutoPauseSeconds":30')
  })

  it('fills in default action rules for legacy stored configs', () => {
    window.localStorage.setItem(
      TIMER_AUTOMATION_STORAGE_KEY,
      JSON.stringify({
        practice: { inactiveAutoPauseSeconds: 9 },
      }),
    )

    const config = readTimerAutomationConfig()
    expect(config.practice.inactiveAutoPauseSeconds).toBe(9)
    expect(config.actions).toEqual(DEFAULT_TIMER_AUTOMATION_CONFIG.actions)
  })

  it('resets to defaults', () => {
    window.localStorage.setItem(TIMER_AUTOMATION_STORAGE_KEY, '{"review":{"inactiveAutoPauseSeconds":9}}')
    expect(resetTimerAutomationConfig()).toEqual(DEFAULT_TIMER_AUTOMATION_CONFIG)
    expect(window.localStorage.getItem(TIMER_AUTOMATION_STORAGE_KEY)).toBeNull()
  })
})
