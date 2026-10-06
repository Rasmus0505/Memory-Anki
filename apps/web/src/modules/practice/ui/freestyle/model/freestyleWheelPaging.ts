/**
 * Desktop wheel paging for the immersive feed.
 *
 * Mandatory snap plus the settle pin pulls any partial wheel delta back to the
 * current page, so a mouse notch never reaches the next card. The feed therefore
 * owns the wheel and turns one notch (or a short trackpad accumulation) into a
 * single page, instead of letting the browser scroll.
 */

export const FREESTYLE_WHEEL_NOTCH_PX = 40
export const FREESTYLE_WHEEL_TRACKPAD_PX = 56
export const FREESTYLE_WHEEL_NOTCH_LOCK_MS = 90
export const FREESTYLE_WHEEL_TRACKPAD_LOCK_MS = 380

export interface FreestyleWheelSample {
  deltaX: number
  deltaY: number
  deltaMode?: number
  ctrlKey?: boolean
  metaKey?: boolean
}

export interface FreestyleWheelPagingState {
  pending: number
  lockedUntil: number
}

export const idleFreestyleWheelPaging = (): FreestyleWheelPagingState => ({
  pending: 0,
  lockedUntil: 0,
})

export type FreestyleWheelDecision = 'ignore' | 'hold' | 'page'

export function freestyleWheelPixels(sample: FreestyleWheelSample) {
  const mode = sample.deltaMode ?? 0
  if (mode === 1) return sample.deltaY * 16
  if (mode === 2) return sample.deltaY * 800
  return sample.deltaY
}

/**
 * `ignore` — zoom, a horizontal gesture, or a canvas that already owns the wheel.
 * `hold` — the feed owns the wheel but has not crossed a page yet; still preventDefault.
 * `page` — turn exactly one card.
 */
export function consumeFreestyleWheel(
  state: FreestyleWheelPagingState,
  sample: FreestyleWheelSample,
  now: number,
): { decision: FreestyleWheelDecision; direction: -1 | 0 | 1; next: FreestyleWheelPagingState } {
  if (sample.ctrlKey || sample.metaKey) {
    return { decision: 'ignore', direction: 0, next: state }
  }
  const pixels = freestyleWheelPixels(sample)
  if (pixels === 0 || Math.abs(pixels) <= Math.abs(sample.deltaX)) {
    return { decision: 'ignore', direction: 0, next: state }
  }
  if (now < state.lockedUntil) {
    return { decision: 'hold', direction: 0, next: state }
  }
  const discrete = sample.deltaMode === 1 || Math.abs(pixels) >= FREESTYLE_WHEEL_NOTCH_PX
  if (discrete) {
    return {
      decision: 'page',
      direction: pixels > 0 ? 1 : -1,
      next: { pending: 0, lockedUntil: now + FREESTYLE_WHEEL_NOTCH_LOCK_MS },
    }
  }
  const pending = state.pending + pixels
  if (Math.abs(pending) < FREESTYLE_WHEEL_TRACKPAD_PX) {
    return { decision: 'hold', direction: 0, next: { pending, lockedUntil: 0 } }
  }
  return {
    decision: 'page',
    direction: pending > 0 ? 1 : -1,
    next: { pending: 0, lockedUntil: now + FREESTYLE_WHEEL_TRACKPAD_LOCK_MS },
  }
}

/** A nested overflow box that can still move in the wheel direction keeps the gesture. */
export function elementCanConsumeWheel(element: HTMLElement, deltaY: number) {
  if (deltaY === 0) return false
  const overflowY = getComputedStyle(element).overflowY
  if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') return false
  if (element.scrollHeight <= element.clientHeight + 1) return false
  if (deltaY > 0) return element.scrollTop + element.clientHeight < element.scrollHeight - 1
  return element.scrollTop > 1
}


