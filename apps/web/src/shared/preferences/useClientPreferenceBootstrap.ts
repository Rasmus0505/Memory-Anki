import { useEffect } from 'react'
import { toast } from '@/shared/feedback/toast'
import { DEFAULT_PALACE_LIST_VIEW_SETTINGS, DEFAULT_PALACE_SHELF_VIEW_SETTINGS, isPalaceListViewSettings, isPalaceShelfViewSettings, PALACE_LIST_VIEW_SETTINGS_KEY, PALACE_SHELF_VIEW_SETTINGS_KEY } from '@/app/router/palace-view-settings'
import { DEFAULT_ENGLISH_PRACTICE_SETTINGS, ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY, sanitizeEnglishPracticeSettings } from '@/features/english/englishPracticeSettings'
import { DEFAULT_REVIEW_FEEDBACK_SETTINGS, REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY, sanitizeReviewFeedbackSettings } from '@/features/review/reviewFeedbackSettings'
import { DEFAULT_MEMORY_ANKI_SHORTCUTS, MEMORY_ANKI_SHORTCUTS_STORAGE_KEY, sanitizeMemoryAnkiShortcutMap } from '@/features/shortcuts/memoryAnkiShortcuts'
import { DEFAULT_TIMER_AUTOMATION_CONFIG, TIMER_AUTOMATION_STORAGE_KEY, sanitizeTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { DEFAULT_TIMER_FOCUS_CONFIG, TIMER_FOCUS_STORAGE_KEY, sanitizeTimerFocusConfig } from '@/shared/components/session/timer-focus-config'
import { DEFAULT_VOICE_COACH_SETTINGS, VOICE_COACH_SETTINGS_STORAGE_KEY, sanitizeVoiceCoachSettings } from '@/features/voice-coach/voiceCoachSettings'
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
        migrateLocalPreferenceToBackend(
          'memory_anki_shortcuts',
          MEMORY_ANKI_SHORTCUTS_STORAGE_KEY,
          DEFAULT_MEMORY_ANKI_SHORTCUTS,
          sanitizeMemoryAnkiShortcutMap,
        ),
        migrateLocalPreferenceToBackend(
          'review_feedback_settings',
          REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY,
          DEFAULT_REVIEW_FEEDBACK_SETTINGS,
          sanitizeReviewFeedbackSettings,
        ),
        migrateLocalPreferenceToBackend(
          'english_practice_settings',
          ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY,
          DEFAULT_ENGLISH_PRACTICE_SETTINGS,
          sanitizeEnglishPracticeSettings,
        ),
        migrateLocalPreferenceToBackend(
          'timer_automation_config',
          TIMER_AUTOMATION_STORAGE_KEY,
          DEFAULT_TIMER_AUTOMATION_CONFIG,
          sanitizeTimerAutomationConfig,
        ),
        migrateLocalPreferenceToBackend(
          'timer_focus_config',
          TIMER_FOCUS_STORAGE_KEY,
          DEFAULT_TIMER_FOCUS_CONFIG,
          sanitizeTimerFocusConfig,
        ),
        migrateLocalPreferenceToBackend(
          'voice_coach_settings',
          VOICE_COACH_SETTINGS_STORAGE_KEY,
          DEFAULT_VOICE_COACH_SETTINGS,
          sanitizeVoiceCoachSettings,
        ),
        migrateLocalPreferenceToBackend(
          'palace_list_view_settings',
          PALACE_LIST_VIEW_SETTINGS_KEY,
          DEFAULT_PALACE_LIST_VIEW_SETTINGS,
          isPalaceListViewSettings,
        ),
        migrateLocalPreferenceToBackend(
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
        Boolean(window.localStorage.getItem(VOICE_COACH_SETTINGS_STORAGE_KEY)) ||
        Boolean(window.localStorage.getItem(PALACE_LIST_VIEW_SETTINGS_KEY)) ||
        Boolean(window.localStorage.getItem(PALACE_SHELF_VIEW_SETTINGS_KEY))

      await Promise.all(migrations)

      if (hadLegacyLocalState) {
        toast.success('关键个人设置已迁移到后端保存，改代码和切版本时会更稳。')
      }
    })()
  }, [])
}
