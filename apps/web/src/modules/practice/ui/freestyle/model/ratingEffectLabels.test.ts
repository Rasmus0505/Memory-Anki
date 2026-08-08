import { describe, expect, it } from 'vitest'
import type { UnitRatingEffectDto } from '@/modules/practice/ui/review/api/unitReviewApi'
import {
  compactRatingEffectLabel,
  ratingEffectLabel,
  retryPositionLabel,
} from './ratingEffectLabels'

function effect(overrides: Partial<UnitRatingEffectDto> = {}): UnitRatingEffectDto {
  return {
    rating: 3,
    label: '记得',
    passed: true,
    target_stage_index: 1,
    target_interval_days: 1,
    target_actual_interval_days: 1,
    target_due_date: '2026-07-28',
    retry_after_cards: 0,
    stage_action: 'advance',
    ...overrides,
  }
}

describe('retryPositionLabel', () => {
  it('names every reachable retry gap', () => {
    expect(retryPositionLabel(0)).toBe('立即重练')
    expect(retryPositionLabel(1)).toBe('1张后重练')
    expect(retryPositionLabel(3)).toBe('3张后重练')
  })

  it('clamps out-of-range gaps to the queue window', () => {
    expect(retryPositionLabel(-2)).toBe('立即重练')
    expect(retryPositionLabel(9)).toBe('3张后重练')
  })
})

describe('ratingEffectLabel', () => {
  it('reports the real booked gap when a due date carries per-unit spread', () => {
    const spread = effect({
      target_stage_index: 9,
      target_interval_days: 365,
      target_actual_interval_days: 362,
      target_due_date: '2027-07-25',
      stage_action: 'keep',
    })
    expect(ratingEffectLabel(spread, 0)).toBe('362天后复习 · 7月25日')
  })

  it('falls back to the nominal interval when a cached client lacks the spread field', () => {
    const legacy = effect({ target_actual_interval_days: undefined })
    expect(ratingEffectLabel(legacy, 0)).toBe('1天后复习 · 7月28日')
  })

  it('drives the verb off stage_action so a lapsed mature unit drops instead of resetting', () => {
    const lapsed = effect({
      rating: 1,
      label: '忘记',
      passed: false,
      target_stage_index: 4,
      target_interval_days: 14,
      target_actual_interval_days: 0,
      target_due_date: '2026-07-27',
      retry_after_cards: 3,
      stage_action: 'lower',
    })
    expect(ratingEffectLabel(lapsed, 3)).toBe('3张后重练 · 降至14天级')
    expect(ratingEffectLabel({ ...lapsed, stage_action: 'reset', target_interval_days: 0 }, 2))
      .toBe('2张后重练 · 重置到首学阶段')
    expect(ratingEffectLabel({ ...lapsed, stage_action: 'keep', target_interval_days: 0 }, 3))
      .toBe('3张后重练 · 保持首学阶段')
  })
})

describe('compactRatingEffectLabel', () => {
  it('keeps only the timing so it fits a quarter-width button', () => {
    expect(compactRatingEffectLabel(effect(), 0)).toBe('1天后')
    expect(compactRatingEffectLabel(
      effect({ target_interval_days: 365, target_actual_interval_days: 362 }),
      0,
    )).toBe('362天后')
  })

  it('shows the retry position for failing ratings', () => {
    const failing = effect({ passed: false, retry_after_cards: 3 })
    expect(compactRatingEffectLabel(failing, 3)).toBe('3张后')
    expect(compactRatingEffectLabel(failing, 0)).toBe('立即重练')
  })
})
