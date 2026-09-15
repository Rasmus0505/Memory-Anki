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

export function mcqReferenceAnswer(question: {
  options?: Array<{ id: string; text: string }>
  answer_payload?: { correct_option_id?: string }
}) {
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
  answer_payload?: { correct_option_id?: string }
}) {
  return rewriteMcqForSubjective({
    stem: question.stem,
    options: question.options,
    correctOptionId: question.answer_payload?.correct_option_id,
  }).referenceAnswer
}

export function mcqRevealOptions(question: {
  options?: Array<{ id: string; text: string }>
  answer_payload?: { correct_option_id?: string }
}) {
  const correctId = String(question.answer_payload?.correct_option_id || '').trim()
  return (question.options || []).map((item) => ({
    id: item.id,
    text: item.text,
    correct: Boolean(correctId) && item.id === correctId,
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
