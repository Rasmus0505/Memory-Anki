/**
 * Public surface for module `settings`.
 * Other modules may import only from this file.
 */
export * from './domain/ai-learning-entity'
export * from './domain/ai-log-entity/api'
export * from './domain/ai-runtime-entity'
export * from './domain/preferences-entity/api'
export * from './domain/preferences-entity/model/palaceViewSettings'
export * from './domain/runtime-entity/api'
// Prefer englishPracticeSettings for shared shortcut capture helper (also used by memory shortcuts).
export {
  captureShortcutFromKeyboardEvent,
  DEFAULT_ENGLISH_PRACTICE_SETTINGS,
  DEFAULT_SHORTCUTS,
  ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY,
  ENGLISH_PRACTICE_SETTINGS_UPDATED_EVENT,
  ENGLISH_SHORTCUT_ACTIONS,
  getShortcutLabel,
  getShortcutSignature,
  isShortcutPressed,
  normalizeShortcutBindingValue,
  readEnglishPracticeSettings,
  resetEnglishPracticeSettings,
  sanitizeEnglishPracticeSettings,
  sanitizeEnglishShortcutMap,
  writeEnglishPracticeSettings,
  type EnglishPracticeSettings,
  type EnglishPracticeShortcutMap,
  type EnglishShortcutActionDefinition,
  type EnglishShortcutActionId,
  type ShortcutActionId,
  type ShortcutBinding,
} from './domain/preferences-entity/model/englishPracticeSettings'
export {
  DEFAULT_MEMORY_ANKI_SHORTCUTS,
  MEMORY_ANKI_SHORTCUTS_STORAGE_KEY,
  MEMORY_ANKI_SHORTCUTS_UPDATED_EVENT,
  MEMORY_ANKI_SHORTCUT_ACTIONS,
  readMemoryAnkiShortcuts,
  resetMemoryAnkiShortcuts,
  sanitizeMemoryAnkiShortcutMap,
  useMemoryAnkiShortcuts,
  writeMemoryAnkiShortcuts,
  type MemoryAnkiShortcutActionDefinition,
  type MemoryAnkiShortcutActionId,
  type MemoryAnkiShortcutHandlers,
  type MemoryAnkiShortcutMap,
  type ShortcutScene,
} from './domain/preferences-entity/model/memoryAnkiShortcuts'
export { default as ProfileAiPage } from './ui/profile/ProfileAiPage'
export { default as ProfileBackupsPage } from './ui/profile/ProfileBackupsPage'
export { default as ProfileFeedbackPage } from './ui/profile/ProfileFeedbackPage'
export { default as ProfileSettingsPage } from './ui/profile/ProfileSettingsPage'
export { default as ProfileTimerPage } from './ui/profile/ProfileTimerPage'
export * from './ui/profile/components/TimeRecordDialog'
export * from './ui/profile/components/TimeRecordQuickAddDialog'
export * from './ui/profile/components/TimeRecordsBreakdownChart'
export * from './ui/profile/components/TimeRecordsTable'
export * from './ui/profile/components/TimeRecordsTrendChart'
export * from './ui/profile/hooks/useTimeRecordsDashboard'
export * from './ui/shortcuts/FlipCardShortcutsDialog'
export * from './ui/shortcuts/MemoryAnkiShortcutsSettings'
