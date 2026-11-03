import { createPersistentPreferenceStore } from '@/shared/preferences/persistentPreferenceStore'
import {
  DEFAULT_QUIZ_OPTION_SHUFFLE_SETTINGS,
  isQuizOptionShuffleSettings,
  sanitizeQuizOptionShuffleSettings,
  type QuizOptionShuffleSettings,
} from './quizOptionShuffle'

export const QUIZ_OPTION_SHUFFLE_STORAGE_KEY = 'memory-anki.quiz.option-shuffle.v1'
export const QUIZ_OPTION_SHUFFLE_UPDATED_EVENT = 'memory-anki-quiz-option-shuffle-change'

const store = createPersistentPreferenceStore<QuizOptionShuffleSettings>({
  cacheKey: 'quiz_option_shuffle',
  defaultValue: DEFAULT_QUIZ_OPTION_SHUFFLE_SETTINGS,
  localStorageKey: QUIZ_OPTION_SHUFFLE_STORAGE_KEY,
  sanitize: sanitizeQuizOptionShuffleSettings,
  updatedEvent: QUIZ_OPTION_SHUFFLE_UPDATED_EVENT,
  isValidCache: isQuizOptionShuffleSettings,
})

export function readQuizOptionShuffleSettings() {
  return store.read()
}

export function saveQuizOptionShuffleSettings(settings: QuizOptionShuffleSettings) {
  return store.write(settings)
}
