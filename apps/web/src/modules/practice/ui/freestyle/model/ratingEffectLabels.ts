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
  const targetStage = effect.target_interval_days === 0
    ? '首学阶段'
    : `${effect.target_interval_days}天级`
  // Drive the verb off stage_action, not the rating: 忘记 on a unit that already
  // passed now keeps part of its position, so it lands lower rather than resetting.
  const stage = effect.stage_action === 'reset'
    ? `重置到${targetStage}`
    : effect.stage_action === 'lower'
      ? `降至${targetStage}`
      : `保持${targetStage}`
  return `${retryPositionLabel(retryAfterCards)} · ${stage}`
}

/**
 * Second line of a rating button. Touch devices have no hover, so the schedule
 * consequence has to be readable before the tap — the full sentence is too long
 * for a quarter-width button, so this keeps only the timing.
 */
export function compactRatingEffectLabel(
  effect: UnitRatingEffectDto,
  retryAfterCards: number,
) {
  if (effect.passed && effect.schedule_changed === false) return '不改期'
  if (effect.passed) return `${passedGapDays(effect)}天后`
  const count = clampRetryGap(retryAfterCards)
  return count === 0 ? '立即重练' : `${count}张后`
}
