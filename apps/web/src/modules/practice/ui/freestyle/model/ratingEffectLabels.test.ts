import { describe, expect, it } from 'vitest'
import type { UnitRatingEffectDto } from '@/modules/practice/ui/review/api/unitReviewApi'
import {
  compactRatingEffectLabel,
  ratingEffectLabel,
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

describe('ratingEffectLabel', () => {
  it('reports the real booked gap when a due date carries per-unit spread', () => {
    const spread = effect({
      target_stage_index: 9,
      target_interval_days: 365,
      target_actual_interval_days: 362,
      target_due_date: '2027-07-25',
      stage_action: 'keep',
    })
    expect(ratingEffectLabel(spread)).toBe('362天后复习 · 7月25日')
  })

  it('falls back to the nominal interval when a cached client lacks the spread field', () => {
    const legacy = effect({ target_actual_interval_days: undefined })
    expect(ratingEffectLabel(legacy)).toBe('1天后复习 · 7月28日')
  })

  it('never talks about ladder levels: a failed grade is same-day retry work', () => {
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
    // No booked minutes in the payload: say 今天再练, never promise a card offset.
    expect(ratingEffectLabel(lapsed)).toBe('今天再练')
    for (const action of ['reset', 'keep', 'lower'] as const) {
      expect(ratingEffectLabel({ ...lapsed, stage_action: action })).toBe('今天再练')
    }
  })

  it('shows the real same-day wait the server booked', () => {
    const lapsed = effect({
      rating: 1,
      label: '忘记',
      passed: false,
      retry_after_minutes: 10,
      intraday_kind: 'retry',
    })
    expect(ratingEffectLabel(lapsed)).toBe('10 分钟后重练 · 今天')
    expect(ratingEffectLabel({ ...lapsed, retry_after_minutes: 60 }))
      .toBe('1 小时后重练 · 今天')
  })

  it('books tomorrow once the day’s retries are used up', () => {
    const spent = effect({ rating: 2, passed: false, intraday_exhausted: true })
    expect(ratingEffectLabel(spent)).toBe('今天已重练 3 次 · 明天再练')
  })
})

describe('compactRatingEffectLabel', () => {
  it('keeps only the timing so it fits a quarter-width button', () => {
    expect(compactRatingEffectLabel(effect())).toBe('1天后')
    expect(compactRatingEffectLabel(
      effect({ target_interval_days: 365, target_actual_interval_days: 362 }),
    )).toBe('362天后')
  })

  it('says a locked fill pass will not move the due date', () => {
    const locked = effect({ schedule_changed: false, target_due_date: '2026-09-01' })
    expect(ratingEffectLabel(locked)).toBe('记下，不改期 · 9月1日')
    expect(compactRatingEffectLabel(locked)).toBe('不改期')
  })

  it('shows the wait for failing ratings, not a card position', () => {
    const failing = effect({ passed: false, retry_after_minutes: 10 })
    expect(compactRatingEffectLabel(failing)).toBe('10 分钟后')
    expect(compactRatingEffectLabel(effect({ passed: false }))).toBe('稍后')
  })
})
