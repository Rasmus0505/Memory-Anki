import type {
  MindMapEditorState,
  ReviewScheduleSummary,
  SegmentReviewScheduleSummary,
} from '@/shared/api/contracts'
import {
  clearSegmentReviewSessionProgressApi,
  getSegmentReviewSessionApi,
  getSegmentReviewSessionProgressApi,
  saveSegmentReviewSessionProgressApi,
  submitSegmentReviewSessionApi,
} from '@/features/review/api/reviewApi'
import {
  ReviewSessionContainer,
  type ReviewSessionContainerSession,
} from '@/features/review/ReviewSessionContainer'
import { buildReviewOverviewPath } from '@/features/review/reviewSessionRoutes'

type SegmentReviewSessionResponse = SegmentReviewScheduleSummary & {
  palace: ReviewScheduleSummary['palace']
  editor_doc: Record<string, unknown> | string | null
}

function getSegmentDisplayName(session: SegmentReviewSessionResponse) {
  return session.segment?.display_name || session.segment?.name || '未命名分块'
}

function toContainerSession(session: SegmentReviewSessionResponse): ReviewSessionContainerSession & {
  reviewEditorState: MindMapEditorState
  segmentDisplayName: string
} {
  return {
    id: session.id,
    palace_id: session.palace_id,
    algorithm_used: session.algorithm_used,
    review_type: session.review_type,
    review_number: session.review_number,
    palace: session.palace,
    stageLabels: session.segment?.stage_labels ?? null,
    reviewStages: session.segment?.review_stages ?? null,
    reviewEditorState: {
      editor_doc: session.editor_doc,
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    },
    segmentDisplayName: getSegmentDisplayName(session),
  }
}

export default function SegmentReviewSessionPage() {
  return (
    <ReviewSessionContainer
      eyebrow="分块正式复习"
      buildTitle={(session) =>
        `${session.palace?.title || '未命名宫殿'} / ${(session as ReviewSessionContainerSession & { segmentDisplayName: string }).segmentDisplayName}`
      }
      buildReviewEditorState={(session) =>
        (session as ReviewSessionContainerSession & { reviewEditorState: MindMapEditorState }).reviewEditorState
      }
      loadSession={async (sessionId) =>
        toContainerSession(await getSegmentReviewSessionApi(sessionId) as SegmentReviewSessionResponse)
      }
      loadProgress={getSegmentReviewSessionProgressApi}
      saveProgress={saveSegmentReviewSessionProgressApi}
      clearProgress={clearSegmentReviewSessionProgressApi}
      submitSession={submitSegmentReviewSessionApi}
      backHref={buildReviewOverviewPath}
      refreshReviewStateOnExitEdit
    />
  )
}
