/**
 * Display helpers for FSRS intervals.
 *
 * FSRS schedules each unit at its own real interval, so the UI must never claim
 * a "level" or a nominal "N天级". Units are still grouped into the same ten
 * buckets the backend reports (`interval_days` per bucket), but every label is a
 * day range and every current-unit label is the unit's own booked gap.
 */

/** Bucket lower bounds, mirrored from the backend's legacy compatibility table. */
export const INTERVAL_BAND_BOUNDS = [0, 1, 3, 7, 14, 30, 60, 120, 240, 365] as const

function validBounds(bounds: readonly number[]) {
  return bounds.length >= 2
}

/** "首学" / "1–2天" / "3–6天" / ... / "365天以上" for one bucket. */
export function intervalBandLabel(
  index: number,
  bounds: readonly number[] = INTERVAL_BAND_BOUNDS,
): string {
  if (!validBounds(bounds)) return ''
  const safeIndex = Math.max(0, Math.min(bounds.length - 1, Math.round(index)))
  if (safeIndex === 0) return '首学'
  const lower = bounds[safeIndex]
  if (safeIndex === bounds.length - 1) return `${lower}天以上`
  const upper = bounds[safeIndex + 1] - 1
  return upper > lower ? `${lower}–${upper}天` : `${lower}天`
}

/** The unit's own interval, e.g. "约 43 天后"; a never-passed unit is 首学. */
export function intervalOutlookLabel(days: number | null | undefined): string {
  if (days == null || days <= 0) return '首学'
  if (days === 1) return '明天'
  return `约 ${Math.round(days)} 天后`
}

/** Exact booked gap for compact badges: "43天" / "今天". */
export function intervalDaysLabel(days: number | null | undefined): string {
  if (days == null || days <= 0) return '今天'
  return `${Math.round(days)}天`
}

/**
 * The toolbar badge. A bare "2天" reads like a level, so it names what the
 * number is; a zero gap is the product booking "due today", not first learning.
 */
export function intervalBadgeLabel(days: number | null | undefined): string {
  if (days == null || days <= 0) return '今天到期'
  return `间隔 ${Math.round(days)}天`
}
