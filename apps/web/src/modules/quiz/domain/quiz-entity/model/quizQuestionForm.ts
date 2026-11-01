import type {
  PalaceQuizQuestion,
  PalaceQuizQuestionDraft,
  PalaceQuizQuestionType,
  PalaceQuizSourceMeta,
} from '@/shared/api/contracts'

/**
 * The editable shape of a hand-written question, shared by the Palace Quiz
 * management card and the do-question overlays.
 *
 * The answer is kept as `correct_option_ids` rather than one id because a
 * multiple choice question may legitimately have several correct options
 * (`answer_payload.correct_option_ids`). A single select would silently drop
 * the extra answers the first time someone opened a multi-select question to
 * fix a typo.
 */
export interface QuizQuestionFormState {
  question_type: PalaceQuizQuestionType
  stem: string
  options: Array<{ id: string; text: string }>
  correct_option_ids: string[]
  reference_answer: string
  analysis: string
  source_meta: PalaceQuizSourceMeta
}

export function buildManualSourceMeta(): PalaceQuizSourceMeta {
  return {
    source_kind: 'manual',
    page_numbers: null,
    image_names: null,
    extra_prompt: '',
    ai_call_log_id: null,
    generated_at: new Date().toISOString(),
    generation_mode: 'manual',
  }
}

export function buildEmptyQuestionForm(): QuizQuestionFormState {
  return {
    question_type: 'multiple_choice',
    stem: '',
    options: [
      { id: 'A', text: '' },
      { id: 'B', text: '' },
    ],
    correct_option_ids: ['A'],
    reference_answer: '',
    analysis: '',
    source_meta: buildManualSourceMeta(),
  }
}

/** Correct option ids of a question, single-answer payloads included. */
export function questionCorrectOptionIds(question: {
  answer_payload?: { correct_option_id?: string; correct_option_ids?: string[] }
}) {
  const multi = (question.answer_payload?.correct_option_ids || [])
    .map((item) => String(item).trim())
    .filter(Boolean)
  if (multi.length > 0) return multi
  const single = String(question.answer_payload?.correct_option_id || '').trim()
  return single ? [single] : []
}

export function buildQuestionFormFromQuestion(question: PalaceQuizQuestion): QuizQuestionFormState {
  // While an AI variant is displayed, the editor must still edit the original
  // row; otherwise saving would overwrite the original with the variant.
  const content = question.original_content ?? question
  return {
    question_type: content.question_type,
    stem: content.stem,
    options:
      content.question_type === 'multiple_choice'
        ? (content.options || []).map((option) => ({
            id: option.id,
            text: option.text,
          }))
        : [
            { id: 'A', text: '' },
            { id: 'B', text: '' },
          ],
    correct_option_ids: questionCorrectOptionIds(content),
    reference_answer: content.answer_payload.reference_answer || '',
    analysis: content.analysis || '',
    source_meta: question.source_meta || buildManualSourceMeta(),
  }
}

export function buildDraftFromForm(form: QuizQuestionFormState): PalaceQuizQuestionDraft {
  const stem = form.stem.trim()
  if (!stem) {
    throw new Error('题干不能为空。')
  }
  if (form.question_type === 'multiple_choice') {
    const options = form.options
      .map((option, index) => ({
        id: option.id || String.fromCharCode(65 + index),
        text: option.text.trim(),
      }))
      .filter((option) => option.text)
    if (options.length < 2) {
      throw new Error('选择题至少需要 2 个选项。')
    }
    const correctIds = options
      .filter((option) => form.correct_option_ids.includes(option.id))
      .map((option) => option.id)
    if (correctIds.length === 0) {
      throw new Error('请选择至少一个正确选项。')
    }
    return {
      question_type: 'multiple_choice',
      stem,
      options,
      // One answer keeps the single-answer payload shape; two or more is a
      // multi-select question. The backend orders them by option order.
      answer_payload: correctIds.length > 1
        ? { correct_option_ids: correctIds }
        : { correct_option_id: correctIds[0] },
      analysis: form.analysis.trim(),
      source_meta: form.source_meta,
    }
  }
  const referenceAnswer = form.reference_answer.trim()
  if (!referenceAnswer) {
    throw new Error('简答题必须填写参考答案。')
  }
  return {
    question_type: 'short_answer',
    stem,
    options: [],
    answer_payload: { reference_answer: referenceAnswer },
    analysis: form.analysis.trim(),
    source_meta: form.source_meta,
  }
}

/** Hand-editing only exists for the two free-text question kinds. */
export function canManuallyEditQuestion(questionType: PalaceQuizQuestionType) {
  return questionType === 'multiple_choice' || questionType === 'short_answer'
}
