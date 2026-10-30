import { describe, expect, it } from 'vitest'
import type { UnitRatingEffectDto } from '@/modules/practice/ui/review/api/unitReviewApi'
import { ratingEffectLabel, ratingEffectLines } from './ratingEffectLabels'

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

describe('ratingEffectLines', () => {
  it('splits the consequence into the action and the date it books', () => {
    expect(ratingEffectLines(effect())).toEqual({ primary: '1天后复习', secondary: '7月28日' })
    expect(ratingEffectLines(
      effect({
        target_interval_days: 365,
        target_actual_interval_days: 362,
        target_due_date: '2027-07-25',
      }),
    )).toEqual({ primary: '362天后复习', secondary: '7月25日' })
  })

  it('says a locked fill pass will not move the due date', () => {
    const locked = effect({ schedule_changed: false, target_due_date: '2026-09-01' })
    expect(ratingEffectLabel(locked)).toBe('记下，不改期 · 9月1日')
    expect(ratingEffectLines(locked)).toEqual({ primary: '记下，不改期', secondary: '9月1日' })
  })

  it('shows the wait for failing ratings, not a card position', () => {
    const failing = effect({ passed: false, retry_after_minutes: 10 })
    expect(ratingEffectLines(failing)).toEqual({ primary: '10 分钟后重练', secondary: '今天' })
    expect(ratingEffectLines(effect({ passed: false })))
      .toEqual({ primary: '今天再练', secondary: null })
  })

  it('drops 一次 from the 20-minute re-check line so it fits the key', () => {
    const step = effect({ intraday_kind: 'step', retry_after_minutes: 20 })
    expect(ratingEffectLines(step)).toEqual({ primary: '20 分钟后回顾', secondary: '今天' })
    // The full sentence keeps the word: the strip and the accessible name need it.
    expect(ratingEffectLabel(step)).toBe('20 分钟后回顾一次 · 今天')
  })

  it('never loses a part: the two lines still spell out the same sentence', () => {
    const cases = [
      effect(),
      effect({ schedule_changed: false, target_due_date: '2026-09-01' }),
      effect({ passed: false, retry_after_minutes: 10 }),
      effect({ rating: 2, passed: false, intraday_exhausted: true }),
    ]
    for (const item of cases) {
      const { primary, secondary } = ratingEffectLines(item)
      expect(`${primary} · ${secondary}`).toBe(ratingEffectLabel(item))
    }
  })

  it('books tomorrow once the day’s retries are used up', () => {
    const spent = effect({ rating: 2, passed: false, intraday_exhausted: true })
    expect(ratingEffectLines(spent)).toEqual({ primary: '今天已重练 3 次', secondary: '明天再练' })
  })
})

describe('interval change (current → next)', () => {
  it('shows the memory level moving from the booked gap to the new one', () => {
    const pass = effect({ target_actual_interval_days: 17, target_due_date: '2026-11-23' })
    expect(ratingEffectLabel(pass, 7)).toBe('7天 → 17天 · 11月23日')
    expect(ratingEffectLines(pass, 7)).toEqual({ primary: '7天 → 17天', secondary: '11月23日' })
  })

  it('names a never-passed unit 首学 instead of 0天', () => {
    const first = effect({ target_actual_interval_days: 3, target_due_date: '2026-11-02' })
    expect(ratingEffectLabel(first, 0)).toBe('首学 → 3天 · 11月2日')
    expect(ratingEffectLines(first, 0).primary).toBe('首学 → 3天')
  })

  it('keeps the wait for 忘记 while showing the level drop', () => {
    const lapsed = effect({
      rating: 1,
      label: '忘记',
      passed: false,
      retry_after_minutes: 10,
      intraday_kind: 'retry',
    })
    expect(ratingEffectLabel(lapsed, 7)).toBe('7天 → 今天 · 10 分钟后重练')
    expect(ratingEffectLines(lapsed, 7)).toEqual({
      primary: '7天 → 今天',
      secondary: '10 分钟后重练',
    })
  })

  it('leaves a same-day re-check and a locked pass without an interval arrow', () => {
    const step = effect({ intraday_kind: 'step', retry_after_minutes: 20 })
    expect(ratingEffectLines(step, 7)).toEqual({ primary: '20 分钟后回顾', secondary: '今天' })
    const locked = effect({ schedule_changed: false, target_due_date: '2026-09-01' })
    expect(ratingEffectLines(locked, 7)).toEqual({ primary: '记下，不改期', secondary: '9月1日' })
  })

  it('keeps two lines equal to the one-sentence label', () => {
    const cases: Array<[UnitRatingEffectDto, number]> = [
      [effect({ target_actual_interval_days: 17 }), 7],
      [effect({ rating: 1, passed: false, retry_after_minutes: 10 }), 7],
      [effect({ target_actual_interval_days: 3 }), 0],
    ]
    for (const [item, before] of cases) {
      const { primary, secondary } = ratingEffectLines(item, before)
      const label = ratingEffectLabel(item, before)
      expect(secondary ? `${primary} · ${secondary}` : primary).toBe(label)
    }
  })
})
