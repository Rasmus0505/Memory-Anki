import { beforeEach, describe, expect, it } from 'vitest'
import { clearQuizSessionProgress } from '@/modules/quiz/public'
import type { FreestyleOverlayQuizState } from '@/shared/api/contracts'
import {
  mergeOverlayAndSessionStates,
  resolveOverlayResumeIndex,
  statesFromOverlay,
} from './overlayQuizHydrate'

function overlay(partial: Partial<FreestyleOverlayQuizState>): FreestyleOverlayQuizState {
  return {
    scope_signature: 'sig',
    quiz_scope: 'cross_palace_random',
    seed: 1,
    question_ids: [11, 12, 13],
    current_index: 2,
    completed_ids: [11, 12],
    states: {
      11: { resolved: true, selectedOptionId: 'A' },
      12: { resolved: true, shortAnswerText: 'hello' },
    },
    limit_reached: false,
    candidate_count: 3,
    question_palace_ids: { 11: 7, 12: 7, 13: 7 },
    ...partial,
  }
}

describe('overlayQuizHydrate', () => {
  beforeEach(() => {
    clearQuizSessionProgress()
  })

  it('restores runtime states from overlay_quiz after an empty session', () => {
    const next = overlay({})
    const merged = mergeOverlayAndSessionStates(next)
    expect(merged[11]?.selectedOptionId).toBe('A')
    expect(merged[12]?.shortAnswerText).toBe('hello')
    expect(resolveOverlayResumeIndex(next, merged)).toBe(2)
    expect(Object.keys(statesFromOverlay(next))).toEqual(['11', '12'])
  })
})
