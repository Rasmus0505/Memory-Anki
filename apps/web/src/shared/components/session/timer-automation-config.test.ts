import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  DEFAULT_TIMER_AUTOMATION_CONFIG,
  readTimerAutomationConfig,
  resetTimerAutomationConfig,
  sanitizeTimerAutomationConfig,
  saveTimerAutomationConfig,
  shouldAutoStartOnPageEnter,
  TIMER_AUTOMATION_CONFIG_VERSION,
  TIMER_AUTOMATION_STORAGE_KEY,
} from '@/shared/components/session/timer-automation-config'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'

describe('timer automation config', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
    vi.restoreAllMocks()
  })

  it('returns defaults when storage is empty', () => {
    expect(readTimerAutomationConfig()).toEqual(DEFAULT_TIMER_AUTOMATION_CONFIG)
    expect(DEFAULT_TIMER_AUTOMATION_CONFIG.shared).toMatchObject({
      inactiveAutoPauseSeconds: 120,
      inactivePauseGraceSeconds: 30,
      autoPauseRollbackSeconds: 0,
    })
  })

  it('sanitizes invalid values when saving', () => {
    const saved = saveTimerAutomationConfig({
      mode: 'scene',
      actions: {
        autoResumeOnWindowReturn: 'bad' as unknown as boolean,
        countNodeSwitchAsActivity: false,
        countEditOperationsAsActivity: true,
        countPracticeInteractionsAsActivity: true,
      },
      shared: {
        autoStartOnPageEnter: false,
        inactiveAutoPauseSeconds: 120,
        hiddenAutoPauseSeconds: 15,
        autoPauseRollbackSeconds: 60,
      },
      palace_edit: {
        autoStartOnPageEnter: true,
        inactiveAutoPauseSeconds: -1,
        hiddenAutoPauseSeconds: 30,
        autoPauseRollbackSeconds: 45,
      },
      practice: {
        autoStartOnPageEnter: false,
        inactiveAutoPauseSeconds: 10,
        hiddenAutoPauseSeconds: Number.NaN,
        autoPauseRollbackSeconds: 20,
      },
      quiz: {
        autoStartOnPageEnter: true,
        inactiveAutoPauseSeconds: 9,
        hiddenAutoPauseSeconds: 11,
        autoPauseRollbackSeconds: 5,
      },
      review: {
        autoStartOnPageEnter: false,
        inactiveAutoPauseSeconds: 15,
        hiddenAutoPauseSeconds: 18,
        autoPauseRollbackSeconds: -100,
      },
      freestyle: {
        autoStartOnPageEnter: true,
        inactiveAutoPauseSeconds: 9,
        hiddenAutoPauseSeconds: 11,
        autoPauseRollbackSeconds: 5,
      },
      english: {
        autoStartOnPageEnter: 'bad' as unknown as boolean,
        inactiveAutoPauseSeconds: 10,
        hiddenAutoPauseSeconds: 15,
        autoPauseRollbackSeconds: 20,
      },
      english_reading: {
        autoStartOnPageEnter: true,
        inactiveAutoPauseSeconds: 25,
        hiddenAutoPauseSeconds: 20,
        autoPauseRollbackSeconds: 15,
      },
    })

    expect(saved.palace_edit.inactiveAutoPauseSeconds).toBe(
      DEFAULT_TIMER_AUTOMATION_CONFIG.palace_edit.inactiveAutoPauseSeconds,
    )
    expect(saved.practice.hiddenAutoPauseSeconds).toBe(
      DEFAULT_TIMER_AUTOMATION_CONFIG.practice.hiddenAutoPauseSeconds,
    )
    expect(saved.quiz.inactiveAutoPauseSeconds).toBe(9)
    expect(saved.quiz.autoStartOnPageEnter).toBe(true)
    expect(saved.review.autoPauseRollbackSeconds).toBe(0)
    expect(saved.palace_edit.autoStartOnPageEnter).toBe(true)
    expect(saved.english.autoStartOnPageEnter).toBe(DEFAULT_TIMER_AUTOMATION_CONFIG.english.autoStartOnPageEnter)
    expect(saved.actions.autoResumeOnWindowReturn).toBe(
      DEFAULT_TIMER_AUTOMATION_CONFIG.actions.autoResumeOnWindowReturn,
    )
    expect(window.localStorage.getItem(TIMER_AUTOMATION_STORAGE_KEY)).toBeNull()
  })

  it('migrates legacy defaults and keeps values that were explicitly customized', () => {
    const config = sanitizeTimerAutomationConfig({
      mode: 'scene',
      shared: {
        autoStartOnPageEnter: false,
        inactiveAutoPauseSeconds: 120,
        hiddenAutoPauseSeconds: 15,
        autoPauseRollbackSeconds: 60,
      },
      palace_edit: {
        autoStartOnPageEnter: false,
        inactiveAutoPauseSeconds: 45,
        hiddenAutoPauseSeconds: 15,
        autoPauseRollbackSeconds: 7,
      },
      english_reading: {
        autoStartOnPageEnter: true,
        inactiveAutoPauseSeconds: 180,
        hiddenAutoPauseSeconds: 20,
        autoPauseRollbackSeconds: 90,
      },
    })

    expect(config.schemaVersion).toBe(TIMER_AUTOMATION_CONFIG_VERSION)
    expect(config.shared).toMatchObject({
      inactiveAutoPauseSeconds: 120,
      inactivePauseGraceSeconds: 30,
      hiddenAutoPauseSeconds: 15,
      autoPauseRollbackSeconds: 0,
    })
    expect(config.palace_edit).toMatchObject({
      inactiveAutoPauseSeconds: 45,
      inactivePauseGraceSeconds: 30,
      autoPauseRollbackSeconds: 7,
    })
    expect(config.english_reading).toMatchObject({
      inactiveAutoPauseSeconds: 120,
      inactivePauseGraceSeconds: 30,
      hiddenAutoPauseSeconds: 15,
      autoPauseRollbackSeconds: 0,
    })
  })

  it('preserves legacy-looking values once the config is current-version', () => {
    const config = sanitizeTimerAutomationConfig({
      schemaVersion: TIMER_AUTOMATION_CONFIG_VERSION,
      shared: {
        autoStartOnPageEnter: false,
        inactiveAutoPauseSeconds: 120,
        inactivePauseGraceSeconds: 12,
        hiddenAutoPauseSeconds: 15,
        autoPauseRollbackSeconds: 60,
      },
    })

    expect(config.shared.inactivePauseGraceSeconds).toBe(12)
    expect(config.shared.autoPauseRollbackSeconds).toBe(60)
  })

  it('fills in default action rules and english scene for legacy stored configs', () => {
    window.localStorage.setItem(
      TIMER_AUTOMATION_STORAGE_KEY,
      JSON.stringify({
        actions: {
          autoStartOnPageEnter: true,
        },
        practice: { inactiveAutoPauseSeconds: 9 },
      }),
    )

    const config = readTimerAutomationConfig()
    expect(config.practice.inactiveAutoPauseSeconds).toBe(9)
    expect(config.quiz.inactiveAutoPauseSeconds).toBe(9)
    expect(config.quiz.hiddenAutoPauseSeconds).toBe(config.practice.hiddenAutoPauseSeconds)
    expect(config.quiz.autoPauseRollbackSeconds).toBe(config.practice.autoPauseRollbackSeconds)
    expect(config.quiz.autoStartOnPageEnter).toBe(true)
    expect(config.freestyle).toEqual(config.quiz)
    expect(config.english.inactiveAutoPauseSeconds).toBe(9)
    expect(config.english.hiddenAutoPauseSeconds).toBe(config.practice.hiddenAutoPauseSeconds)
    expect(config.english.autoPauseRollbackSeconds).toBe(config.practice.autoPauseRollbackSeconds)
    expect(config.english_reading).toEqual(DEFAULT_TIMER_AUTOMATION_CONFIG.english_reading)
    expect(config.actions).toEqual(DEFAULT_TIMER_AUTOMATION_CONFIG.actions)
    expect(config.practice.autoStartOnPageEnter).toBe(true)
    expect(config.review.autoStartOnPageEnter).toBe(true)
    expect(config.english.autoStartOnPageEnter).toBe(true)
    expect(config.english_reading.autoStartOnPageEnter).toBe(true)
    expect(config.mode).toBe('scene')
    expect(config.shared.autoStartOnPageEnter).toBe(true)
    expect(config.shared.inactiveAutoPauseSeconds).toBe(DEFAULT_TIMER_AUTOMATION_CONFIG.shared.inactiveAutoPauseSeconds)
  })

  it('caps rollback seconds to the inactive auto-pause window when saving', () => {
    const saved = saveTimerAutomationConfig({
      ...DEFAULT_TIMER_AUTOMATION_CONFIG,
      palace_edit: {
        autoStartOnPageEnter: false,
        inactiveAutoPauseSeconds: 20,
        hiddenAutoPauseSeconds: 15,
        autoPauseRollbackSeconds: 60,
      },
    })

    expect(saved.palace_edit.autoPauseRollbackSeconds).toBe(20)
    expect(window.localStorage.getItem(TIMER_AUTOMATION_STORAGE_KEY)).toBeNull()
  })

  it('resets to defaults', () => {
    window.localStorage.setItem(TIMER_AUTOMATION_STORAGE_KEY, '{"review":{"inactiveAutoPauseSeconds":9}}')
    expect(resetTimerAutomationConfig()).toEqual(DEFAULT_TIMER_AUTOMATION_CONFIG)
    expect(window.localStorage.getItem(TIMER_AUTOMATION_STORAGE_KEY)).toBeNull()
  })

  it('reads page-enter auto-start by scene', () => {
    expect(shouldAutoStartOnPageEnter(DEFAULT_TIMER_AUTOMATION_CONFIG, 'english')).toBe(true)
    expect(shouldAutoStartOnPageEnter(DEFAULT_TIMER_AUTOMATION_CONFIG, 'english_reading')).toBe(true)
    expect(shouldAutoStartOnPageEnter(DEFAULT_TIMER_AUTOMATION_CONFIG, 'quiz')).toBe(true)
    expect(shouldAutoStartOnPageEnter(DEFAULT_TIMER_AUTOMATION_CONFIG, 'freestyle')).toBe(true)
    expect(shouldAutoStartOnPageEnter(DEFAULT_TIMER_AUTOMATION_CONFIG, 'palace_edit')).toBe(false)
  })

  it('uses shared thresholds when global mode is enabled', () => {
    const config = saveTimerAutomationConfig({
      ...DEFAULT_TIMER_AUTOMATION_CONFIG,
      mode: 'global',
      shared: {
        autoStartOnPageEnter: true,
        inactiveAutoPauseSeconds: 45,
        hiddenAutoPauseSeconds: 12,
        autoPauseRollbackSeconds: 10,
      },
    })

    expect(shouldAutoStartOnPageEnter(config, 'palace_edit')).toBe(true)
    expect(shouldAutoStartOnPageEnter(config, 'english')).toBe(true)
  })
})
