import type { UnitRating, UnitRatingEffectDto } from '@/modules/practice/ui/review/api/unitReviewApi'
import type { MicroBubblePart, MicroBubbleTone } from '@/shared/fx'

export interface RatingBubbleInput {
  rating: UnitRating
  durationMs: number | null
  effect?: UnitRatingEffectDto | null
  /** The unit's booked gap before this rating. */
  currentIntervalDays?: number | null
  palaceMode?: boolean
  palaceDueCount?: number
  /** 睡前复习: the grade is recorded only, never rescheduled. */
  bedtime?: boolean
  /** Yellow hint card: the button advances, it does not book a date. */
  hintMode?: boolean
}

export interface RatingBubbleCopy {
  tone: MicroBubbleTone
  icon: string
  parts: MicroBubblePart[]
}

const TONE: Record<UnitRating, MicroBubbleTone> = {
  1: 'error',
  2: 'warn',
  3: 'good',
  4: 'fast',
}

const ICON: Record<UnitRating, string> = {
  1: '↺',
  2: '🔨',
  3: '🛡️',
  4: '🚀',
}

function timePart(durationMs: number | null): MicroBubblePart | null {
  if (durationMs == null || !Number.isFinite(durationMs)) return null
  return {
    text: `${(Math.max(0, Math.round(durationMs)) / 1000).toFixed(1)}s`,
    strong: true,
  }
}

function gapLabel(minutes: number | null | undefined) {
  if (minutes == null || minutes <= 0) return null
  if (minutes >= 60) {
    const hours = Math.round((minutes / 60) * 10) / 10
    return `${hours} 小时`
  }
  return `${Math.round(minutes)} 分钟`
}

function retryParts(
  effect: UnitRatingEffectDto,
  parts: MicroBubblePart[],
) {
  if (effect.intraday_exhausted) {
    parts.push({ text: ' · 今日已重练 3 次', muted: true })
    parts.push({ text: ' · 明天再练', muted: true })
    return
  }
  const gap = gapLabel(effect.retry_after_minutes)
  if (effect.intraday_kind === 'step') {
    parts.push({ text: gap ? ` · ${gap}后回顾` : ' · 稍后回顾', muted: true })
    parts.push({ text: ' · 今天', muted: true })
    return
  }
  parts.push({ text: gap ? ` · ${gap}后重练` : ' · 今日重练', muted: true })
}

function passedParts(
  effect: UnitRatingEffectDto,
  rating: UnitRating,
  currentIntervalDays: number | null | undefined,
  parts: MicroBubblePart[],
) {
  if (effect.schedule_changed === false) {
    parts.push({ text: ' · 记下，不改期', muted: true })
    return
  }

  const gap = gapLabel(effect.retry_after_minutes)
  if (effect.intraday_kind === 'step') {
    parts.push({ text: gap ? ` · ${gap}后回顾` : ' · 稍后回顾', muted: true })
    parts.push({ text: ' · 今天', muted: true })
    return
  }

  const after = effect.target_actual_interval_days ?? effect.target_interval_days
  if (!Number.isFinite(after) || after <= 0) {
    parts.push({ text: ' · 已记录', muted: true })
    return
  }

  const before =
    currentIntervalDays != null && Number.isFinite(currentIntervalDays) && currentIntervalDays > 0
      ? Math.round(currentIntervalDays)
      : null

  if (rating === 4) {
    parts.push({ text: ' · 直推 ', muted: true })
    parts.push({ text: `${Math.round(after)}d`, strong: true })
    parts.push({ text: ' 后', muted: true })
    return
  }

  if (before == null) {
    parts.push({ text: ` · ${Math.round(after)}天后复习`, muted: true })
    return
  }

  parts.push({ text: ' · 间隔 ', muted: true })
  parts.push({ text: `${before}d`, strong: true })
  parts.push({ text: ' → ', muted: true })
  parts.push({ text: `${Math.round(after)}d`, strong: true })
  if (rating === 3 && after > before) {
    parts.push({ text: ` (+${Math.round(after - before)}d)`, muted: true })
  }
}

/**
 * Pure copy for the pill that confirms a review grade. The interval comes from
 * the encounter's real rating effect, never from a client-side estimate; when
 * the plan has not arrived yet the pill says so instead of inventing a date.
 */
export function ratingBubbleCopy(input: RatingBubbleInput): RatingBubbleCopy {
  const { rating, durationMs, effect, currentIntervalDays } = input
  const tone = input.bedtime ? 'neutral' : TONE[rating]
  const icon = input.bedtime ? '🌙' : ICON[rating]
  const parts: MicroBubblePart[] = []
  const time = timePart(durationMs)
  if (time) parts.push(time)

  if (input.bedtime) {
    parts.push({ text: ' · 只记录，不改期', muted: true })
    return { tone, icon, parts }
  }

  if (input.hintMode) {
    parts.push({ text: ' · 继续', muted: true })
    return { tone, icon, parts }
  }

  if (input.palaceMode) {
    const due = Math.max(1, Math.round(input.palaceDueCount ?? 1))
    parts.push({ text: ` · 整座宫殿 · 今日 ${due} 张`, muted: true })
    return { tone, icon, parts }
  }

  if (!effect) {
    parts.push({ text: ' · 已记录', muted: true })
    return { tone, icon, parts }
  }

  if (!effect.passed) {
    retryParts(effect, parts)
    return { tone, icon, parts }
  }

  passedParts(effect, rating, currentIntervalDays, parts)
  return { tone, icon, parts }
}
