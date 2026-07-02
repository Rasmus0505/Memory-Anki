import { Badge } from '@/shared/components/ui/badge'
import type { PalaceSegmentPracticeResponse, PalaceSegmentSummary } from '@/shared/api/contracts'
import {
  clearSegmentPracticeSessionProgressApi,
  getSegmentPracticeSessionProgressApi,
  saveSegmentPracticeSessionProgressApi,
} from '@/entities/palace/api'
import {
  getPalaceSegmentApi,
  updatePalaceSegmentReviewProgressApi,
} from '@/entities/palace-segment/api'
import { submitSegmentReviewSessionApi } from '@/features/review/api'
import {
  PracticeSessionRoute,
  type PracticeProgressSnapshot,
} from '@/app/router/practiceRouteSupport'

interface SegmentPracticeData {
  segment: PalaceSegmentSummary
  title: string
}

function buildSegmentSession(payload: PalaceSegmentPracticeResponse) {
  const title = `${payload.palace.title} / ${payload.item.name}`
  return {
    data: {
      segment: payload.item,
      title,
    },
    title,
    palaceId: payload.item.palace_id,
    reviewEditorState: {
      editor_doc: payload.editor_doc,
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    },
  }
}

export default function SegmentPracticePage() {
  return (
    <PracticeSessionRoute
      config={{
        prefetchKind: 'segment-practice',
        loadingText: '正在加载分块练习内容...',
        notFoundText: '未找到可练习的分块。',
        loadSession: getPalaceSegmentApi,
        loadProgress: getSegmentPracticeSessionProgressApi,
        buildSession: buildSegmentSession,
        clearProgress: ({ segment }) => clearSegmentPracticeSessionProgressApi(segment.id),
        saveProgress: ({ segment }, snapshot: PracticeProgressSnapshot) =>
          saveSegmentPracticeSessionProgressApi(segment.id, snapshot),
        pageEyebrow: '分块练习',
        backTo: '/palaces',
        backLabel: '返回列表',
        renderBadge: (_data: SegmentPracticeData, hasResumeProgress) =>
          hasResumeProgress ? (
            <Badge variant="secondary">已接续上次练习</Badge>
          ) : (
            <Badge variant="outline">分块练习</Badge>
          ),
        getFlowKey: ({ segment }, resetVersion) => `${segment.id}-${resetVersion}`,
        getPersistKey: ({ segment }) => `practice:segment:${segment.id}`,
        getStageTarget: ({ segment }) => segment,
        refreshStageTarget: async ({ segment }) =>
          buildSegmentSession(await getPalaceSegmentApi(segment.id)),
        completeWithoutStage: async ({ segment }) => {
          if (segment.review_stage_total != null && segment.review_stage_total > 0) {
            const nextCompleted = (segment.review_stage_completed ?? 0) + 1
            const targetReviewNumber = Math.min(nextCompleted, segment.review_stage_total - 1)
            await updatePalaceSegmentReviewProgressApi(segment.id, {
              completed_count: nextCompleted,
              completed_review_number: targetReviewNumber,
            })
          }
          await clearSegmentPracticeSessionProgressApi(segment.id)
        },
        submitStage: async ({ segment }, payload, targetReviewNumber, needsPractice) => {
          const scheduleId = segment.current_review_schedule_id
          if (scheduleId) {
            await submitSegmentReviewSessionApi(scheduleId, {
              duration_seconds: payload.durationSeconds,
              completion_mode: payload.completionMode,
              revealed_remaining: payload.revealedRemaining,
              red_marked_count: payload.redNodeIds.length,
              target_review_number: targetReviewNumber,
              needs_practice: needsPractice,
            })
          } else {
            await updatePalaceSegmentReviewProgressApi(segment.id, {
              completed_count: targetReviewNumber + 1,
              completed_review_number: targetReviewNumber,
            })
          }
          await clearSegmentPracticeSessionProgressApi(segment.id)
        },
      }}
    />
  )
}
