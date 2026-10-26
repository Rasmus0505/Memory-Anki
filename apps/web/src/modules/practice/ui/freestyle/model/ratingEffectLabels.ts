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
 * The second line of a rating button. Same-day work is booked by wall clock
 * (10 分钟 → 1 小时 → 3 小时 for 忘记/困难), never by a card offset, so when the
 * payload carries no gap the copy stays honest ("今天再练") instead of promising
 * a position in the queue.
 */
export function ratingEffectLabel(effect: UnitRatingEffectDto) {
  if (effect.passed && effect.schedule_changed === false) {
    return `记下，不改期 · ${localDateLabel(effect.target_due_date)}`
  }
  if (effect.passed) {
    if (effect.intraday_kind === 'step') {
      const gap = retryGapLabel(effect.retry_after_minutes)
      return gap ? `${gap}回顾一次 · 今天` : '今天再回顾一次'
    }
    return `${passedGapDays(effect)}天后复习 · ${localDateLabel(effect.target_due_date)}`
  }
  if (effect.intraday_exhausted) {
    return '今天已重练 3 次 · 明天再练'
  }
  const gap = retryGapLabel(effect.retry_after_minutes)
  return gap ? `${gap}重练 · 今天` : '今天再练'
}

/** Floating "where it went" tag shown for a moment after a rating lands. */
export function ratingDestinationLabel(effect: UnitRatingEffectDto) {
  if (effect.passed && effect.schedule_changed === false) return '已记下'
  if (effect.passed) {
    if (effect.intraday_kind === 'step') {
      const gap = retryGapLabel(effect.retry_after_minutes)
      return gap ? `${gap}回顾` : '稍后回顾'
    }
    return `${passedGapDays(effect)}天后见`
  }
  if (effect.intraday_exhausted) return '明天见'
  const gap = retryGapLabel(effect.retry_after_minutes)
  return gap ? `${gap}见` : '稍后见'
}

export function compactRatingEffectLabel(effect: UnitRatingEffectDto) {
  if (effect.passed && effect.schedule_changed === false) return '不改期'
  if (effect.passed) {
    if (effect.intraday_kind === 'step') {
      const gap = retryGapLabel(effect.retry_after_minutes)
      return gap ? gap.replace(' 后', '') : '回顾'
    }
    return `${passedGapDays(effect)}天后`
  }
  if (effect.intraday_exhausted) return '明天'
  const gap = retryGapLabel(effect.retry_after_minutes)
  return gap ? gap.replace(' 后', '') : '稍后'
}
