import type { QuizRuntimeState } from '@/modules/quiz/public'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'

export function formatQuizAnswerInfo(question: PalaceQuizQuestion, state?: QuizRuntimeState) {
  if (!state) return '   作答情况：未作答'
  const payload = question.answer_payload ?? {}
  let answer = ''
  if (state.shortAnswerText?.trim()) {
    answer = state.shortAnswerText.trim()
  } else if (state.selectedOptionIds?.length || state.selectedOptionId) {
    const ids = state.selectedOptionIds?.length ? state.selectedOptionIds : [state.selectedOptionId!]
    answer = ids.map((id) => {
      const option = question.options?.find((item) => item.id === id)
      return option ? `${id}. ${option.text}` : id
    }).join('；')
  } else if (typeof state.trueFalseAnswer === 'boolean') {
    answer = state.trueFalseAnswer ? '对' : '错'
  } else if (state.blankInputs && Object.keys(state.blankInputs).length) {
    answer = Object.entries(state.blankInputs).map(([id, value]) => `${id}：${value}`).join('；')
  } else if (state.matchingPairs && Object.keys(state.matchingPairs).length) {
    answer = Object.entries(state.matchingPairs).map(([left, right]) => {
      const pairs = payload.pairs ?? []
      return `${pairs.find((pair) => pair.left_id === left)?.left ?? left} → ${pairs.find((pair) => pair.right_id === right)?.right ?? right}`
    }).join('；')
  } else if (state.orderingIds?.length) {
    answer = state.orderingIds.map((id) => payload.items?.find((item) => item.id === id)?.text ?? id).join(' → ')
  } else if (state.categorizationAssignments && Object.keys(state.categorizationAssignments).length) {
    answer = Object.entries(state.categorizationAssignments).map(([id, category]) => (
      `${payload.items?.find((item) => item.id === id)?.text ?? id} → ${payload.categories?.find((item) => item.id === category)?.name ?? category}`
    )).join('；')
  }
  const status = state.skipped ? '已跳过' : state.resolved
    ? typeof state.correct === 'boolean' ? (state.correct ? '答对' : '答错') : '已作答'
    : answer ? '未提交' : '未作答'
  return [`   作答情况：${status}`, ...(answer ? [`   我的答案：${answer}`] : [])].join('\n')
}
