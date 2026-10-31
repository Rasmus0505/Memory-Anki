import { useCallback, useEffect, useRef } from 'react'

interface ShownAt {
  at: number
  /** Hidden time accumulated before the question appeared. */
  hiddenBase: number
}

/**
 * Tracks when each question first became visible. The quiz attempt payloads
 * use the elapsed milliseconds for the muscle-memory auto-mark rule.
 *
 * Time spent with the tab hidden is paused: switching away to look something
 * up is not retrieval effort, and counting it would mislabel a quick answer as
 * "检索吃力" (and distort the auto-mark threshold).
 */
export function useQuizDwellMs() {
  const shownRef = useRef<Map<number, ShownAt>>(new Map())
  const hiddenTotalRef = useRef(0)
  const hiddenSinceRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibilityChange = () => {
      const now = Date.now()
      if (document.visibilityState === 'hidden') {
        hiddenSinceRef.current = now
        return
      }
      if (hiddenSinceRef.current != null) {
        hiddenTotalRef.current += now - hiddenSinceRef.current
        hiddenSinceRef.current = null
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  const markShown = useCallback((questionId: number) => {
    if (!Number.isFinite(questionId) || questionId <= 0) return
    if (!shownRef.current.has(questionId)) {
      shownRef.current.set(questionId, {
        at: Date.now(),
        hiddenBase: hiddenTotalRef.current,
      })
    }
  }, [])

  /**
   * Start this question's clock again. A quiz window measures each visit: the
   * learner may leave the question and come back, and that second look is not
   * a continuation of the first.
   */
  const restart = useCallback((questionId: number) => {
    if (!Number.isFinite(questionId) || questionId <= 0) return
    shownRef.current.set(questionId, {
      at: Date.now(),
      hiddenBase: hiddenTotalRef.current,
    })
  }, [])

  const elapsedMs = useCallback((questionId: number): number | null => {
    const shown = shownRef.current.get(questionId)
    if (!shown) return null
    const now = Date.now()
    const hiddenNow = hiddenSinceRef.current == null ? 0 : now - hiddenSinceRef.current
    const hidden = hiddenTotalRef.current - shown.hiddenBase + hiddenNow
    return Math.max(0, now - shown.at - hidden)
  }, [])

  const reset = useCallback((questionId: number) => {
    shownRef.current.delete(questionId)
  }, [])

  return { markShown, restart, elapsedMs, reset }
}
