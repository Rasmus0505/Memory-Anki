import { useCallback, useState } from 'react'
import { createOperationId } from '@/modules/practice/application/feedPersistence'
import { shuffleFreestyleOverlayQuizApi } from '@/modules/practice/ui/freestyle/api'
import type {
  FreestyleOverlayQuizState,
  FreestyleRoundStatePayload,
} from '@/shared/api/contracts'
import { isBusyResponseError } from '@/shared/api/busyRetry'
import { toast } from '@/shared/feedback/toast'

/**
 * 「打乱题库」 for the 做题 overlay.
 *
 * The round owns the order (`plan.overlay_quiz.question_ids`), so the shuffle is
 * a server write rather than local state: closing and reopening the window keeps
 * it, and two devices cannot disagree about which question is next. The server
 * shuffles only questions it does not consider answered, so the latest local
 * answers are flushed first — a pending debounced write must not land on top of
 * the new order.
 */
export function useOverlayQuizShuffle({
  roundId,
  planVersionRef,
  adoptRound,
  loadQuestions,
  flushProgressNow,
  hasOpenQuestions,
}: {
  roundId: string
  planVersionRef: { current: number }
  adoptRound: (round: FreestyleRoundStatePayload) => FreestyleOverlayQuizState | null
  loadQuestions: (session: FreestyleOverlayQuizState) => Promise<void>
  /** Writes any pending answer progress and resolves once it has landed. */
  flushProgressNow: () => Promise<void>
  /** False when every question is answered: then the whole pool is shuffled. */
  hasOpenQuestions: boolean
}) {
  const [shuffling, setShuffling] = useState(false)

  const shuffle = useCallback(async () => {
    if (!roundId || shuffling) return
    setShuffling(true)
    try {
      await flushProgressNow()
      const request = (expectedVersion: number) => shuffleFreestyleOverlayQuizApi(roundId, {
        operation_id: createOperationId(),
        expected_version: expectedVersion,
      })
      let round = await request(planVersionRef.current)
      // A conflict is only a snapshot: retry once against the version we saw.
      if (round.conflict) round = await request(round.plan_version ?? round.version)
      if (round.conflict) throw new Error('本轮安排正在更新，请重试打乱。')
      const next = adoptRound(round)
      if (next) await loadQuestions(next)
      toast.success(
        hasOpenQuestions
          ? '已打乱题库，从第一道还没答的题开始。'
          : '题目都答过了，已整份打乱，从第 1 题开始。',
      )
    } catch (error) {
      const busy = isBusyResponseError(error)
        || (error instanceof Error && error.message.includes('数据正在写入中'))
      const message = busy
        ? '做题还在同步，请再点一次。'
        : error instanceof Error ? error.message : '打乱题库失败。'
      toast.error(message)
    } finally {
      setShuffling(false)
    }
  }, [
    adoptRound,
    flushProgressNow,
    hasOpenQuestions,
    loadQuestions,
    planVersionRef,
    roundId,
    shuffling,
  ])

  return { shuffling, shuffle }
}
