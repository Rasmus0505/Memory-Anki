import { Target } from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import type { MindMapEditorState, ReviewPalaceSummary } from '@/shared/api/contracts'
import {
  clearFocusPracticeSessionProgressApi,
  getFocusPracticeSessionProgressApi,
  getPalaceFocusSessionApi,
  saveFocusPracticeSessionProgressApi,
  togglePalaceFocusNodeApi,
  updatePalacePracticeFlagApi,
} from '@/entities/palace/api'
import {
  buildFocusRevealState,
  buildReviewTree,
  flattenNodes,
  parseEditorDoc,
} from '@/entities/review/model/review-flow-tree'
import { submitReviewSessionApi } from '@/features/review/api'
import {
  PracticeSessionRoute,
  type PracticeProgressSnapshot,
} from '@/app/router/practiceRouteSupport'

interface FocusPracticeSession {
  palace: ReviewPalaceSummary
  editor_doc: MindMapEditorState['editor_doc']
}

function buildFocusSession(payload: FocusPracticeSession) {
  return {
    data: payload.palace,
    title: payload.palace.title,
    palaceId: payload.palace.id,
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

export default function PalaceFocusPracticePage() {
  return (
    <PracticeSessionRoute
      config={{
        prefetchKind: 'focus-practice',
        loadingText: '正在加载专项训练内容...',
        notFoundText: '未找到可专项训练的宫殿。',
        loadSession: getPalaceFocusSessionApi,
        loadProgress: getFocusPracticeSessionProgressApi,
        buildSession: buildFocusSession,
        clearProgress: (palace) => clearFocusPracticeSessionProgressApi(palace.id),
        saveProgress: (palace, snapshot: PracticeProgressSnapshot) =>
          saveFocusPracticeSessionProgressApi(palace.id, snapshot),
        pageEyebrow: '专项训练',
        backTo: '/palaces/list',
        backLabel: '返回列表',
        renderBadge: (palace, hasResumeProgress) =>
          hasResumeProgress ? (
            <Badge variant="secondary">已接续上次专项训练</Badge>
          ) : (
            <Badge variant="outline">专项 {palace.focus_count ?? 0} 张</Badge>
          ),
        getFlowKey: (palace, resetVersion) => `focus-${palace.id}-${resetVersion}`,
        getPersistKey: (palace) => `practice:focus:${palace.id}`,
        getStageTarget: (palace) => palace,
        refreshStageTarget: async (palace) =>
          buildFocusSession((await getPalaceFocusSessionApi(palace.id)) as FocusPracticeSession),
        completeWithoutStage: async (palace) => {
          await clearFocusPracticeSessionProgressApi(palace.id)
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
          }
          await clearFocusPracticeSessionProgressApi(palace.id)
          if (!needsPractice) {
            await updatePalacePracticeFlagApi(palace.id, { needs_practice: false })
          }
        },
        computeInitialSnapshot: (session, initialSnapshot) => {
          const palace = session.data
          const parsedDoc = parseEditorDoc(session.reviewEditorState.editor_doc)
          const root = buildReviewTree(parsedDoc, `${palace.title} / 专项训练`)
          const nodeMap = flattenNodes(root)
          const previousRevealMap = initialSnapshot?.revealMap ?? null
          return {
            revealMap: buildFocusRevealState(
              root,
              palace.focus_node_uids ?? [],
              nodeMap,
              previousRevealMap,
            ),
            redNodeIds: palace.focus_node_uids ?? [],
            completed: false,
          }
        },
        flowProps: (palace) => ({
          title: `${palace.title} / 专项训练`,
          focusNodeUids: palace.focus_node_uids ?? [],
          onToggleFocusNode: async (nodeUid) => {
            await togglePalaceFocusNodeApi(
              palace.id,
              nodeUid,
              !(palace.focus_node_uids ?? []).includes(nodeUid),
            )
          },
        }),
        renderAfterFlow: (palace) =>
          (palace.focus_count ?? 0) > 0 ? (
            <div className="rounded-lg border border-border/70 bg-card/92 px-4 py-3 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2 font-medium text-foreground">
                <Target className="size-4" />
                当前专项池保留 {palace.focus_count} 张
              </span>
              <span className="ml-2">
                完成一次专项训练不会自动移除，仍需手动取消专项标记。
              </span>
            </div>
          ) : null,
        resetFlowOnRestart: true,
      }}
    />
  )
}
