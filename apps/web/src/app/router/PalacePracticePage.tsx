import { Badge } from '@/shared/components/ui/badge'
import type { PalaceEditorMeta, PalaceEditorResponse } from '@/shared/api/contracts'
import {
  clearPracticeSessionProgressApi,
  getPalaceEditorApi,
  getPracticeSessionProgressApi,
  savePracticeSessionProgressApi,
  togglePalaceFocusNodeApi,
  updatePalacePracticeFlagApi,
} from '@/entities/palace/api'
import { updateDefaultSegmentReviewProgressApi } from '@/entities/palace-segment/api'
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
          if (palace.review_stage_total != null && palace.review_stage_total > 0) {
            const nextCompleted = (palace.review_stage_completed ?? 0) + 1
            const targetReviewNumber = Math.min(nextCompleted, palace.review_stage_total - 1)
            await updateDefaultSegmentReviewProgressApi(palace.id, {
              completed_count: nextCompleted,
              completed_review_number: targetReviewNumber,
            })
          }
          await clearPracticeSessionProgressApi(palace.id)
          await updatePalacePracticeFlagApi(palace.id, { needs_practice: false })
        },
        submitStage: async (palace, payload, targetReviewNumber, needsPractice) => {
          const scheduleId = palace.current_review_schedule_id
          if (scheduleId) {
            await submitReviewSessionApi(scheduleId, {
              duration_seconds: payload.durationSeconds,
              completion_mode: payload.completionMode,
              revealed_remaining: payload.revealedRemaining,
              red_marked_count: payload.redNodeIds.length,
              target_review_number: targetReviewNumber,
              needs_practice: needsPractice,
            })
          } else {
            await updateDefaultSegmentReviewProgressApi(palace.id, {
              completed_count: targetReviewNumber + 1,
              completed_review_number: targetReviewNumber,
            })
          }
          await clearPracticeSessionProgressApi(palace.id)
          if (!needsPractice) {
            await updatePalacePracticeFlagApi(palace.id, { needs_practice: false })
          }
        },
        flowProps: (palace) => ({
          focusNodeUids: palace.focus_node_uids ?? [],
          onToggleFocusNode: async (nodeUid) => {
            await togglePalaceFocusNodeApi(
              palace.id,
              nodeUid,
              !(palace.focus_node_uids ?? []).includes(nodeUid),
            )
          },
        }),
      }}
    />
  )
}
