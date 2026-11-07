import { describe, expect, it } from 'vitest'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import { formatQuizAnswerInfo } from './quizAnswerCopyText'

const question = {
  options: [{ id: 'A', text: '甲' }, { id: 'B', text: '乙' }],
  answer_payload: {
    pairs: [{ left_id: 'l', left: '左', right_id: 'r', right: '右' }],
    items: [{ id: 'i', text: '条目' }],
    categories: [{ id: 'c', name: '类别' }],
  },
} as unknown as PalaceQuizQuestion

describe('复制答题信息', () => {
  it('展示单选、多选、对错以及未提交状态', () => {
    expect(formatQuizAnswerInfo(question, { resolved: true, correct: false, selectedOptionId: 'B' })).toContain('答错\n   我的答案：B. 乙')
    expect(formatQuizAnswerInfo(question, { resolved: true, correct: true, selectedOptionIds: ['A', 'B'] })).toContain('A. 甲；B. 乙')
    expect(formatQuizAnswerInfo(question, { trueFalseAnswer: false })).toContain('未提交\n   我的答案：错')
    expect(formatQuizAnswerInfo(question)).toContain('未作答')
  })
  it('展示其他题型的实际作答', () => {
    expect(formatQuizAnswerInfo(question, { shortAnswerText: '我的解释' })).toContain('我的解释')
    expect(formatQuizAnswerInfo(question, { blankInputs: { '1': '填空' } })).toContain('1：填空')
    expect(formatQuizAnswerInfo(question, { matchingPairs: { l: 'r' } })).toContain('左 → 右')
    expect(formatQuizAnswerInfo(question, { orderingIds: ['i'] })).toContain('条目')
    expect(formatQuizAnswerInfo(question, { categorizationAssignments: { i: 'c' } })).toContain('条目 → 类别')
  })
})
