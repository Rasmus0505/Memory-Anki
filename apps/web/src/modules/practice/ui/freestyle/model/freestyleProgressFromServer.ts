import type { FreestyleRoundProgress } from '@/shared/api/contracts/freestyle'
import type { FreestyleProgressSummary } from './freestyleProgressSegments'

/**
 * Take the round's numbers from the server projection while keeping the local
 * tick fill.
 *
 * Why the split: the server is the only owner of "how much is left / where am
 * I / what is wrong". The local summary still owns the immediate visual fill,
 * because an unsaved tap must not look like a confirmed pass. Overriding the
 * fill from a payload that predates the tap would unfill it and back-fill it on
 * the next response — the exact flicker the local ledger exists to avoid.
 */
export function applyServerRoundProgress(
  local: FreestyleProgressSummary,
  server: FreestyleRoundProgress | null | undefined,
): FreestyleProgressSummary {
  if (!server) return local
  const byId = new Map(server.items.map((item) => [item.card_id, item]))
  const segments = local.segments.map((segment) => {
    const item = byId.get(segment.cardId)
    if (!item) return segment
    return {
      ...segment,
      wrong: item.wrong,
      quizAllCorrect: item.quiz_all_correct === true,
      unitFavorite: item.unit_favorite === true,
      waitingRetry: item.waiting_retry,
      retryAttempt: item.retry_attempt || segment.retryAttempt,
      sourceCardId: item.source_card_id || segment.sourceCardId,
      removed: item.status === 'excluded' || segment.removed,
      isNew: item.is_new,
      isQuiz: item.is_quiz,
      bedtime: item.bedtime,
    }
  })
  return {
    ...local,
    segments,
    position: server.position,
    total: server.total,
    doneCount: server.done_count,
    retryCount: server.retry_count,
    scheduledBase: server.scheduled_base,
    positionBase: server.position_base,
    retryInserted: server.retry_inserted,
    passedCount: server.passed_count,
  }
}
