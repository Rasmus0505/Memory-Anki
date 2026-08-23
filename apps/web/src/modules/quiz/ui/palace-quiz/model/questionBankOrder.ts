import type { PalaceQuizQuestion, PalaceQuizQuestionType } from '@/shared/api/contracts'

export const QUESTION_TYPE_DISPLAY_ORDER: PalaceQuizQuestionType[] = [
  'multiple_choice',
  'true_false',
  'fill_blank',
  'matching',
  'ordering',
  'categorization',
  'short_answer',
]

const QUESTION_TYPE_DISPLAY_RANKS = Object.fromEntries(
  QUESTION_TYPE_DISPLAY_ORDER.map((questionType, index) => [questionType, index]),
) as Record<PalaceQuizQuestionType, number>

export function questionTypeDisplayRank(questionType: string | null | undefined): number {
  return QUESTION_TYPE_DISPLAY_RANKS[questionType as PalaceQuizQuestionType] ?? 99
}

export function sortQuestionsForBankDisplay<T extends { question_type?: string; sort_order?: number; id?: number }>(
  questions: readonly T[],
): T[] {
  return [...questions].sort((left, right) => {
    const typeDelta = questionTypeDisplayRank(left.question_type) - questionTypeDisplayRank(right.question_type)
    if (typeDelta !== 0) return typeDelta
    const sortDelta = (left.sort_order ?? 0) - (right.sort_order ?? 0)
    if (sortDelta !== 0) return sortDelta
    return (left.id ?? 0) - (right.id ?? 0)
  })
}

export function sortPalaceQuizQuestions(questions: readonly PalaceQuizQuestion[]): PalaceQuizQuestion[] {
  return sortQuestionsForBankDisplay(questions)
}
