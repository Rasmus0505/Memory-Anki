import { useEffect, useState } from 'react'
import { getFreestyleRoundQuestionRatingsApi } from '@/modules/practice/ui/freestyle/api'

/**
 * This round's weakest rating per question, for the 关联题目 rating badge.
 *
 * The rule ("weakest bound knowledge point, this round") is owned by the backend
 * (`build_round_question_ratings`), which the 做题 overlay reads too. This hook
 * only fetches it, so both windows spell 「本轮最低 N」 the same way.
 *
 * A plain fetch rather than `useQuery`: this dialog is rendered from several
 * hosts (随心, 知识, the mind-map editor) and must not require a
 * `QueryClientProvider` just to open a question window.
 *
 * `enabled` is the caller's "am I inside a round?" switch. Outside 随心 there is
 * no round to score against, and the badge must stay absent rather than claim
 * 「本轮尚未复习」 about a round that does not exist. A failed fetch does the
 * same: hiding the badge is honest; inventing "not reviewed yet" is not.
 *
 * Read-only: it never writes the round, so opening a question window cannot move
 * the round version under the study loop and 409 the next rating.
 */
export type RoundQuestionBadge = {
  ratings: Record<string, number>
  pendingIds: string[]
}

export function useRoundQuestionRatings({
  roundId,
  enabled = true,
}: {
  roundId: string | null | undefined
  enabled?: boolean
}): RoundQuestionBadge | null {
  const id = String(roundId || '').trim()
  const [badge, setBadge] = useState<RoundQuestionBadge | null>(null)

  useEffect(() => {
    if (!id || !enabled) {
      setBadge(null)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    void getFreestyleRoundQuestionRatingsApi(id, { signal: controller.signal })
      .then((response) => {
        if (cancelled) return
        setBadge({
          ratings: response.question_node_ratings ?? {},
          pendingIds: response.question_pending_ids ?? [],
        })
      })
      .catch(() => {
        // Hide the badge. A failed fetch is not evidence the point is unreviewed.
        if (!cancelled) setBadge(null)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [id, enabled])

  return badge
}
