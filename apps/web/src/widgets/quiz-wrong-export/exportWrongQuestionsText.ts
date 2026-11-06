import { buildQuizQuestionCopyBlock } from '@/modules/quiz/public'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'

/**
 * 导出错题 puts this round's wrong questions on the clipboard, optionally with
 * the full palace behind them. The shape mirrors 复制题目 — numbered stem,
 * options, answer, 解析 — so both copy actions read the same way when pasted
 * into notes or an AI chat.
 */
export interface PalaceExportSection {
  palaceId: number
  title: string
  /** Plain-text mind map outline; empty when the palace has no document. */
  outline: string
  /** Every question in the palace bank, not only the round's wrong ones. */
  questions: readonly PalaceQuizQuestion[]
}

const SECTION_SEPARATOR = '\n\n────────\n\n'

function palaceTitle(section: PalaceExportSection) {
  return section.title.trim() || `宫殿 ${section.palaceId}`
}

function markWrongBlock(question: PalaceQuizQuestion, index: number, wrongIds: ReadonlySet<number>) {
  const block = buildQuizQuestionCopyBlock(question, index)
  if (!wrongIds.has(question.id)) return block
  const [firstLine, ...rest] = block.split('\n')
  return [`${firstLine}（本轮答错）`, ...rest].join('\n')
}

export function buildWrongQuestionsText(wrongQuestions: readonly PalaceQuizQuestion[]) {
  return [
    `本轮错题（${wrongQuestions.length} 道）`,
    ...wrongQuestions.map((question, index) => buildQuizQuestionCopyBlock(question, index)),
  ].join('\n\n')
}

export function buildWrongQuestionsWithPalacesText({
  wrongQuestions,
  palaces,
}: {
  wrongQuestions: readonly PalaceQuizQuestion[]
  palaces: readonly PalaceExportSection[]
}) {
  const wrongIds = new Set(wrongQuestions.map((question) => question.id))
  const sections = [buildWrongQuestionsText(wrongQuestions)]

  for (const palace of palaces) {
    const lines = [`宫殿：${palaceTitle(palace)}`]
    const outline = palace.outline.trim()
    if (outline) lines.push('', '脑图', outline)
    if (palace.questions.length > 0) {
      lines.push('', `全部题目（${palace.questions.length} 道）`)
      for (const [index, question] of palace.questions.entries()) {
        lines.push('', markWrongBlock(question, index, wrongIds))
      }
    }
    sections.push(lines.join('\n'))
  }

  return sections.join(SECTION_SEPARATOR)
}
