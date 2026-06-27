import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { LoadingState } from '@/shared/components/state-placeholders'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import type { MindMapEditorState } from '@/shared/api/contracts'
import {
  MindMapReviewFlow,
  type ReviewFlowSnapshot,
} from '@/features/review/components/MindMapReviewFlow'
import {
  clearPracticeSessionProgressApi,
  getPalaceEditorApi,
  getPracticeSessionProgressApi,
  savePracticeSessionProgressApi,
  togglePalaceFocusNodeApi,
  updatePalacePracticeFlagApi,
} from '@/entities/palace/api'
import {
  updateDefaultSegmentReviewProgressApi,
} from '@/entities/palace-segment/api'
import { submitReviewSessionApi } from '@/features/review/api/reviewApi'
import { StageSelectDialog } from '@/features/review/components/StageSelectDialog'
import type { ReviewStageSummary } from '@/shared/api/contracts'

interface PalaceMeta {
  id: number
  title: string
  description: string
  archived: boolean
  mastered: boolean
  focus_node_uids?: string[]
  focus_count?: number
  attachments: Array<{ id: number; original_name: string }>
  chapters: Array<{ id: number; name: string; subject?: { id: number; name: string } | null }>
  current_review_schedule_id?: number | null
  review_stage_total?: number
  review_stage_completed?: number
  review_stage_progress?: number
  stage_labels?: string[]
  review_stages?: ReviewStageSummary[]
  segments?: Array<{
    id: number; name: string; review_stage_completed: number; review_stage_total: number
    stage_labels: string[]; review_stages?: ReviewStageSummary[]
    current_review_schedule_id: number | null
  }>
}

export default function PalacePractice() {
  const { id } = useParams()
  const palaceId = id ? Number(id) : null
  const [palace, setPalace] = useState<PalaceMeta | null>(null)
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
        const editor = await getPalaceEditorApi(palaceId)
        const data = editor
        setPalace(data.palace as PalaceMeta)
        setEditorState({
          editor_doc: editor.editor_doc,
          editor_config: editor.editor_config,
          editor_local_config: editor.editor_local_config,
          lang: editor.lang,
        })
        const progressResponse = await getPracticeSessionProgressApi(palaceId)
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
        setError(err instanceof Error ? err.message : '加载练习内容失败。')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [palaceId])

  const practiceBadge = useMemo(() => {
    if (!palaceId) return null
    if (hasResumeProgress) {
      return <Badge variant="secondary">已接续上次练习</Badge>
    }
    return <Badge variant="outline">项目内续练</Badge>
  }, [hasResumeProgress, palaceId])

  if (!palaceId || loading) {
    return <LoadingState text="正在加载练习内容…" />
  }

  if (!palace || !editorState || error) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-destructive">{error || '未找到可练习的宫殿。'}</div>
  }

  return (
    <div className="space-y-5">
      <PageIntro
        eyebrow="练习"
        title={palace.title}
        compact
        actions={
          <>
            <Link to="/palaces">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回列表
              </Button>
            </Link>
            {practiceBadge}
          </>
        }
      />

      <MindMapReviewFlow
        key={`${palace.id}-${flowKey}`}
        title={palace.title}
        palaceId={palace.id}
        sessionKind="practice"
        displayMode={displayMode}
        persistKey={`practice:palace:${palace.id}`}
        reviewEditorState={editorState}
        editEditorState={editEditorState}
        onModeToggle={() =>
          setDisplayMode((current) => (current === 'edit' ? 'review' : 'edit'))
        }
        onEditEditorStateChange={setEditEditorState}
        initialSnapshot={initialSnapshot}
        focusNodeUids={palace.focus_node_uids ?? []}
        persistProgress
        onSnapshotChange={async (snapshot) => {
          if (snapshot.completed) {
            setHasResumeProgress(false)
            await clearPracticeSessionProgressApi(palace.id)
            return
          }
          setHasResumeProgress(true)
          await savePracticeSessionProgressApi(palace.id, {
            completed: snapshot.completed,
            reveal_map: snapshot.revealMap,
            red_node_ids: snapshot.redNodeIds,
          })
        }}
        onRestart={async () => {
          await clearPracticeSessionProgressApi(palace.id)
          setHasResumeProgress(false)
          setInitialSnapshot(null)
        }}
        submitting={submitting}
        onComplete={async (payload) => {
          let reviewPalace = palace
          let hasStages = Boolean(reviewPalace.stage_labels?.length && reviewPalace.review_stages?.length)
          if (!hasStages && (reviewPalace.review_stage_total ?? 0) > 0) {
            const refreshed = await getPalaceEditorApi(reviewPalace.id)
            reviewPalace = refreshed.palace as PalaceMeta
            setPalace(reviewPalace)
            hasStages = Boolean(reviewPalace.stage_labels?.length && reviewPalace.review_stages?.length)
          }
          if (hasStages) {
            setPendingPayload(payload)
            setStageDialogOpen(true)
            return
          }
          setSubmitting(true)
          try {
            if (reviewPalace.review_stage_total != null && reviewPalace.review_stage_total > 0) {
              const nextCompleted = (reviewPalace.review_stage_completed ?? 0) + 1
              const targetReviewNumber = Math.min(nextCompleted, reviewPalace.review_stage_total - 1)
              await updateDefaultSegmentReviewProgressApi(reviewPalace.id, {
                completed_count: nextCompleted,
                completed_review_number: targetReviewNumber,
              })
            }
            await clearPracticeSessionProgressApi(reviewPalace.id)
            await updatePalacePracticeFlagApi(reviewPalace.id, { needs_practice: false })
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
