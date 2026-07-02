import { Badge } from '@/shared/components/ui/badge'
import type { MiniPalacePracticeResponse, MiniPalaceSummary } from '@/shared/api/contracts'
import {
  clearMiniPracticeSessionProgressApi,
  getMiniPracticeSessionProgressApi,
  saveMiniPracticeSessionProgressApi,
} from '@/entities/palace/api'
import {
  getPalaceMiniPalaceApi,
  updateMiniPalaceReviewProgressApi,
} from '@/entities/mini-palace/api'
import { submitMiniReviewSessionApi } from '@/features/review/api'
import {
  PracticeSessionRoute,
  type PracticeProgressSnapshot,
} from '@/app/router/practiceRouteSupport'

interface MiniPracticeData {
  miniPalace: MiniPalaceSummary
  title: string
}

function buildMiniSession(payload: MiniPalacePracticeResponse) {
  const title = `${payload.palace?.title || '未命名宫殿'} / ${payload.item.name}`
  return {
    data: {
      miniPalace: payload.item,
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
    editEditorState: {
      editor_doc: payload.palace?.editor_doc ?? payload.editor_doc,
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    },
  }
}

export default function MiniPalacePracticePage() {
  return (
    <PracticeSessionRoute
      config={{
        prefetchKind: 'mini-practice',
        loadingText: '正在加载小宫殿练习内容...',
        notFoundText: '未找到可练习的小宫殿。',
        loadSession: getPalaceMiniPalaceApi,
        loadProgress: getMiniPracticeSessionProgressApi,
        buildSession: buildMiniSession,
        clearProgress: ({ miniPalace }) => clearMiniPracticeSessionProgressApi(miniPalace.id),
        saveProgress: ({ miniPalace }, snapshot: PracticeProgressSnapshot) =>
          saveMiniPracticeSessionProgressApi(miniPalace.id, snapshot),
        pageEyebrow: '小宫殿练习',
        backTo: '/palaces',
        backLabel: '返回书架',
        renderBadge: ({ miniPalace }: MiniPracticeData, hasResumeProgress) =>
          hasResumeProgress ? (
            <Badge variant="secondary">已接续上次练习</Badge>
          ) : (
            <Badge variant="outline">{miniPalace.node_count} 张</Badge>
          ),
        getFlowKey: ({ miniPalace }, resetVersion) => `mini-practice-${miniPalace.id}-${resetVersion}`,
        getPersistKey: ({ miniPalace }) => `practice:mini:${miniPalace.id}`,
        getStageTarget: ({ miniPalace }) => miniPalace,
        refreshStageTarget: async ({ miniPalace }) =>
          buildMiniSession(await getPalaceMiniPalaceApi(miniPalace.id)),
        completeWithoutStage: async ({ miniPalace }) => {
          if (miniPalace.review_stage_total != null && miniPalace.review_stage_total > 0) {
            const nextCompleted = (miniPalace.review_stage_completed ?? 0) + 1
            const targetReviewNumber = Math.min(nextCompleted, miniPalace.review_stage_total - 1)
            await updateMiniPalaceReviewProgressApi(miniPalace.id, {
              completed_count: nextCompleted,
              completed_review_number: targetReviewNumber,
            })
          }
          await clearMiniPracticeSessionProgressApi(miniPalace.id)
        },
        submitStage: async ({ miniPalace }, payload, targetReviewNumber, needsPractice) => {
          const scheduleId = miniPalace.current_review_schedule_id
          if (scheduleId) {
            await submitMiniReviewSessionApi(scheduleId, {
              duration_seconds: payload.durationSeconds,
              completion_mode: payload.completionMode,
              revealed_remaining: payload.revealedRemaining,
              red_marked_count: payload.redNodeIds.length,
              target_review_number: targetReviewNumber,
              needs_practice: needsPractice,
            })
          } else {
            await updateMiniPalaceReviewProgressApi(miniPalace.id, {
              completed_count: targetReviewNumber + 1,
              completed_review_number: targetReviewNumber,
            })
          }
          await clearMiniPracticeSessionProgressApi(miniPalace.id)
        },
        flowProps: ({ miniPalace }) => ({
          revealMode: 'mini-checkpoint',
          checkpointNodeUids: miniPalace.node_uids,
        }),
      }}
    />
  )
}
