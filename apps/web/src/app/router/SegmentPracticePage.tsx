import { Badge } from '@/shared/components/ui/badge'
import type { PalaceSegmentPracticeResponse, PalaceSegmentSummary } from '@/shared/api/contracts'
import {
  clearSegmentPracticeSessionProgressApi,
  getSegmentPracticeSessionProgressApi,
  invalidatePalaceCatalogCache,
  saveSegmentPracticeSessionProgressApi,
} from '@/entities/palace/api'
import { getPalaceSegmentApi, updatePalaceSegmentApi } from '@/entities/palace-segment/api'
import { submitReviewSessionApi } from '@/features/review/api'
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
        loadingText: '正在加载学习组训练内容...',
        notFoundText: '未找到可训练的学习组。',
        loadSession: getPalaceSegmentApi,
        loadProgress: getSegmentPracticeSessionProgressApi,
        buildSession: buildSegmentSession,
        clearProgress: ({ segment }) => clearSegmentPracticeSessionProgressApi(segment.id),
        saveProgress: ({ segment }, snapshot: PracticeProgressSnapshot) =>
          saveSegmentPracticeSessionProgressApi(segment.id, snapshot),
        pageEyebrow: '学习组训练',
        backTo: '/palaces',
        backLabel: '返回列表',
        renderBadge: (_data: SegmentPracticeData, hasResumeProgress) =>
          hasResumeProgress ? (
            <Badge variant="secondary">已接续上次训练</Badge>
          ) : (
            <Badge variant="outline">学习组训练</Badge>
          ),
        getFlowKey: ({ segment }, resetVersion) => `${segment.id}-${resetVersion}`,
        getPersistKey: ({ segment }) => `practice:segment:${segment.id}`,
        getStageTarget: ({ segment }) => segment,
        refreshStageTarget: async ({ segment }) =>
          buildSegmentSession(await getPalaceSegmentApi(segment.id)),
        completeWithoutStage: async ({ segment }) => {
          await updatePalaceSegmentApi(segment.id, { needs_practice: false })
          invalidatePalaceCatalogCache()
        },
        submitStage: async ({ segment }, payload, targetReviewNumber, needsPractice, options) => {
          const scheduleId = segment.current_review_schedule_id
          if (!scheduleId) {
            throw new Error('当前学习组没有可提交的复习节点，请返回书架刷新后重试。')
          }
          await submitReviewSessionApi(
            scheduleId,
            {
              duration_seconds: payload.durationSeconds,
              completion_mode: payload.completionMode,
              revealed_remaining: payload.revealedRemaining,
              red_marked_count: payload.redNodeIds.length,
              target_review_number: targetReviewNumber,
              needs_practice: needsPractice,
            },
            { mutationId: options.mutationId },
          )
          return { persistTimeRecord: false }
        },
        flowProps: ({ segment }) => ({
          revealMode: 'segment-checkpoint',
          checkpointNodeUids: segment.node_uids,
        }),
      }}
    />
  )
}
