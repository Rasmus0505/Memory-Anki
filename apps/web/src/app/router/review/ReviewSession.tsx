import type { ReviewScheduleSummary } from '@/shared/api/contracts'
import {
  clearReviewSessionProgressApi,
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

export default function ReviewSession() {
  return (
    <ReviewSessionContainer
      eyebrow="正式复习"
      buildTitle={(session) => session.palace?.title || '未命名宫殿'}
      buildReviewEditorState={(session) => ({
        editor_doc: session.palace?.editor_doc ?? null,
        editor_config: {},
        editor_local_config: {},
        lang: 'zh',
      })}
      loadSession={async (sessionId) => toContainerSession(await getReviewSessionApi(sessionId))}
      loadProgress={getReviewSessionProgressApi}
      saveProgress={saveReviewSessionProgressApi}
      clearProgress={clearReviewSessionProgressApi}
      submitSession={submitReviewSessionApi}
      backHref={buildReviewOverviewPath}
      warmupKind="review-session"
    />
  )
}
