import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrateTimerAndFeedbackConfigs } from './timerConfigMigration'
import { REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY } from '@/shared/feedback/reviewFeedbackSettings'
import { TIMER_FOCUS_STORAGE_KEY } from '@/shared/components/session/timer-focus-config'

const hasLoadedClientPreferences = vi.hoisted(() => vi.fn(() => true))
const saveClientPreference = vi.hoisted(() =>
  vi.fn(async (_key: string, _value: unknown) => ({ value: null, persisted: true })),
)
const getClientPreferenceCacheStatus = vi.hoisted(() =>
  vi.fn(() => ({ hasEntry: false, value: null })),
)

vi.mock('@/shared/preferences/clientPreferences', () => ({
  hasLoadedClientPreferences,
  saveClientPreference,
  getClientPreferenceCacheStatus,
}))

function savedFor(key: string) {
  const call = saveClientPreference.mock.calls.find((entry) => entry[0] === key)
  return call?.[1] as Record<string, unknown> | undefined
}

describe('migrateTimerAndFeedbackConfigs', () => {
  beforeEach(() => {
    window.localStorage.clear()
    saveClientPreference.mockClear()
    hasLoadedClientPreferences.mockReturnValue(true)
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('does nothing before preferences have loaded', async () => {
    // Reading now would return stock defaults, and writing those back would
    // overwrite the user's real settings.
    hasLoadedClientPreferences.mockReturnValue(false)
    window.localStorage.setItem(
      REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY,
      JSON.stringify({ keepScreenAwake: false }),
    )

    await migrateTimerAndFeedbackConfigs()

    expect(saveClientPreference).not.toHaveBeenCalled()
  })

  it('does nothing when there is no legacy payload', async () => {
    await migrateTimerAndFeedbackConfigs()
    expect(saveClientPreference).not.toHaveBeenCalled()
  })

  it('moves the screen wake lock onto the timer automation config', async () => {
    window.localStorage.setItem(
      REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY,
      JSON.stringify({ keepScreenAwake: false }),
    )

    await migrateTimerAndFeedbackConfigs()

    expect(savedFor('timer_automation_config')).toMatchObject({ keepScreenAwake: false })
  })

  it('moves break notifications and the suggested break length onto break guard', async () => {
    window.localStorage.setItem(
      REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY,
      JSON.stringify({ desktopNotificationsEnabled: true }),
    )
    window.localStorage.setItem(
      TIMER_FOCUS_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 3, global: { primaryMinutes: 25, breakMinutes: 12 } }),
    )

    await migrateTimerAndFeedbackConfigs()

    const breakGuard = savedFor('break_guard_config')
    expect(breakGuard).toMatchObject({ notifyOnBreakExpired: true })
    // The old suggested length leads, because it is now what the round-complete
    // prompt reads.
    expect((breakGuard?.presetMinutes as number[])[0]).toBe(12)
  })

  it('carries timer celebration detail into the feedback scenes', async () => {
    window.localStorage.setItem(
      TIMER_FOCUS_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 3,
        celebration: {
          secondaryInterval: { enabled: false, soundEnabled: false, volumeBoost: 0.5 },
          primaryGoal: { enabled: true, animationEnabled: false, visualPreset: 'fireworks' },
        },
      }),
    )

    await migrateTimerAndFeedbackConfigs()

    const feedback = savedFor('review_feedback_settings')
    const scenes = feedback?.scenes as Record<string, Record<string, unknown>>
    expect(scenes.timerInterval).toMatchObject({ enabled: false, soundEnabled: false, volumeBoost: 0.5 })
    expect(scenes.timerRound).toMatchObject({ animationEnabled: false, confettiPreset: 'fireworks' })
  })
})
