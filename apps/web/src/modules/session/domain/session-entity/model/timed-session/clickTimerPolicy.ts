export const CLICK_IDLE_LIMIT_MS = 5 * 60 * 1000

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

/** Pure transition for the click-driven foreground timer contract. */
export function transitionClickTimer(input: ClickTimerTransitionInput): ClickTimerTransition {
  const currentMs = Number.isFinite(input.currentMs) ? input.currentMs : 0
  const effectiveMs = Math.max(0, input.effectiveMs)
  if (input.status !== 'running' || input.lastClickAtMs == null) {
    return { status: 'running', effectiveMs, lastClickAtMs: currentMs, timedOut: false }
  }

  const gapMs = currentMs - input.lastClickAtMs
  if (gapMs > CLICK_IDLE_LIMIT_MS) {
    return {
      status: 'running',
      effectiveMs: Math.max(0, effectiveMs - CLICK_IDLE_LIMIT_MS),
      lastClickAtMs: currentMs,
      timedOut: true,
    }
  }

  return { status: 'running', effectiveMs, lastClickAtMs: currentMs, timedOut: false }
}
