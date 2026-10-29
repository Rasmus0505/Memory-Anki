import type { PalaceQuizQuestion } from '@/shared/api/contracts'

/**
 * 复制题目 writes one answering window's questions as plain text: numbered stem,
 * options, the answer for that question type, and 解析. It is meant for pasting
 * into notes or an AI chat, so nothing is escaped and no markdown is emitted.
 *
 * The scope is the whole loaded window, not the single question on screen and
 * not the visible question-number page.
 */
export type QuizCopyQuestion = Pick<
  PalaceQuizQuestion,
  'question_type' | 'stem' | 'options' | 'answer_payload' | 'analysis'
>

function text(value: unknown) {
  return String(value ?? '').trim()
}

function formatChoiceAnswer(question: QuizCopyQuestion) {
  const payload = question.answer_payload ?? {}
  const ids = Array.from(
    new Set(
      [...(payload.correct_option_ids ?? []), payload.correct_option_id]
        .map((id) => text(id))
        .filter(Boolean),
    ),
  )
  if (ids.length === 0) return ''
  return ids
    .map((id) => {
      const option = (question.options ?? []).find((item) => item.id === id)
      const optionText = text(option?.text)
      return optionText ? `${id}. ${optionText}` : id
    })
    .join('；')
}

/** The answer line (plus 错误点) for one question, or '' when it has none. */
export function formatQuizQuestionCopyAnswer(question: QuizCopyQuestion) {
  const payload = question.answer_payload ?? {}
  switch (question.question_type) {
    case 'multiple_choice': {
      const answer = formatChoiceAnswer(question)
      return answer ? `答案：${answer}` : ''
    }
    case 'true_false': {
      if (typeof payload.correct_answer !== 'boolean') return ''
      const lines = [`答案：${payload.correct_answer ? '对' : '错'}`]
      const falsePoint = text(payload.false_explanation)
      if (!payload.correct_answer && falsePoint) lines.push(`错误点：${falsePoint}`)
      return lines.join('\n')
    }
    case 'fill_blank': {
      const blanks = payload.blanks ?? []
      if (blanks.length === 0) return ''
      if (blanks.length === 1) return `答案：${text(blanks[0].answer)}`
      return `答案：${blanks
        .map((blank) => {
          const label = text(blank.id)
          return label ? `${label}：${text(blank.answer)}` : text(blank.answer)
        })
        .join('；')}`
    }
    case 'matching': {
      const pairs = payload.pairs ?? []
      if (pairs.length === 0) return ''
      return `答案：${pairs.map((pair) => `${text(pair.left)} → ${text(pair.right)}`).join('；')}`
    }
    case 'ordering': {
      const itemText = new Map((payload.items ?? []).map((item) => [item.id, text(item.text)]))
      const ordered = (payload.correct_order_ids ?? []).map((id) => itemText.get(id) || text(id))
      if (ordered.length === 0) return ''
      return `答案：${ordered.join(' → ')}`
    }
    case 'categorization': {
      const items = payload.items ?? []
      if (items.length === 0) return ''
      const categoryName = new Map(
        (payload.categories ?? []).map((category) => [category.id, text(category.name)]),
      )
      return `答案：${items
        .map((item) => {
          const categoryId = text(item.category_id)
          return `${text(item.text)} → ${categoryName.get(categoryId) || categoryId}`
        })
        .join('；')}`
    }
    default: {
      const reference = text(payload.reference_answer)
      return reference ? `答案：${reference}` : ''
    }
  }
}

/** One numbered question block. Blank lines separate blocks in the full text. */
export function buildQuizQuestionCopyBlock(question: QuizCopyQuestion, index: number) {
  const lines = [`${index + 1}. ${text(question.stem) || '（无题干）'}`]
  for (const option of question.options ?? []) {
    const optionId = text(option.id)
    lines.push(`   ${optionId ? `${optionId}. ` : ''}${text(option.text)}`)
  }
  const answer = formatQuizQuestionCopyAnswer(question)
  for (const line of answer.split('\n')) {
    if (line.trim()) lines.push(`   ${line.trim()}`)
  }
  const analysis = text(question.analysis)
  if (analysis) {
    const [first, ...rest] = analysis.split('\n')
    lines.push(`   解析：${first.trim()}`)
    for (const line of rest) {
      if (line.trim()) lines.push(`   ${line.trim()}`)
    }
  }
  return lines.join('\n')
}

/** The clipboard payload for 复制题目. Empty when the window has no questions. */
export function buildQuizQuestionsCopyText(questions: readonly QuizCopyQuestion[]) {
  return questions
    .map((question, index) => buildQuizQuestionCopyBlock(question, index))
    .join('\n\n')
}
