import { describe, expect, it } from 'vitest'
import type { FreestyleCard, FreestyleOverlayQuizState } from '@/shared/api/contracts'
import {
  overlayClearConfirmLabel,
  overlayPalacesNeedingClearConfirm,
  overlayProgressedQuestionIds,
} from './overlayQuizClearance'

function overlay(partial: Partial<FreestyleOverlayQuizState>): FreestyleOverlayQuizState {
  return {
    scope_signature: 'sig',
    quiz_scope: 'cross_palace_random',
    seed: 1,
    question_ids: [],
    current_index: 0,
    completed_ids: [],
    states: {},
    limit_reached: false,
    candidate_count: 0,
    question_palace_ids: {},
    ...partial,
  }
}

describe('overlayQuizClearance', () => {
  it('collects resolved and rated question ids from visible and parked buckets', () => {
    const ids = overlayProgressedQuestionIds(overlay({
      completed_ids: [1],
      states: {
        2: { resolved: true },
        3: { rating: 3 },
        4: { selectedOptionId: 'A' },
      },
      parked: {
        question_ids: [5],
        completed_ids: [5],
        states: { 6: { resolved: true } },
      },
    }))
    expect([...ids].sort((a, b) => a - b)).toEqual([1, 2, 3, 5, 6])
  })

  it('only prompts for cleared palaces that still hold answered progress', () => {
    const state = overlay({
      completed_ids: [101],
      states: { 101: { resolved: true }, 201: { selectedOptionId: 'A' } },
      question_palace_ids: { 101: 10, 201: 20, 301: 30 },
    })
    expect(overlayPalacesNeedingClearConfirm(state, [10, 20, 30])).toEqual([10])
    expect(overlayPalacesNeedingClearConfirm(state, [10], new Set([10]))).toEqual([])
  })

  it('builds a short confirm label from card palace titles', () => {
    const cards = [
      {
        type: 'mindmap_branch',
        id: 'a',
        palace_id: 10,
        palace_title: '19世纪',
        unit_id: 'u1',
      },
    ] as FreestyleCard[]
    expect(overlayClearConfirmLabel([10], cards)).toContain('《19世纪》')
    expect(overlayClearConfirmLabel([10], cards)).toContain('是否清除该宫殿')
  })
})
