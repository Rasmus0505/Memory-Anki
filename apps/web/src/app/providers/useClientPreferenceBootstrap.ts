import { useEffect } from 'react'
import { toast } from '@/shared/feedback/toast'
import {
  DEFAULT_PALACE_LIST_VIEW_SETTINGS,
  DEFAULT_PALACE_SHELF_VIEW_SETTINGS,
  isPalaceListViewSettings,
  isPalaceShelfViewSettings,
  PALACE_LIST_VIEW_SETTINGS_KEY,
  PALACE_SHELF_VIEW_SETTINGS_KEY,
} from '@/entities/preferences/model'
import {
  DEFAULT_ENGLISH_PRACTICE_SETTINGS,
  ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY,
  ENGLISH_PRACTICE_SETTINGS_UPDATED_EVENT,
  sanitizeEnglishPracticeSettings,
} from '@/entities/preferences/model/englishPracticeSettings'
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
} from '@/entities/preferences/model/memoryAnkiShortcuts'
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
  initializeClientPreferences,
  migrateLocalPreferenceToBackend,
} from '@/shared/preferences/clientPreferences'

export function useClientPreferenceBootstrap() {
  useEffect(() => {
    void (async () => {
      await initializeClientPreferences()
      if (typeof window === 'undefined') return

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
      ]

      const hadLegacyLocalState =
        Boolean(window.localStorage.getItem(MEMORY_ANKI_SHORTCUTS_STORAGE_KEY)) ||
        Boolean(window.localStorage.getItem(REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY)) ||
        Boolean(window.localStorage.getItem(ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY)) ||
        Boolean(window.localStorage.getItem(TIMER_AUTOMATION_STORAGE_KEY)) ||
        Boolean(window.localStorage.getItem(TIMER_FOCUS_STORAGE_KEY)) ||
        Boolean(window.localStorage.getItem(PALACE_LIST_VIEW_SETTINGS_KEY)) ||
        Boolean(window.localStorage.getItem(PALACE_SHELF_VIEW_SETTINGS_KEY))

      await Promise.all(migrations)

      const hasRemainingLegacyLocalState =
        Boolean(window.localStorage.getItem(MEMORY_ANKI_SHORTCUTS_STORAGE_KEY)) ||
        Boolean(window.localStorage.getItem(REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY)) ||
        Boolean(window.localStorage.getItem(ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY)) ||
        Boolean(window.localStorage.getItem(TIMER_AUTOMATION_STORAGE_KEY)) ||
        Boolean(window.localStorage.getItem(TIMER_FOCUS_STORAGE_KEY)) ||
        Boolean(window.localStorage.getItem(PALACE_LIST_VIEW_SETTINGS_KEY)) ||
        Boolean(window.localStorage.getItem(PALACE_SHELF_VIEW_SETTINGS_KEY))

      if (hadLegacyLocalState && !hasRemainingLegacyLocalState) {
        toast.success('关键个人设置已迁移到后端保存，改代码和切版本时会更稳。')
      }
    })()
  }, [])
}

function migrateAndNotify<T>(
  key: Parameters<typeof migrateLocalPreferenceToBackend<T>>[0],
  localStorageKey: string,
  fallback: T,
  normalizeValue: Parameters<typeof migrateLocalPreferenceToBackend<T>>[3],
  updatedEvent?: string,
) {
  return migrateLocalPreferenceToBackend(key, localStorageKey, fallback, normalizeValue).then((value) => {
    if (updatedEvent && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(updatedEvent, { detail: value }))
    }
    return value
  })
}
