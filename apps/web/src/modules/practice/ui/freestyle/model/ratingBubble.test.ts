import { describe, expect, it } from 'vitest'
import type { UnitRating, UnitRatingEffectDto } from '@/modules/practice/ui/review/api/unitReviewApi'
import { ratingBubbleCopy } from './ratingBubble'

function effect(
  rating: UnitRating,
  overrides: Partial<UnitRatingEffectDto> = {},
): UnitRatingEffectDto {
  return {
    rating,
    label: '记得',
    passed: true,
    target_stage_index: 1,
    target_interval_days: 11,
    target_actual_interval_days: 11,
    target_due_date: '2026-11-11',
    retry_after_cards: 0,
    stage_action: 'advance',
    schedule_changed: true,
    ...overrides,
  }
}

function text(copy: ReturnType<typeof ratingBubbleCopy>) {
  return copy.parts.map((part) => part.text).join('')
}

describe('ratingBubbleCopy', () => {
  it('shows the old interval, the new one and the gain for 记得', () => {
    const copy = ratingBubbleCopy({
      rating: 3,
      durationMs: 1600,
      effect: effect(3),
      currentIntervalDays: 4,
    })

    expect(copy.tone).toBe('good')
    expect(copy.icon).toBe('🛡️')
    expect(text(copy)).toBe('1.6s · 间隔 4d → 11d (+7d)')
  })

  it('shows a shortened interval for 困难 without a plus delta', () => {
    const copy = ratingBubbleCopy({
      rating: 2,
      durationMs: 5400,
      effect: effect(2, { target_interval_days: 3, target_actual_interval_days: 3 }),
      currentIntervalDays: 4,
    })

    expect(copy.tone).toBe('warn')
    expect(text(copy)).toBe('5.4s · 间隔 4d → 3d')
  })

  it('shows the straight push for 轻松', () => {
    const copy = ratingBubbleCopy({
      rating: 4,
      durationMs: 900,
      effect: effect(4, { target_interval_days: 28, target_actual_interval_days: 28 }),
      currentIntervalDays: 4,
    })

    expect(copy.tone).toBe('fast')
    expect(text(copy)).toBe('0.9s · 直推 28d 后')
  })

  it('keeps a same-day retry honest about the wait', () => {
    const copy = ratingBubbleCopy({
      rating: 1,
      durationMs: 2100,
      effect: effect(1, {
        passed: false,
        target_interval_days: 0,
        target_actual_interval_days: 0,
        retry_after_minutes: 10,
        intraday_kind: 'retry',
        stage_action: 'reset',
      }),
    })

    expect(copy.tone).toBe('error')
    expect(text(copy)).toBe('2.1s · 10 分钟后重练')
  })

  it('says the day is exhausted instead of promising another same-day try', () => {
    const copy = ratingBubbleCopy({
      rating: 1,
      durationMs: 2100,
      effect: effect(1, {
        passed: false,
        target_interval_days: 0,
        target_actual_interval_days: 0,
        intraday_exhausted: true,
        stage_action: 'reset',
      }),
    })

    expect(text(copy)).toBe('2.1s · 今日已重练 3 次 · 明天再练')
  })

  it('shows the 20-minute re-check as a step, not a failed grade', () => {
    const copy = ratingBubbleCopy({
      rating: 3,
      durationMs: 1600,
      effect: effect(3, {
        retry_after_minutes: 20,
        intraday_kind: 'step',
      }),
      currentIntervalDays: 4,
    })

    expect(copy.tone).toBe('good')
    expect(text(copy)).toBe('1.6s · 20 分钟后回顾 · 今天')
  })

  it('never promises a schedule move when the pass was recorded only', () => {
    const copy = ratingBubbleCopy({
      rating: 3,
      durationMs: 1600,
      effect: effect(3, { schedule_changed: false }),
      currentIntervalDays: 4,
    })

    expect(text(copy)).toBe('1.6s · 记下，不改期')
  })

  it('marks bedtime as recorded-only, with a calm tone', () => {
    const copy = ratingBubbleCopy({
      rating: 4,
      durationMs: 2100,
      bedtime: true,
    })

    expect(copy.tone).toBe('neutral')
    expect(copy.icon).toBe('🌙')
    expect(text(copy)).toBe('2.1s · 只记录，不改期')
  })

  it('still shows something while the plan is still loading', () => {
    const copy = ratingBubbleCopy({
      rating: 3,
      durationMs: null,
      effect: null,
      currentIntervalDays: 4,
    })

    expect(text(copy)).toBe(' · 已记录')
  })
})
