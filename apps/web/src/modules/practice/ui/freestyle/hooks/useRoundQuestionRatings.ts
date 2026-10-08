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
 * 「本轮尚未复习」 about a round that does not exist.
 *
 * Read-only: it never writes the round, so opening a question window cannot move
 * the round version under the study loop and 409 the next rating.
 */
export function useRoundQuestionRatings({
  roundId,
  enabled = true,
}: {
  roundId: string | null | undefined
  enabled?: boolean
}): Record<string, number> | null {
  const id = String(roundId || '').trim()
  const [ratings, setRatings] = useState<Record<string, number> | null>(null)

  useEffect(() => {
    if (!id || !enabled) {
      setRatings(null)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    void getFreestyleRoundQuestionRatingsApi(id, { signal: controller.signal })
      .then((response) => {
        if (!cancelled) setRatings(response.question_node_ratings ?? {})
      })
      .catch(() => {
        // A missing score is the honest fallback: the badge then reads
        // 「本轮尚未复习」. Never invent a number, and never block the question.
        if (!cancelled) setRatings(null)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [id, enabled])

  return ratings
}
