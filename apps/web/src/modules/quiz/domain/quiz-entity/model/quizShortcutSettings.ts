import { createPersistentPreferenceStore } from '@/shared/preferences/persistentPreferenceStore'
import {
  DEFAULT_QUIZ_SHORTCUTS,
  isQuizShortcutMap,
  sanitizeQuizShortcutMap,
  type QuizShortcutMap,
} from './quizShortcuts'

export const QUIZ_SHORTCUTS_STORAGE_KEY = 'memory-anki.quiz.shortcuts.v1'
export const QUIZ_SHORTCUTS_UPDATED_EVENT = 'memory-anki-quiz-shortcuts-change'

const quizShortcutStore = createPersistentPreferenceStore<QuizShortcutMap>({
  cacheKey: 'quiz_shortcuts',
  defaultValue: DEFAULT_QUIZ_SHORTCUTS,
  localStorageKey: QUIZ_SHORTCUTS_STORAGE_KEY,
  sanitize: sanitizeQuizShortcutMap,
  updatedEvent: QUIZ_SHORTCUTS_UPDATED_EVENT,
  isValidCache: isQuizShortcutMap,
})

export function readQuizShortcuts() {
  return quizShortcutStore.read()
}

export function writeQuizShortcuts(value: QuizShortcutMap) {
  return quizShortcutStore.write(value)
}

export function resetQuizShortcuts() {
  return quizShortcutStore.reset()
}
