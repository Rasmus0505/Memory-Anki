/** Time to think on a learning page. Anything beyond this is not study. */
export const STUDY_THINKING_GRACE_MS = 90 * 1000

/**
 * Kept as the grace alias so existing imports compile. It is no longer a
 * fixed five-minute subtraction: idle time past the grace is excluded entirely.
 */
export const CLICK_IDLE_LIMIT_MS = STUDY_THINKING_GRACE_MS

export interface ClickActivityInterval { startedAt: string; endedAt: string }

/** Append measured time, merging contiguous slices from ticker callbacks. */
export function appendClickInterval(intervals: ClickActivityInterval[], startMs: number, endMs: number): ClickActivityInterval[] {
  if (endMs <= startMs) return intervals
  const last = intervals.at(-1)
  if (last && Date.parse(last.endedAt) === startMs) {
    return [...intervals.slice(0, -1), { ...last, endedAt: new Date(endMs).toISOString() }]
  }
  return [...intervals, { startedAt: new Date(startMs).toISOString(), endedAt: new Date(endMs).toISOString() }]
}

/** Roll back measured time from the tail, without inventing absolute intervals. */
export function rollbackClickIntervals(intervals: ClickActivityInterval[], rollbackMs: number): ClickActivityInterval[] {
  const result = [...intervals]
  let remaining = Math.max(0, rollbackMs)
  while (remaining > 0 && result.length > 0) {
    const last = result.pop()!
    const start = Date.parse(last.startedAt)
    const end = Date.parse(last.endedAt)
    const duration = end - start
    if (duration > remaining) {
      result.push({ ...last, endedAt: new Date(end - remaining).toISOString() })
      remaining = 0
    } else {
      remaining -= duration
    }
  }
  return result
}

export function confirmedClickIntervals(intervals: ClickActivityInterval[], lastClickAtMs: number | null): ClickActivityInterval[] {
  if (lastClickAtMs == null) return []
  return intervals.flatMap((interval) => {
    const start = Date.parse(interval.startedAt)
    const end = Math.min(Date.parse(interval.endedAt), lastClickAtMs)
    return end > start ? [{ startedAt: interval.startedAt, endedAt: new Date(end).toISOString() }] : []
  })
}

export type ClickTimerStatus = 'idle' | 'running' | 'paused'

export interface ClickTimerTransitionInput {
  status: ClickTimerStatus
  effectiveMs: number
  lastClickAtMs: number | null
  currentMs: number
}

export interface ClickTimerTransition {
  status: ClickTimerStatus
  effectiveMs: number
  lastClickAtMs: number | null
  timedOut: boolean
}

/** Latest instant that still counts as thinking, never past the grace. */
export function countableUntilMs(lastClickAtMs: number, currentMs: number) {
  return Math.min(currentMs, lastClickAtMs + STUDY_THINKING_GRACE_MS)
}

export function thinkingGraceExceeded(lastClickAtMs: number | null, currentMs: number) {
  if (lastClickAtMs == null) return false
  return currentMs - lastClickAtMs > STUDY_THINKING_GRACE_MS
}

/**
 * A click on a learning page keeps or restarts timing.
 * Silence longer than the grace pauses and does not count the idle tail.
 * The grace itself still counts: that is the "pause to think" window.
 */
export function transitionClickTimer(input: ClickTimerTransitionInput): ClickTimerTransition {
  const currentMs = Number.isFinite(input.currentMs) ? input.currentMs : 0
  const effectiveMs = Math.max(0, input.effectiveMs)
  if (input.status !== 'running' || input.lastClickAtMs == null) {
    return { status: 'running', effectiveMs, lastClickAtMs: currentMs, timedOut: false }
  }

  if (thinkingGraceExceeded(input.lastClickAtMs, currentMs)) {
    return {
      status: 'paused',
      effectiveMs,
      lastClickAtMs: input.lastClickAtMs,
      timedOut: true,
    }
  }

  return { status: 'running', effectiveMs, lastClickAtMs: currentMs, timedOut: false }
}
