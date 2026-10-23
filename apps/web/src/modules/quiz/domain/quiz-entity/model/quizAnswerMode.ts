import { rewriteMcqForSubjective } from './mcqSubjectiveRewrite'

export type QuizAnswerMode = 'choice' | 'subjective'

export interface QuizAnswerModeSettings {
  mcqMode: QuizAnswerMode
}

export const DEFAULT_QUIZ_ANSWER_MODE: QuizAnswerMode = 'choice'

export const DEFAULT_QUIZ_ANSWER_MODE_SETTINGS: QuizAnswerModeSettings = {
  mcqMode: DEFAULT_QUIZ_ANSWER_MODE,
}

export function canSwitchQuizAnswerMode(questionType: string) {
  return questionType === 'multiple_choice'
}

export function isQuizSubjectivePresentation(questionType: string, mode: QuizAnswerMode) {
  return questionType === 'short_answer' || (questionType === 'multiple_choice' && mode === 'subjective')
}

export function isQuizChoiceShortcutActive(questionType: string, mode: QuizAnswerMode) {
  return questionType === 'multiple_choice' && mode !== 'subjective'
}

/** A subjective submit sets `resolved` without selecting an option. Choice stays open until then. */
export function isQuizChoiceAttemptClosed(
  state:
    | {
        selectedOptionId?: string | null
        selectedOptionIds?: string[] | null
        resolved?: boolean
        shortAnswerSubmitted?: boolean
      }
    | undefined,
) {
  return Boolean(state?.selectedOptionId) || Boolean(state?.resolved && state?.selectedOptionIds?.length)
}

export function toggleQuizOptionSelection(selected: string[] | undefined, optionId: string) {
  const picked = selected || []
  return picked.includes(optionId)
    ? picked.filter((item) => item !== optionId)
    : [...picked, optionId].sort()
}

export function mcqReferenceAnswer(question: {
  options?: Array<{ id: string; text: string }>
  answer_payload?: { correct_option_id?: string; correct_option_ids?: string[] }
}) {
  const multiIds = (question.answer_payload?.correct_option_ids || []).map((item) => String(item).trim()).filter(Boolean)
  if (multiIds.length > 1) {
    return multiIds
      .map((id) => {
        const option = (question.options || []).find((item) => item.id === id)
        return option?.text?.trim() ? `${id}. ${option.text.trim()}` : id
      })
      .join('；')
  }
  const correctId = String(question.answer_payload?.correct_option_id || '').trim()
  const option = (question.options || []).find((item) => item.id === correctId)
  const text = option?.text?.trim() || ''
  if (correctId && text) return `${correctId}. ${text}`
  return text || correctId
}

export function quizDisplayStem(
  question: {
    question_type: string
    stem?: string
    options?: Array<{ id: string; text: string }>
    answer_payload?: { correct_option_id?: string }
  },
  mode: QuizAnswerMode,
) {
  const stem = String(question.stem || '')
  if (question.question_type !== 'multiple_choice' || mode !== 'subjective') return stem
  return rewriteMcqForSubjective({
    stem,
    options: question.options,
    correctOptionId: question.answer_payload?.correct_option_id,
  }).stem
}

export function mcqSubjectiveReferenceAnswer(question: {
  stem?: string
  options?: Array<{ id: string; text: string }>
  answer_payload?: { correct_option_id?: string; correct_option_ids?: string[] }
}) {
  const multiIds = (question.answer_payload?.correct_option_ids || []).filter(Boolean)
  if (multiIds.length > 1) return `正确答案：${multiIds.join('')}`
  return rewriteMcqForSubjective({
    stem: question.stem,
    options: question.options,
    correctOptionId: question.answer_payload?.correct_option_id,
  }).referenceAnswer
}

export function mcqRevealOptions(question: {
  options?: Array<{ id: string; text: string }>
  answer_payload?: { correct_option_id?: string; correct_option_ids?: string[] }
}) {
  const correctIds = new Set(
    (question.answer_payload?.correct_option_ids || [])
      .map((item) => String(item).trim())
      .filter(Boolean),
  )
  const correctId = String(question.answer_payload?.correct_option_id || '').trim()
  if (correctIds.size === 0 && correctId) correctIds.add(correctId)
  return (question.options || []).map((item) => ({
    id: item.id,
    text: item.text,
    correct: correctIds.has(item.id),
  }))
}

export function formatMcqSubjectiveAnalysis(referenceAnswer: string, analysis: string) {
  const answer = String(referenceAnswer || '').trim()
  const body = String(analysis || '').trim()
  if (answer && body) return `答案：${answer}\n${body}`
  if (answer) return `答案：${answer}`
  return body || '暂无解析'
}

export function quizInteractionRestoreKey(
  question: { id?: number; stem?: string; question_type: string },
  mode: QuizAnswerMode,
) {
  const id = question.id != null ? `id:${question.id}` : `draft:${question.stem || ''}`
  return `${id}:${question.question_type}:${mode}`
}

export function sanitizeQuizAnswerModeSettings(value: unknown): QuizAnswerModeSettings {
  if (value === 'subjective' || value === 'choice') {
    return { mcqMode: value }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_QUIZ_ANSWER_MODE_SETTINGS }
  }
  const raw = value as { mcqMode?: unknown }
  return {
    mcqMode: raw.mcqMode === 'subjective' ? 'subjective' : 'choice',
  }
}

export function isQuizAnswerModeSettings(value: unknown): value is QuizAnswerModeSettings {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      ((value as QuizAnswerModeSettings).mcqMode === 'choice' ||
        (value as QuizAnswerModeSettings).mcqMode === 'subjective'),
  )
}
