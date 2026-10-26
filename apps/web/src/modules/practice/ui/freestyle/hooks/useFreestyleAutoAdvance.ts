import { useCallback, useEffect, useRef } from 'react'

/**
 * How long the settled rating stays on screen before the feed moves: long enough
 * for the confirmation breath and an undo tap, short enough to feel hands-free.
 */
export const FREESTYLE_AUTO_ADVANCE_MS = 800

/**
 * Where 评分后自动翻页 lands: the earliest unit still waiting for a this-round
 * score, wherever it sits in the queue (a skipped card behind the current one is
 * the target, not the neighbour). With nothing left unscored a finished round
 * lands on the closing settlement slot; an unfinished one stays put.
 */
export function resolveFreestyleAutoAdvanceTarget(input: {
  unscoredIndices: readonly number[]
  cardCount: number
  roundComplete: boolean
}): number | null {
  const earliest = input.unscoredIndices.find((index) => index >= 0 && index < input.cardCount)
  if (earliest != null) return earliest
  return input.roundComplete && input.cardCount > 0 ? input.cardCount : null
}

/**
 * Opt-in hands-free paging for the 随心 feed (`翻卡设置 → 评分后自动翻页`).
 *
 * `scheduleAutoAdvance(cardId)` is called when a rating settles; it moves the feed
 * only when that card is still the one under the viewport. The target index is
 * resolved at fire time from the live queue, so a restudy reorder or a newly
 * skipped card during the delay cannot land on the wrong unit. Any manual page
 * change, a new rating, an undo, disabling the setting or leaving the page
 * cancels a pending move.
 */
export function useFreestyleAutoAdvance({
  enabled,
  viewingCardId,
  resolveTargetIndex,
  navigateToIndex,
}: {
  enabled: boolean
  viewingCardId: string | null
  resolveTargetIndex: () => number | null
  navigateToIndex: (index: number) => void
}) {
  const latest = useRef({ enabled, viewingCardId, resolveTargetIndex, navigateToIndex })
  latest.current = { enabled, viewingCardId, resolveTargetIndex, navigateToIndex }
  const timerRef = useRef<number | null>(null)

  const cancelAutoAdvance = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const scheduleAutoAdvance = useCallback(
    (cardId: string) => {
      const current = latest.current
      if (!current.enabled || current.viewingCardId !== cardId) return
      cancelAutoAdvance()
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        const now = latest.current
        if (!now.enabled || now.viewingCardId !== cardId) return
        const target = now.resolveTargetIndex()
        if (target == null) return
        now.navigateToIndex(target)
      }, FREESTYLE_AUTO_ADVANCE_MS)
    },
    [cancelAutoAdvance],
  )

  // A manual page change (finger, wheel, keyboard, 下一张) owns the feed from there.
  useEffect(() => {
    cancelAutoAdvance()
  }, [cancelAutoAdvance, viewingCardId])

  useEffect(() => {
    if (!enabled) cancelAutoAdvance()
  }, [cancelAutoAdvance, enabled])

  useEffect(() => cancelAutoAdvance, [cancelAutoAdvance])

  return { scheduleAutoAdvance, cancelAutoAdvance }
}
