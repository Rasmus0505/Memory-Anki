import type { MindMapRecallRating, ReviewSessionSubmitResponse } from '@/shared/api/contracts'
import {
  getReviewSessionCompletionSummaryApi,
  rateUnratedReviewSessionNodesApi,
} from '@/modules/practice/ui/review/api'
import { ratePalaceNodesApi } from '@/modules/practice/ui/review/api/nodeMemoryApi'
import { submitReviewSessionApi } from '@/widgets/mindmap-review-flow'
import { needsRestudyAfterRatings } from '@/modules/practice/public'

function operationId(prefix: string) {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function restudyFromSubmitResult(
  result: ReviewSessionSubmitResponse | null | undefined,
): boolean {
  if (!result) return false
  if (Number(result.pending_reinforcement?.pending_count || 0) > 0) return true
  return needsRestudyAfterRatings(result.rating_counts)
}

export async function submitAnkiSessionIfFullyRated(sessionId: string) {
  const summary = await getReviewSessionCompletionSummaryApi(sessionId)
  if ((summary.item.unrated_due_node_count ?? 0) > 0) {
    return { submitted: false as const, result: null }
  }
  const result = await submitReviewSessionApi(
    sessionId,
    {
      duration_seconds: 0,
      completion_mode: 'manual_complete',
      revealed_remaining: true,
      red_marked_count: 0,
    },
    { mutationId: operationId('anki-submit') },
  )
  return { submitted: true as const, result }
}

export async function rateAnkiGroupAndMaybeSubmit(
  sessionId: string,
  rating: MindMapRecallRating,
) {
  await rateUnratedReviewSessionNodesApi(sessionId, {
    rating,
    operation_id: operationId('anki-rate'),
  })
  return submitAnkiSessionIfFullyRated(sessionId)
}

export async function rateAnkiSingleAndMaybeSubmit(
  palaceId: number,
  sessionId: string,
  nodeUid: string,
  rating: MindMapRecallRating,
) {
  await ratePalaceNodesApi(palaceId, {
    node_uid: nodeUid,
    rating,
    study_session_id: sessionId,
    operation_id: operationId('anki-single'),
    rating_scope: 'single',
    source_scene: 'formal_review',
    recall_round: 'first',
    rating_source: 'manual',
  })
  return submitAnkiSessionIfFullyRated(sessionId)
}
