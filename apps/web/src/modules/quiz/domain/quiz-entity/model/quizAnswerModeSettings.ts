import { createPersistentPreferenceStore } from '@/shared/preferences/persistentPreferenceStore'
import {
  DEFAULT_QUIZ_ANSWER_MODE_SETTINGS,
  isQuizAnswerModeSettings,
  sanitizeQuizAnswerModeSettings,
  type QuizAnswerMode,
  type QuizAnswerModeSettings,
} from './quizAnswerMode'

export const QUIZ_ANSWER_MODE_STORAGE_KEY = 'memory-anki.quiz.answer-mode.v1'
export const QUIZ_ANSWER_MODE_UPDATED_EVENT = 'memory-anki-quiz-answer-mode-change'

const quizAnswerModeStore = createPersistentPreferenceStore<QuizAnswerModeSettings>({
  cacheKey: 'quiz_answer_mode',
  defaultValue: DEFAULT_QUIZ_ANSWER_MODE_SETTINGS,
  localStorageKey: QUIZ_ANSWER_MODE_STORAGE_KEY,
  sanitize: sanitizeQuizAnswerModeSettings,
  updatedEvent: QUIZ_ANSWER_MODE_UPDATED_EVENT,
  isValidCache: isQuizAnswerModeSettings,
})

export function readQuizAnswerModeSettings() {
  return quizAnswerModeStore.read()
}

export function readQuizAnswerMode(): QuizAnswerMode {
  return readQuizAnswerModeSettings().mcqMode
}

export function saveQuizAnswerMode(mode: QuizAnswerMode) {
  return quizAnswerModeStore.write({ mcqMode: mode })
}
