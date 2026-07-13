import type { QuizRuntimeState } from '@/entities/quiz'
import type { FreestyleMode } from '@/features/freestyle/model/today-training'
import type { FreestyleQuizCard } from '@/shared/api/contracts'

export function buildAttemptAnswerPayload(
  question: FreestyleQuizCard['question'],
  state: QuizRuntimeState,
) {
  if (question.question_type === 'multiple_choice') {
    return { selected_option_id: state.selectedOptionId || '' }
  }
  if (question.question_type === 'true_false') {
    return { true_false_answer: state.trueFalseAnswer ?? null }
  }
  if (question.question_type === 'fill_blank') {
    return {
      blank_inputs: state.blankInputs || {},
      submitted_blank_ids: state.submittedBlankIds || [],
    }
  }
  if (question.question_type === 'matching') {
    return { matching_pairs: state.matchingPairs || {} }
  }
  if (question.question_type === 'ordering') {
    return { ordering_ids: state.orderingIds || [] }
  }
  if (question.question_type === 'categorization') {
    return { categorization_assignments: state.categorizationAssignments || {} }
  }
  return { user_answer: state.shortAnswerText || '' }
}

export function buildAttemptHistoryPayload(
  card: FreestyleQuizCard,
  state: QuizRuntimeState,
  mode: FreestyleMode,
) {
  return {
    question_id: card.question.id,
    palace_id: card.palace_context.id,
    palace_title: card.palace_context.resolved_title || card.palace_context.title || '',
    mini_palace_id: card.segment_contexts?.[0]?.id ?? null,
    mini_palace_name: card.segment_contexts?.[0]?.name || '',
    chapter_id:
      card.chapter_context?.id ??
      card.question.classified_chapter_id ??
      card.question.source_chapter_id ??
      null,
    chapter_name: card.chapter_context?.name || '',
    mode,
    question_type: card.question.question_type,
    stem_snapshot: card.question.stem,
    answer_payload: buildAttemptAnswerPayload(card.question, state),
    is_correct: typeof state.correct === 'boolean' ? state.correct : null,
  }
}
