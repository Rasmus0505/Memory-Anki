import type { PalaceShortAnswerFeedback } from '@/shared/api/contracts'

export interface QuizRuntimeState {
  resolved?: boolean
  correct?: boolean
  selectedOptionId?: string
  trueFalseAnswer?: boolean
  blankInputs?: Record<string, string>
  submittedBlankIds?: string[]
  matchingPairs?: Record<string, string>
  selectedLeftId?: string | null
  orderingIds?: string[]
  categorizationAssignments?: Record<string, string>
  selectedCategorizationItemId?: string | null
  shortAnswerText?: string
  shortAnswerSubmitted?: boolean
  shortAnswerFeedback?: PalaceShortAnswerFeedback | null
  shortAnswerFeedbackLoading?: boolean
  skipped?: boolean
}
