import { createPersistentPreferenceStore } from '@/shared/preferences/persistentPreferenceStore'
import {
  DEFAULT_QUIZ_FONT_SCALE_SETTINGS,
  isQuizFontScaleSettings,
  sanitizeQuizFontScaleSettings,
  snapQuizFontPercent,
  type QuizFontScaleSettings,
} from './quizFontScale'

export const QUIZ_FONT_SCALE_STORAGE_KEY = 'memory-anki.quiz.font-scale.v1'
export const QUIZ_FONT_SCALE_UPDATED_EVENT = 'memory-anki-quiz-font-scale-change'

const quizFontScaleStore = createPersistentPreferenceStore<QuizFontScaleSettings>({
  cacheKey: 'quiz_font_scale',
  defaultValue: DEFAULT_QUIZ_FONT_SCALE_SETTINGS,
  localStorageKey: QUIZ_FONT_SCALE_STORAGE_KEY,
  sanitize: sanitizeQuizFontScaleSettings,
  updatedEvent: QUIZ_FONT_SCALE_UPDATED_EVENT,
  isValidCache: isQuizFontScaleSettings,
})

export function readQuizFontScale() {
  return quizFontScaleStore.read().percent
}

export function saveQuizFontScale(percent: number) {
  return quizFontScaleStore.write({ percent: snapQuizFontPercent(percent) }).percent
}
