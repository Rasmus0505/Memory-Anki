import type {
  MiniPalaceSummary,
  MindMapEditorState,
} from '@/shared/api/contracts'
import {
  clearMiniReviewSessionProgressApi,
  getMiniReviewSessionProgressApi,
  getMiniReviewSessionApi,
  saveMiniReviewSessionProgressApi,
  submitMiniReviewSessionApi,
} from '@/features/review/api/reviewApi'
import {
  ReviewSessionContainer,
  type ReviewSessionContainerSession,
} from '@/features/review/ReviewSessionContainer'
import { buildReviewOverviewPath } from '@/features/review/reviewSessionRoutes'

type MiniReviewSessionResponse = {
  id: number
  palace_mini_palace_id: number
  palace_id: number
  scheduled_date: string
  interval_days: number
  algorithm_used: string
  completed: boolean
  completed_at: string | null
  review_number: number
  review_type: string
  mini_palace: MiniPalaceSummary
  estimated_review_seconds: number
  palace: any
  editor_doc: Record<string, unknown> | string | null
}

function toContainerSession(session: MiniReviewSessionResponse): ReviewSessionContainerSession {
  return {
    id: session.id,
    palace_id: session.palace_id,
    algorithm_used: session.algorithm_used,
    review_type: session.review_type,
    review_number: session.review_number,
    palace: session.palace,
    stageLabels: session.mini_palace?.stage_labels ?? null,
    revealMode: 'mini-checkpoint',
    checkpointNodeUids: session.mini_palace?.node_uids ?? [],
    reviewStages: session.mini_palace?.review_stages ?? null,
    mini_palace: session.mini_palace,
    editor_doc: session.editor_doc,
  }
}

export default function MiniReviewSessionPage() {
  return (
    <ReviewSessionContainer
      eyebrow="小宫殿正式复习"
      buildTitle={(session) =>
        `${session.palace?.title || '未命名宫殿'} / ${session.mini_palace?.name || '小宫殿'}`
      }
      buildReviewEditorState={(session) => ({
        editor_doc: session.editor_doc ?? null,
        editor_config: {},
        editor_local_config: {},
        lang: 'zh',
      })}
      loadSession={async (sessionId) => {
        const data = await getMiniReviewSessionApi(sessionId) as MiniReviewSessionResponse
        return toContainerSession(data)
      }}
      loadProgress={getMiniReviewSessionProgressApi}
      saveProgress={saveMiniReviewSessionProgressApi}
      clearProgress={clearMiniReviewSessionProgressApi}
      submitSession={submitMiniReviewSessionApi}
      backHref={buildReviewOverviewPath}
    />
  )
}
