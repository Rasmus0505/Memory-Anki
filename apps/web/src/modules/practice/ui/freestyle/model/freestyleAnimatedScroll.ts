export const FEED_PAGE_SCROLL_MS = 380

/** Fast departure, long soft landing: reads as weight rather than lag. */
export function easeOutQuart(progress: number) {
  return 1 - (1 - progress) ** 4
}

const INTERRUPT_EVENTS = ['wheel', 'touchstart', 'pointerdown'] as const

/**
 * rAF-driven scrollTop animation for button/keyboard paging. Scroll-snap is suspended
 * for the flight (mandatory snap would fight every intermediate frame) and restored on
 * landing, which sits exactly on a snap point. Any direct input cancels immediately so
 * the finger always wins; the caller's settle logic then takes over.
 */
export function animateScrollTop(
  node: HTMLElement,
  targetTop: number,
  { durationMs = FEED_PAGE_SCROLL_MS, onFinish }: { durationMs?: number; onFinish: (completed: boolean) => void },
): () => void {
  const startTop = node.scrollTop
  const distance = targetTop - startTop
  let frame = 0
  let done = false
  const previousSnap = node.style.scrollSnapType
  node.style.scrollSnapType = 'none'

  const finish = (completed: boolean) => {
    if (done) return
    done = true
    cancelAnimationFrame(frame)
    INTERRUPT_EVENTS.forEach((type) => node.removeEventListener(type, interrupt))
    if (completed) node.scrollTop = targetTop
    node.style.scrollSnapType = previousSnap
    onFinish(completed)
  }
  const interrupt = () => finish(false)
  INTERRUPT_EVENTS.forEach((type) => node.addEventListener(type, interrupt, { passive: true }))

  let startedAt: number | null = null
  const step = (now: number) => {
    if (startedAt == null) startedAt = now
    const progress = Math.min(1, (now - startedAt) / durationMs)
    node.scrollTop = startTop + distance * easeOutQuart(progress)
    if (progress < 1) frame = requestAnimationFrame(step)
    else finish(true)
  }
  frame = requestAnimationFrame(step)
  return () => finish(false)
}
