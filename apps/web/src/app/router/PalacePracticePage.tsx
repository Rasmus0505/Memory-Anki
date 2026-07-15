import { Badge } from '@/shared/components/ui/badge'
import type { PalaceEditorMeta, PalaceEditorResponse } from '@/shared/api/contracts'
import {
  clearPracticeSessionProgressApi,
  getPalaceEditorApi,
  getPracticeSessionProgressApi,
  invalidatePalaceCatalogCache,
  savePracticeSessionProgressApi,
  updatePalacePracticeFlagApi,
} from '@/entities/palace/api'
import { submitReviewSessionApi } from '@/features/review/api'
import {
  PracticeSessionRoute,
  type PracticeProgressSnapshot,
  type PracticeStageTarget,
} from '@/app/router/practiceRouteSupport'

type PalacePracticeMeta = PalaceEditorMeta & PracticeStageTarget

export default function PalacePracticePage() {
  return (
    <PracticeSessionRoute
      config={{
        prefetchKind: 'palace-practice',
        loadingText: '正在加载练习内容...',
        notFoundText: '未找到可练习的宫殿。',
        loadSession: getPalaceEditorApi,
        loadProgress: getPracticeSessionProgressApi,
        buildSession: (session: PalaceEditorResponse) => ({
          data: session.palace as PalacePracticeMeta,
          title: session.palace.title,
          palaceId: session.palace.id,
          reviewEditorState: {
            editor_doc: session.editor_doc,
            editor_config: session.editor_config,
            editor_local_config: session.editor_local_config,
            lang: session.lang,
          },
        }),
        clearProgress: (palace) => clearPracticeSessionProgressApi(palace.id),
        saveProgress: (palace, snapshot: PracticeProgressSnapshot) =>
          savePracticeSessionProgressApi(palace.id, snapshot),
        pageEyebrow: '练习',
        backTo: '/palaces',
        backLabel: '返回列表',
        renderBadge: (_palace, hasResumeProgress) =>
          hasResumeProgress ? (
            <Badge variant="secondary">已接续上次练习</Badge>
          ) : (
            <Badge variant="outline">项目内练习</Badge>
          ),
        getFlowKey: (palace, resetVersion) => `${palace.id}-${resetVersion}`,
        getPersistKey: (palace) => `practice:palace:${palace.id}`,
        getStageTarget: (palace) => palace,
        refreshStageTarget: async (palace) => {
          const refreshed = await getPalaceEditorApi(palace.id)
          return {
            data: refreshed.palace as PalacePracticeMeta,
            title: refreshed.palace.title,
            palaceId: refreshed.palace.id,
            reviewEditorState: {
              editor_doc: refreshed.editor_doc,
              editor_config: refreshed.editor_config,
              editor_local_config: refreshed.editor_local_config,
              lang: refreshed.lang,
            },
          }
        },
        completeWithoutStage: async (palace) => {
          await updatePalacePracticeFlagApi(palace.id, { needs_practice: false })
          invalidatePalaceCatalogCache()
        },
        submitStage: async (palace, payload, targetReviewNumber, needsPractice, note, options) => {
          const scheduleId = palace.current_review_schedule_id
          if (!scheduleId) {
            throw new Error('当前复习节点已变化，请返回书架刷新后重试。')
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
              ...(note ? { note } : {}),
            },
            { mutationId: options.mutationId },
          )
          return { persistTimeRecord: false }
        },
      }}
    />
  )
}
