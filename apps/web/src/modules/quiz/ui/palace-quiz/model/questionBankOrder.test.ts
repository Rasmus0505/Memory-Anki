import { describe, expect, it } from 'vitest'
import { sortQuestionsForBankDisplay } from './questionBankOrder'

describe('sortQuestionsForBankDisplay', () => {
  it('puts multiple-choice questions before short-answer questions', () => {
    const ordered = sortQuestionsForBankDisplay([
      { id: 1, question_type: 'short_answer', sort_order: 0 },
      { id: 2, question_type: 'multiple_choice', sort_order: 10 },
      { id: 3, question_type: 'short_answer', sort_order: 1 },
      { id: 4, question_type: 'multiple_choice', sort_order: 2 },
    ])

    expect(ordered.map((item) => item.id)).toEqual([4, 2, 1, 3])
  })
})
