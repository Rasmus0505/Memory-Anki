import { useEffect } from 'react'
import { toast } from '@/shared/feedback/toast'
import {
  DEFAULT_PALACE_LIST_VIEW_SETTINGS,
  DEFAULT_PALACE_SHELF_VIEW_SETTINGS,
  isPalaceListViewSettings,
  isPalaceShelfViewSettings,
  PALACE_LIST_VIEW_SETTINGS_KEY,
  PALACE_SHELF_VIEW_SETTINGS_KEY,
} from '@/modules/settings/public'
import {
  DEFAULT_FREESTYLE_FEED_CONFIG,
  FREESTYLE_FEED_CONFIG_STORAGE_KEY,
  FREESTYLE_FEED_CONFIG_UPDATED_EVENT,
  sanitizeFreestyleFeedConfig,
} from '@/modules/practice/public'
import {
  DEFAULT_ENGLISH_PRACTICE_SETTINGS,
  ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY,
  ENGLISH_PRACTICE_SETTINGS_UPDATED_EVENT,
  sanitizeEnglishPracticeSettings,
} from '@/modules/settings/public'
import {
  DEFAULT_REVIEW_FEEDBACK_SETTINGS,
  REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY,
  REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT,
  sanitizeReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'
import {
  DEFAULT_MEMORY_ANKI_SHORTCUTS,
  MEMORY_ANKI_SHORTCUTS_STORAGE_KEY,
  MEMORY_ANKI_SHORTCUTS_UPDATED_EVENT,
  sanitizeMemoryAnkiShortcutMap,
} from '@/modules/settings/public'
import {
  DEFAULT_TIMER_AUTOMATION_CONFIG,
  TIMER_AUTOMATION_STORAGE_KEY,
  TIMER_AUTOMATION_UPDATED_EVENT,
  sanitizeTimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import {
  DEFAULT_TIMER_FOCUS_CONFIG,
  TIMER_FOCUS_STORAGE_KEY,
  TIMER_FOCUS_UPDATED_EVENT,
  sanitizeTimerFocusConfig,
} from '@/shared/components/session/timer-focus-config'
import {
  BREAK_GUARD_STORAGE_KEY,
  BREAK_GUARD_UPDATED_EVENT,
  DEFAULT_BREAK_GUARD_CONFIG,
  sanitizeBreakGuardConfig,
} from '@/shared/components/session/break-guard-config'
import {
  initializeClientPreferences,
  migrateLocalPreferenceToBackend,
} from '@/shared/preferences/clientPreferences'
import {
  DEFAULT_MARK_COLOR_LABELS_SETTINGS,
  hydrateMarkColorLabelsFromBackend,
  MARK_COLOR_LABELS_STORAGE_KEY,
  sanitizeMarkColorLabelsSettings,
} from '@/shared/preferences/markColorLabels'
import { emitAppEvent } from '@/shared/events/appEvents'
import { migrateTimerAndFeedbackConfigs } from '@/shared/components/session/timerConfigMigration'

export function useClientPreferenceBootstrap() {
  useEffect(() => {
    void bootstrapClientPreferences()
  }, [])
}

export async function bootstrapClientPreferences() {
  await initializeClientPreferences()
  if (typeof window === 'undefined') return

  // Must precede the migrations below: those sanitize each payload on its way
  // to the backend, and the new schemas drop the very fields this carries over.
  await migrateTimerAndFeedbackConfigs()

  const migrations = [
    migrateAndNotify(
      'memory_anki_shortcuts',
      MEMORY_ANKI_SHORTCUTS_STORAGE_KEY,
      DEFAULT_MEMORY_ANKI_SHORTCUTS,
      sanitizeMemoryAnkiShortcutMap,
      MEMORY_ANKI_SHORTCUTS_UPDATED_EVENT,
    ),
    migrateAndNotify(
      'review_feedback_settings',
      REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY,
      DEFAULT_REVIEW_FEEDBACK_SETTINGS,
      sanitizeReviewFeedbackSettings,
      REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT,
    ),
    migrateAndNotify(
      'english_practice_settings',
      ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY,
      DEFAULT_ENGLISH_PRACTICE_SETTINGS,
      sanitizeEnglishPracticeSettings,
      ENGLISH_PRACTICE_SETTINGS_UPDATED_EVENT,
    ),
    migrateAndNotify(
      'timer_automation_config',
      TIMER_AUTOMATION_STORAGE_KEY,
      DEFAULT_TIMER_AUTOMATION_CONFIG,
      sanitizeTimerAutomationConfig,
      TIMER_AUTOMATION_UPDATED_EVENT,
    ),
    migrateAndNotify(
      'timer_focus_config',
      TIMER_FOCUS_STORAGE_KEY,
      DEFAULT_TIMER_FOCUS_CONFIG,
      sanitizeTimerFocusConfig,
      TIMER_FOCUS_UPDATED_EVENT,
    ),
    migrateAndNotify(
      'break_guard_config',
      BREAK_GUARD_STORAGE_KEY,
      DEFAULT_BREAK_GUARD_CONFIG,
      sanitizeBreakGuardConfig,
      BREAK_GUARD_UPDATED_EVENT,
    ),
    migrateAndNotify(
      'palace_list_view_settings',
      PALACE_LIST_VIEW_SETTINGS_KEY,
      DEFAULT_PALACE_LIST_VIEW_SETTINGS,
      isPalaceListViewSettings,
    ),
    migrateAndNotify(
      'palace_shelf_view_settings',
      PALACE_SHELF_VIEW_SETTINGS_KEY,
      DEFAULT_PALACE_SHELF_VIEW_SETTINGS,
      isPalaceShelfViewSettings,
    ),
    migrateAndNotify(
      'freestyle_feed_config',
      FREESTYLE_FEED_CONFIG_STORAGE_KEY,
      DEFAULT_FREESTYLE_FEED_CONFIG,
      sanitizeFreestyleFeedConfig,
      FREESTYLE_FEED_CONFIG_UPDATED_EVENT,
    ),
    migrateLocalPreferenceToBackend(
      'mark_color_labels',
      MARK_COLOR_LABELS_STORAGE_KEY,
      DEFAULT_MARK_COLOR_LABELS_SETTINGS,
      sanitizeMarkColorLabelsSettings,
    ).then((value) => {
      // Keep a local mirror so canvas can read without depending on settings module graph.
      hydrateMarkColorLabelsFromBackend(value)
    }),
  ]

  const hadLegacyLocalState =
    Boolean(window.localStorage.getItem(MEMORY_ANKI_SHORTCUTS_STORAGE_KEY)) ||
    Boolean(window.localStorage.getItem(REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY)) ||
    Boolean(window.localStorage.getItem(ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY)) ||
    Boolean(window.localStorage.getItem(TIMER_AUTOMATION_STORAGE_KEY)) ||
    Boolean(window.localStorage.getItem(TIMER_FOCUS_STORAGE_KEY)) ||
    Boolean(window.localStorage.getItem(BREAK_GUARD_STORAGE_KEY)) ||
    Boolean(window.localStorage.getItem(PALACE_LIST_VIEW_SETTINGS_KEY)) ||
    Boolean(window.localStorage.getItem(PALACE_SHELF_VIEW_SETTINGS_KEY)) ||
    Boolean(window.localStorage.getItem(FREESTYLE_FEED_CONFIG_STORAGE_KEY))

  await Promise.all(migrations)

  const hasRemainingLegacyLocalState =
    Boolean(window.localStorage.getItem(MEMORY_ANKI_SHORTCUTS_STORAGE_KEY)) ||
    Boolean(window.localStorage.getItem(REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY)) ||
    Boolean(window.localStorage.getItem(ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY)) ||
    Boolean(window.localStorage.getItem(TIMER_AUTOMATION_STORAGE_KEY)) ||
    Boolean(window.localStorage.getItem(TIMER_FOCUS_STORAGE_KEY)) ||
    Boolean(window.localStorage.getItem(BREAK_GUARD_STORAGE_KEY)) ||
    Boolean(window.localStorage.getItem(PALACE_LIST_VIEW_SETTINGS_KEY)) ||
    Boolean(window.localStorage.getItem(PALACE_SHELF_VIEW_SETTINGS_KEY)) ||
    Boolean(window.localStorage.getItem(FREESTYLE_FEED_CONFIG_STORAGE_KEY))

  if (hadLegacyLocalState && !hasRemainingLegacyLocalState) {
    toast.success('关键个人设置已迁移到后端保存，改代码和切版本时会更稳。')
  }
}

function migrateAndNotify<T>(
  key: Parameters<typeof migrateLocalPreferenceToBackend<T>>[0],
  localStorageKey: string,
  fallback: T,
  normalizeValue: Parameters<typeof migrateLocalPreferenceToBackend<T>>[3],
  updatedEvent?: string,
) {
  return migrateLocalPreferenceToBackend(key, localStorageKey, fallback, normalizeValue).then((value) => {
    if (updatedEvent) {
      emitAppEvent(updatedEvent, value)
    }
    return value
  })
}
