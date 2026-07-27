import {
  getClientPreferenceCacheStatus,
  hasLoadedClientPreferences,
  saveClientPreference,
} from '@/shared/preferences/clientPreferences'
import {
  REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY,
  sanitizeReviewFeedbackSettings,
  timerCelebrationEventToScene,
} from '@/shared/feedback/reviewFeedbackSettings'
import {
  BREAK_GUARD_STORAGE_KEY,
  sanitizeBreakGuardConfig,
} from '@/shared/components/session/break-guard-config'
import {
  TIMER_AUTOMATION_STORAGE_KEY,
  sanitizeTimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import { TIMER_FOCUS_STORAGE_KEY } from '@/shared/components/session/timer-focus-config'

type RawRecord = Record<string, unknown>

/**
 * Read a preference exactly as stored, before any sanitize strips fields.
 *
 * Order matters: the backend cache is authoritative once preferences have
 * loaded, but a user who has not synced yet still has the payload only in
 * localStorage. Both must be consulted, because this migration has to run
 * before `bootstrapClientPreferences` sanitizes the localStorage copy on its
 * way to the backend.
 */
function readRawPreference(
  preferenceKey: Parameters<typeof getClientPreferenceCacheStatus>[0],
  storageKey: string,
): RawRecord | null {
  const cached = getClientPreferenceCacheStatus(
    preferenceKey,
    (value): value is RawRecord => Boolean(value && typeof value === 'object'),
  )
  if (cached.value) return cached.value

  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as RawRecord) : null
  } catch {
    return null
  }
}

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === 'object' ? (value as RawRecord) : null
}

function dedupeMinutes(values: number[]): number[] {
  return Array.from(new Set(values.filter((item) => Number.isFinite(item) && item > 0))).slice(0, 6)
}

/**
 * Move settings to the config that actually owns them.
 *
 * Four one-way carries, all from schema versions that no longer describe these
 * fields:
 *  1. review feedback `keepScreenAwake`             -> timer automation
 *  2. review feedback `desktopNotificationsEnabled` -> break guard
 *  3. timer focus `global.breakMinutes`             -> break guard preset list
 *  4. timer focus `celebration.*`                   -> review feedback scenes
 *
 * Must run after `initializeClientPreferences()` resolves but before the
 * bootstrap migrations sanitize anything: sanitize drops these fields
 * permanently, and the in-session timer dialog can trigger a save at any time.
 */
export async function migrateTimerAndFeedbackConfigs(): Promise<void> {
  if (typeof window === 'undefined') return
  // Without loaded preferences every read falls back to defaults, and writing
  // those back would overwrite the user's real settings with stock values.
  if (!hasLoadedClientPreferences()) return

  const rawFocus = readRawPreference('timer_focus_config', TIMER_FOCUS_STORAGE_KEY)
  const rawFeedback = readRawPreference('review_feedback_settings', REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY)

  const legacyFocusGlobal = asRecord(rawFocus?.global)
  const legacyCelebration = asRecord(rawFocus?.celebration)
  const hasLegacyFocus = Boolean(legacyFocusGlobal || legacyCelebration)
  const hasLegacyFeedback =
    rawFeedback != null &&
    ('keepScreenAwake' in rawFeedback || 'desktopNotificationsEnabled' in rawFeedback)

  if (!hasLegacyFocus && !hasLegacyFeedback) return

  const writes: Promise<unknown>[] = []

  // 1. Screen wake lock belongs with the timing rules it protects.
  if (rawFeedback && typeof rawFeedback.keepScreenAwake === 'boolean') {
    const automation = sanitizeTimerAutomationConfig(
      readRawPreference('timer_automation_config', TIMER_AUTOMATION_STORAGE_KEY) ?? {},
    )
    writes.push(
      saveClientPreference('timer_automation_config', {
        ...automation,
        keepScreenAwake: rawFeedback.keepScreenAwake,
      }),
    )
  }

  // 2 + 3. Break notification and suggested break length belong with break guard.
  const notify = rawFeedback?.desktopNotificationsEnabled
  const legacyBreakMinutes = Number(legacyFocusGlobal?.breakMinutes)
  if (typeof notify === 'boolean' || Number.isFinite(legacyBreakMinutes)) {
    const breakGuard = sanitizeBreakGuardConfig(
      readRawPreference('break_guard_config', BREAK_GUARD_STORAGE_KEY) ?? {},
    )
    writes.push(
      saveClientPreference('break_guard_config', {
        ...breakGuard,
        notifyOnBreakExpired:
          typeof notify === 'boolean' ? notify : breakGuard.notifyOnBreakExpired,
        // The old "suggested break" becomes the first preset, which is now what
        // the round-complete prompt reads.
        presetMinutes: Number.isFinite(legacyBreakMinutes)
          ? dedupeMinutes([Math.round(legacyBreakMinutes), ...breakGuard.presetMinutes])
          : breakGuard.presetMinutes,
      }),
    )
  }

  // 4. Timer celebration detail becomes two ordinary feedback scenes.
  if (legacyCelebration) {
    const feedback = sanitizeReviewFeedbackSettings(rawFeedback ?? {})
    writes.push(
      saveClientPreference('review_feedback_settings', {
        ...feedback,
        scenes: {
          ...feedback.scenes,
          timerInterval: timerCelebrationEventToScene(
            legacyCelebration.secondaryInterval,
            feedback.scenes.timerInterval,
          ),
          timerRound: timerCelebrationEventToScene(
            legacyCelebration.primaryGoal,
            feedback.scenes.timerRound,
          ),
        },
      }),
    )
  }

  await Promise.all(writes)
}
