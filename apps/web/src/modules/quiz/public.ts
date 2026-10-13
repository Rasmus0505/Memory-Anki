/**
 * Public surface for module `quiz`.
 * Other modules may import only from this file.
 */
import { lazy } from 'react'

export * from './domain/quiz-entity'
export * from './domain/quiz-entity/api'
export const PalaceQuizPage = lazy(() => import('./ui/palace-quiz/PalaceQuizPage'))
export * from './ui/palace-quiz/api/palaceQuizApi'
export { PreviewQuestionAnswerSummary } from './ui/palace-quiz/components/palaceQuizCards'
export { getQuestionTypeLabel } from './ui/palace-quiz/model/palaceQuizPage'
export * from './ui/palace-quiz/components/QuizNodeBindingDialog'
export * from './ui/palace-quiz/components/QuizNodeDeleteGuardDialog'
export * from './ui/palace-quiz/hooks/usePalaceQuizNodeBindings'
