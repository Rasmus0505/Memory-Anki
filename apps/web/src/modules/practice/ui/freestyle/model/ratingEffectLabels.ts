import type { UnitRatingEffectDto } from '@/modules/practice/ui/review/api/unitReviewApi'

function localDateLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return `${month}月${day}日`
}

function clampRetryGap(cardCount: number) {
  return Math.max(0, Math.min(3, Math.round(cardCount)))
}

export function retryPositionLabel(cardCount: number) {
  const count = clampRetryGap(cardCount)
  return count === 0 ? '立即重练' : `${count}张后重练`
}

/**
 * Real booked gap, not the nominal ladder value: due dates carry a per-unit
 * spread, so "365天后复习" next to a 362-day date would misreport the booking.
 */
function passedGapDays(effect: UnitRatingEffectDto) {
  return effect.target_actual_interval_days ?? effect.target_interval_days
}

export function ratingEffectLabel(effect: UnitRatingEffectDto, retryAfterCards: number) {
  if (effect.passed && effect.schedule_changed === false) {
    return `记下，不改期 · ${localDateLabel(effect.target_due_date)}`
  }
  if (effect.passed) {
    return `${passedGapDays(effect)}天后复习 · ${localDateLabel(effect.target_due_date)}`
  }
  // FSRS has no ladder position to reset or demote; a failed grade is simply
  // retry work scheduled for the same study day.
  return `${retryPositionLabel(retryAfterCards)} · 今天再练`
}

/**
 * Second line of a rating button. Touch devices have no hover, so the schedule
 * consequence has to be readable before the tap — the full sentence is too long
 * for a quarter-width button, so this keeps only the timing.
 */
/** Floating "where it went" tag shown for a moment after a rating lands. */
export function ratingDestinationLabel(effect: UnitRatingEffectDto, retryAfterCards: number) {
  if (effect.passed && effect.schedule_changed === false) return '已记下'
  if (effect.passed) return `${passedGapDays(effect)}天后见`
  const count = clampRetryGap(retryAfterCards)
  return count === 0 ? '马上再来' : `${count}张后再见`
}

export function compactRatingEffectLabel(
  effect: UnitRatingEffectDto,
  retryAfterCards: number,
) {
  if (effect.passed && effect.schedule_changed === false) return '不改期'
  if (effect.passed) return `${passedGapDays(effect)}天后`
  const count = clampRetryGap(retryAfterCards)
  return count === 0 ? '立即重练' : `${count}张后`
}
