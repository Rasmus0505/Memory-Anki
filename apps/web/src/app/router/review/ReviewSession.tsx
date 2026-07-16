import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ReviewScheduleSummary } from '@/shared/api/contracts'
import {
  getReviewSessionApi,
  getReviewSessionCompletionSummaryApi,
  getReviewSessionProgressApi,
  saveReviewSessionProgressApi,
  submitReviewSessionApi,
} from '@/features/review/api'
import { ReviewSessionContainer, type ReviewSessionContainerSession } from '@/widgets/mindmap-review-flow'
import { buildReviewOverviewPath } from '@/entities/review'

function toContainerSession(session: ReviewScheduleSummary): ReviewSessionContainerSession {
  return {
    id: session.id,
    palace_id: session.palace_id,
    algorithm_used: 'FSRS',
    review_type: 'fsrs',
    review_number: 0,
    palace: session.palace,
    frozen_due_node_uids: session.frozen_due_node_uids ?? [],
    due_node_count: session.due_node_count,
    memory_summary: session.memory_summary,
  }
}
function buildReviewTitle(session: ReviewSessionContainerSession) { return session.palace?.title || '未命名宫殿' }
function buildReviewEditorState(session: ReviewSessionContainerSession) {
  return { editor_doc: session.palace?.editor_doc ?? null, editor_config: {}, editor_local_config: {}, lang: 'zh' }
}
export default function ReviewSession() {
  const navigate = useNavigate()
  const loadReviewSession = useCallback(async (sessionId: string | number) => {
    try {
      const response = await getReviewSessionApi(sessionId)
      if (String(response.id) !== String(sessionId)) navigate(`/review/session/${response.id}`, { replace: true })
      return toContainerSession(response)
    } catch (error) {
      if ((error as { status?: number }).status === 404) navigate(buildReviewOverviewPath(), { replace: true })
      throw error
    }
  }, [navigate])
  return (
    <ReviewSessionContainer
      eyebrow="正式复习"
      buildTitle={buildReviewTitle}
      buildReviewEditorState={buildReviewEditorState}
      loadSession={loadReviewSession}
      loadProgress={getReviewSessionProgressApi}
      saveProgress={saveReviewSessionProgressApi}
      loadCompletionSummary={getReviewSessionCompletionSummaryApi}
      submitSession={submitReviewSessionApi}
      onSubmitted={(result) => navigate(`/review/completed/${result.review_log_id}`, { replace: true })}
      backHref={buildReviewOverviewPath}
    />
  )
}
