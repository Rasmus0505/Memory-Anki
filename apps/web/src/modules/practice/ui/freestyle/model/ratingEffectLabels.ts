import type { UnitRatingEffectDto } from '@/modules/practice/ui/review/api/unitReviewApi'

function localDateLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return `${month}月${day}日`
}

/**
 * Real booked gap, not the nominal ladder value: due dates carry a per-unit
 * spread, so "365天后复习" next to a 362-day date would misreport the booking.
 */
function passedGapDays(effect: UnitRatingEffectDto) {
  return effect.target_actual_interval_days ?? effect.target_interval_days
}

function retryGapLabel(minutes: number | null | undefined) {
  if (minutes == null || minutes <= 0) return null
  if (minutes >= 60) {
    const hours = Math.round((minutes / 60) * 10) / 10
    return `${hours} 小时后`
  }
  return `${Math.round(minutes)} 分钟后`
}

/**
 * The interval the card was booked at, as the first half of "7天 → 17天".
 * Null when the caller has no unit loaded; the label then keeps the old copy.
 */
function intervalBeforeLabel(currentIntervalDays: number | null | undefined) {
  if (currentIntervalDays == null || !Number.isFinite(currentIntervalDays)) return null
  const days = Math.max(0, Math.round(currentIntervalDays))
  return days === 0 ? '首学' : `${days}天`
}

/**
 * One branch order for every renderer, so the button face and the effect strip
 * can never describe two different bookings.
 */
type EffectTiming =
  | { kind: 'recorded'; dueDate: string }
  | { kind: 'step'; gap: string | null }
  | { kind: 'pass'; gapDays: number; dueDate: string }
  | { kind: 'exhausted' }
  | { kind: 'retry'; gap: string | null }

function effectTiming(effect: UnitRatingEffectDto): EffectTiming {
  if (effect.passed && effect.schedule_changed === false) {
    return { kind: 'recorded', dueDate: localDateLabel(effect.target_due_date) }
  }
  if (effect.passed) {
    if (effect.intraday_kind === 'step') {
      return { kind: 'step', gap: retryGapLabel(effect.retry_after_minutes) }
    }
    return {
      kind: 'pass',
      gapDays: passedGapDays(effect),
      dueDate: localDateLabel(effect.target_due_date),
    }
  }
  if (effect.intraday_exhausted) return { kind: 'exhausted' }
  return { kind: 'retry', gap: retryGapLabel(effect.retry_after_minutes) }
}

/** The consequence as one sentence: effect strip, aria-label and title. */
export function ratingEffectLabel(
  effect: UnitRatingEffectDto,
  currentIntervalDays?: number | null,
) {
  const timing = effectTiming(effect)
  const before = intervalBeforeLabel(currentIntervalDays)
  switch (timing.kind) {
    case 'recorded':
      return `记下，不改期 · ${timing.dueDate}`
    case 'step':
      return timing.gap ? `${timing.gap}回顾一次 · 今天` : '今天再回顾一次'
    case 'pass':
      return before
        ? `${before} → ${timing.gapDays}天 · ${timing.dueDate}`
        : `${timing.gapDays}天后复习 · ${timing.dueDate}`
    case 'exhausted':
      return '今天已重练 3 次 · 明天再练'
    case 'retry':
      if (before) {
        return timing.gap ? `${before} → 今天 · ${timing.gap}重练` : `${before} → 今天`
      }
      return timing.gap ? `${timing.gap}重练 · 今天` : '今天再练'
  }
}

export interface RatingEffectLines {
  /** What this tap does to the card: the action plus the size of the gap. */
  primary: string
  /** When it lands. Null when the payload books no date at all. */
  secondary: string | null
}

/**
 * The same consequence split into two short lines for a quarter-width key.
 *
 * A phone key is ~73px of text at 10px type, and "3天后复习 · 10月30日" is ~96px,
 * so the face stacks instead of truncating the date away. Only the face drops
 * 「一次」 from the 20-minute re-check; the strip and accessible name keep it.
 */
export function ratingEffectLines(
  effect: UnitRatingEffectDto,
  currentIntervalDays?: number | null,
): RatingEffectLines {
  const timing = effectTiming(effect)
  const before = intervalBeforeLabel(currentIntervalDays)
  switch (timing.kind) {
    case 'recorded':
      return { primary: '记下，不改期', secondary: timing.dueDate }
    case 'step':
      return timing.gap
        ? { primary: `${timing.gap}回顾`, secondary: '今天' }
        : { primary: '稍后回顾', secondary: null }
    case 'pass':
      return before
        ? { primary: `${before} → ${timing.gapDays}天`, secondary: timing.dueDate }
        : { primary: `${timing.gapDays}天后复习`, secondary: timing.dueDate }
    case 'exhausted':
      return { primary: '今天已重练 3 次', secondary: '明天再练' }
    case 'retry':
      if (before) {
        return timing.gap
          ? { primary: `${before} → 今天`, secondary: `${timing.gap}重练` }
          : { primary: `${before} → 今天`, secondary: null }
      }
      return timing.gap
        ? { primary: `${timing.gap}重练`, secondary: '今天' }
        : { primary: '今天再练', secondary: null }
  }
}
