import { describe, expect, it } from 'vitest'
import { canCompleteRound, clampTrainingIndex } from './trainingRound'

const cards = [
  { id: 'question-1', quizQuestionId: 1 },
  { id: 'question-2', quizQuestionId: 2 },
]

describe('training round domain', () => {
  it('never completes while any quiz question is unresolved', () => {
    expect(canCompleteRound(cards, { currentIndex: 99, resolvedQuestionIds: new Set([1]) })).toBe(false)
  })

  it('prevents momentum scrolling from moving beyond the last unresolved card', () => {
    expect(clampTrainingIndex(cards, { currentIndex: 99, resolvedQuestionIds: new Set() })).toBe(1)
  })
})
