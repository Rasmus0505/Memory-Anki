import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ReviewScheduleSummary } from '@/shared/api/contracts'
import {
  getReviewSessionApi,
  getReviewSessionProgressApi,
  saveReviewSessionProgressApi,
  submitReviewSessionApi,
} from '@/features/review/api'
import {
  ReviewSessionContainer,
  type ReviewSessionContainerSession,
} from '@/widgets/mindmap-review-flow'
import { buildReviewOverviewPath } from '@/entities/review'

function toContainerSession(session: ReviewScheduleSummary): ReviewSessionContainerSession {
  return {
    id: session.id,
    palace_id: session.palace_id,
    algorithm_used: session.algorithm_used,
    review_type: session.review_type,
    review_number: session.review_number,
    palace: session.palace,
    stageLabels: session.palace?.stage_labels ?? null,
    reviewStages: session.palace?.review_stages ?? null,
  }
}

function buildReviewTitle(session: ReviewSessionContainerSession) {
  return session.palace?.title || '未命名宫殿'
}

function buildReviewEditorState(session: ReviewSessionContainerSession) {
  return {
    editor_doc: session.palace?.editor_doc ?? null,
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
  }
}
export default function ReviewSession() {
  const navigate = useNavigate()

  const loadReviewSession = useCallback(async (sessionId: number) => {
    try {
      return toContainerSession(await getReviewSessionApi(sessionId))
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        navigate(buildReviewOverviewPath(), { replace: true })
      }
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
      submitSession={submitReviewSessionApi}
      onSubmitted={(result) => {
        navigate(`/review/completed/${result.review_log_id}`, { replace: true })
      }}
      backHref={buildReviewOverviewPath}
      warmupKind="review-session"
    />
  )
}
