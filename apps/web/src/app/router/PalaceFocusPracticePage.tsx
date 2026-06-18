import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Target } from 'lucide-react'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { LoadingState } from '@/shared/components/state-placeholders'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import type { MindMapEditorState, ReviewPalaceSummary } from '@/shared/api/contracts'
import {
  MindMapReviewFlow,
  type ReviewFlowSnapshot,
} from '@/features/review/components/MindMapReviewFlow'
import {
  buildFocusRevealState,
  buildReviewTree,
  flattenNodes,
  parseEditorDoc,
} from '@/entities/review/model/review-flow-tree'
import {
  clearFocusPracticeSessionProgressApi,
  getPalaceFocusSessionApi,
  getFocusPracticeSessionProgressApi,
  saveFocusPracticeSessionProgressApi,
  togglePalaceFocusNodeApi,
  updatePalacePracticeFlagApi,
} from '@/entities/palace/api'
import {
  updateDefaultSegmentReviewProgressApi,
} from '@/entities/palace-segment/api'
import { submitReviewSessionApi } from '@/features/review/api/reviewApi'
import { StageSelectDialog } from '@/features/review/components/StageSelectDialog'

export default function PalaceFocusPracticePage() {
  const { id } = useParams()
  const palaceId = id ? Number(id) : null
  const [palace, setPalace] = useState<ReviewPalaceSummary | null>(null)
  const [editorState, setEditorState] = useState<MindMapEditorState | null>(null)
  const [editEditorState, setEditEditorState] = useState<MindMapEditorState | null>(null)
  const [displayMode, setDisplayMode] = useState<'review' | 'edit'>('review')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [initialSnapshot, setInitialSnapshot] = useState<ReviewFlowSnapshot | null>(null)
  const [flowKey, setFlowKey] = useState(0)
  const [hasResumeProgress, setHasResumeProgress] = useState(false)
  const [stageDialogOpen, setStageDialogOpen] = useState(false)
  const [pendingPayload, setPendingPayload] = useState<{
    durationSeconds: number
    completionMode: 'manual_complete' | 'auto_complete'
    revealedRemaining: boolean
    redNodeIds: string[]
  } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!palaceId) return
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [focusSession, progressResponse] = await Promise.all([
          getPalaceFocusSessionApi(palaceId),
          getFocusPracticeSessionProgressApi(palaceId),
        ])
        setPalace(focusSession.palace)
        setEditorState({
          editor_doc: focusSession.editor_doc,
          editor_config: {},
          editor_local_config: {},
          lang: 'zh',
        })
        setEditEditorState({
          editor_doc: focusSession.palace?.editor_doc ?? focusSession.editor_doc,
          editor_config: {},
          editor_local_config: {},
          lang: 'zh',
        })
        const progress = progressResponse.progress
        setHasResumeProgress(Boolean(progress && !progress.completed))
        setInitialSnapshot(
          progress && !progress.completed
            ? {
                revealMap: progress.reveal_map,
                redNodeIds: progress.red_node_ids,
                completed: progress.completed,
              }
            : null,
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载专项练习内容失败。')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [palaceId])

  const focusBadge = useMemo(() => {
    if (!palace) return null
    if (hasResumeProgress) {
      return <Badge variant="secondary">已接续上次专项练习</Badge>
    }
    return <Badge variant="outline">专项 {palace.focus_count ?? 0} 张</Badge>
  }, [hasResumeProgress, palace])

  const computedInitialSnapshot = useMemo(() => {
    if (!editorState || !palace) return initialSnapshot
    const parsedDoc = parseEditorDoc(editorState.editor_doc)
    const root = buildReviewTree(parsedDoc, `${palace.title} / 专项练习`)
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
    } satisfies ReviewFlowSnapshot
  }, [editorState, initialSnapshot, palace])

  if (!palaceId || loading) {
    return <LoadingState text="正在加载专项练习内容…" />
  }

  if (!palace || !editorState || error) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-destructive">{error || '未找到可专项练习的宫殿。'}</div>
  }

  return (
    <div className="space-y-5">
      <PageIntro
        eyebrow="专项练习"
        title={palace.title}
        compact
        actions={
          <>
            <Link to="/palaces/list">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回列表
              </Button>
            </Link>
            {focusBadge}
          </>
        }
      />

      <MindMapReviewFlow
        key={`focus-${palace.id}-${flowKey}`}
        title={`${palace.title} / 专项练习`}
        palaceId={palace.id}
        sessionKind="practice"
        displayMode={displayMode}
        persistKey={`practice:focus:${palace.id}`}
        reviewEditorState={editorState}
        editEditorState={editEditorState}
        onModeToggle={() =>
          setDisplayMode((current) => (current === 'edit' ? 'review' : 'edit'))
        }
        onEditEditorStateChange={setEditEditorState}
        initialSnapshot={computedInitialSnapshot}
        focusNodeUids={palace.focus_node_uids ?? []}
        persistProgress
        onSnapshotChange={async (snapshot) => {
          if (snapshot.completed) {
            setHasResumeProgress(false)
            await clearFocusPracticeSessionProgressApi(palace.id)
            return
          }
          setHasResumeProgress(true)
          await saveFocusPracticeSessionProgressApi(palace.id, {
            completed: snapshot.completed,
            reveal_map: snapshot.revealMap,
            red_node_ids: snapshot.redNodeIds,
          })
        }}
        onRestart={async () => {
          await clearFocusPracticeSessionProgressApi(palace.id)
          setHasResumeProgress(false)
          setInitialSnapshot(null)
          setFlowKey((current) => current + 1)
        }}
        submitting={submitting}
        onComplete={async (payload) => {
          const scheduleId = palace.current_review_schedule_id
          const hasStages = Boolean(
            palace.stage_labels?.length && palace.review_stages?.length
          )
          if (scheduleId && hasStages) {
            setPendingPayload(payload)
            setStageDialogOpen(true)
            return
          }
          setSubmitting(true)
          try {
            if (palace.review_stage_total != null && palace.review_stage_total > 0) {
              const nextCompleted = (palace.review_stage_completed ?? 0) + 1
              const targetReviewNumber = Math.min(nextCompleted, palace.review_stage_total - 1)
              await updateDefaultSegmentReviewProgressApi(palace.id, {
                completed_count: nextCompleted,
                completed_review_number: targetReviewNumber,
              })
            }
            await clearFocusPracticeSessionProgressApi(palace.id)
            setHasResumeProgress(false)
          } finally {
            setSubmitting(false)
          }
        }}
        onToggleFocusNode={async (nodeUid) => {
          await togglePalaceFocusNodeApi(
            palace.id,
            nodeUid,
            !(palace.focus_node_uids ?? []).includes(nodeUid),
          )
        }}
      />

      {(palace.focus_count ?? 0) > 0 ? (
        <div className="rounded-2xl border border-border/70 bg-card/92 px-4 py-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2 font-medium text-foreground">
            <Target className="h-4 w-4" />
            当前专项池保留 {palace.focus_count} 张
          </span>
          <span className="ml-2">完成一次专项练习不会自动移出，仍需手动取消专项标记。</span>
        </div>
      ) : null}

      {palace.stage_labels?.length && palace.review_stages?.length && pendingPayload ? (
        <StageSelectDialog
          open={stageDialogOpen}
          stageLabels={palace.stage_labels}
          stages={palace.review_stages}
          currentReviewNumber={Math.max(0, (palace.review_stage_completed ?? 0) - 1)}
          durationSeconds={pendingPayload?.durationSeconds}
          onConfirm={async (targetReviewNumber, needsPractice) => {
            setStageDialogOpen(false)
            if (!pendingPayload) return
            setSubmitting(true)
            try {
              const scheduleId = palace.current_review_schedule_id
              if (scheduleId) {
                await submitReviewSessionApi(scheduleId, {
                  duration_seconds: pendingPayload.durationSeconds,
                  completion_mode: pendingPayload.completionMode,
                  revealed_remaining: pendingPayload.revealedRemaining,
                  red_marked_count: pendingPayload.redNodeIds.length,
                  target_review_number: targetReviewNumber,
                  needs_practice: needsPractice,
                })
              }
              await clearFocusPracticeSessionProgressApi(palace.id)
              if (!needsPractice) {
                await updatePalacePracticeFlagApi(palace.id, { needs_practice: false })
              }
              setHasResumeProgress(false)
            } finally {
              setSubmitting(false)
              setPendingPayload(null)
            }
          }}
          onCancel={() => {
            setStageDialogOpen(false)
            setPendingPayload(null)
          }}
        />
      ) : null}
    </div>
  )
}
