import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import type { MindMapEditorState, MiniPalaceSummary } from '@/shared/api/contracts'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { LoadingState } from '@/shared/components/state-placeholders'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  MindMapReviewFlow,
  type ReviewFlowSnapshot,
} from '@/features/review/components/MindMapReviewFlow'
import {
  clearMiniPracticeSessionProgressApi,
  getMiniPracticeSessionProgressApi,
  getPalaceMiniPalaceApi,
  saveMiniPracticeSessionProgressApi,
  updateMiniPalaceReviewProgressApi,
} from '@/shared/api/modules/palaces/structureApi'
import { submitMiniReviewSessionApi } from '@/shared/api/modules/reviews'
import { StageSelectDialog } from '@/features/review/components/StageSelectDialog'

export default function MiniPalacePracticePage() {
  const { id } = useParams()
  const miniPalaceId = id ? Number(id) : null
  const [miniPalace, setMiniPalace] = useState<MiniPalaceSummary | null>(null)
  const [palace, setPalace] = useState<any>(null)
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
    if (!miniPalaceId) return
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const payload = await getPalaceMiniPalaceApi(miniPalaceId)
        setMiniPalace(payload.item)
        setPalace(payload.palace)
        setEditorState({
          editor_doc: payload.editor_doc,
          editor_config: {},
          editor_local_config: {},
          lang: 'zh',
        })
        setEditEditorState({
          editor_doc: payload.palace?.editor_doc ?? payload.editor_doc,
          editor_config: {},
          editor_local_config: {},
          lang: 'zh',
        })
        const progressResponse = await getMiniPracticeSessionProgressApi(miniPalaceId)
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
        setError(err instanceof Error ? err.message : '加载小宫殿练习内容失败。')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [miniPalaceId])

  if (!miniPalaceId || loading) {
    return <LoadingState text="正在加载小宫殿练习内容…" />
  }

  if (!miniPalace || !editorState || error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-destructive">
        {error || '未找到可练习的小宫殿。'}
      </div>
    )
  }

  const title = `${palace?.title || '未命名宫殿'} / ${miniPalace.name}`

  return (
    <div className="space-y-5">
      <PageIntro
        eyebrow="小宫殿练习"
        title={title}
        compact
        actions={
          <>
            <Link to="/palaces">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回书架
              </Button>
            </Link>
            {hasResumeProgress ? (
              <Badge variant="secondary">已接续上次练习</Badge>
            ) : (
              <Badge variant="outline">{miniPalace.node_count} 张</Badge>
            )}
          </>
        }
      />

      <MindMapReviewFlow
        key={`mini-practice-${miniPalace.id}-${flowKey}`}
        title={title}
        palaceId={miniPalace.palace_id}
        sessionKind="practice"
        revealMode="mini-checkpoint"
        checkpointNodeUids={miniPalace.node_uids}
        displayMode={displayMode}
        persistKey={`practice:mini:${miniPalace.id}`}
        reviewEditorState={editorState}
        editEditorState={editEditorState}
        onModeToggle={() =>
          setDisplayMode((current) => (current === 'edit' ? 'review' : 'edit'))
        }
        onEditEditorStateChange={setEditEditorState}
        initialSnapshot={initialSnapshot}
        persistProgress
        onSnapshotChange={async (snapshot) => {
          if (snapshot.completed) {
            setHasResumeProgress(false)
            await clearMiniPracticeSessionProgressApi(miniPalace.id)
            return
          }
          setHasResumeProgress(true)
          await saveMiniPracticeSessionProgressApi(miniPalace.id, {
            completed: snapshot.completed,
            reveal_map: snapshot.revealMap,
            red_node_ids: snapshot.redNodeIds,
          })
        }}
        onRestart={async () => {
          await clearMiniPracticeSessionProgressApi(miniPalace.id)
          setHasResumeProgress(false)
          setInitialSnapshot(null)
        }}
        submitting={submitting}
        onComplete={async (payload) => {
          const scheduleId = miniPalace.current_review_schedule_id
          const hasStages = Boolean(
            miniPalace.stage_labels?.length && miniPalace.review_stages?.length
          )
          if (scheduleId && hasStages) {
            setPendingPayload(payload)
            setStageDialogOpen(true)
            return
          }
          setSubmitting(true)
          try {
            if (miniPalace.review_stage_total != null && miniPalace.review_stage_total > 0) {
              const nextCompleted = (miniPalace.review_stage_completed ?? 0) + 1
              const targetReviewNumber = Math.min(nextCompleted, miniPalace.review_stage_total - 1)
              await updateMiniPalaceReviewProgressApi(miniPalace.id, {
                completed_count: nextCompleted,
                completed_review_number: targetReviewNumber,
              })
            }
            await clearMiniPracticeSessionProgressApi(miniPalace.id)
            setHasResumeProgress(false)
          } finally {
            setSubmitting(false)
          }
        }}
      />

      {miniPalace.stage_labels?.length && miniPalace.review_stages?.length && pendingPayload ? (
        <StageSelectDialog
          open={stageDialogOpen}
          stageLabels={miniPalace.stage_labels}
          stages={miniPalace.review_stages}
          currentReviewNumber={Math.max(0, (miniPalace.review_stage_completed ?? 0) - 1)}
          durationSeconds={pendingPayload?.durationSeconds}
          onConfirm={async (targetReviewNumber, needsPractice) => {
            setStageDialogOpen(false)
            if (!pendingPayload) return
            setSubmitting(true)
            try {
              const scheduleId = miniPalace.current_review_schedule_id
              if (scheduleId) {
                await submitMiniReviewSessionApi(scheduleId, {
                  duration_seconds: pendingPayload.durationSeconds,
                  completion_mode: pendingPayload.completionMode,
                  revealed_remaining: pendingPayload.revealedRemaining,
                  red_marked_count: pendingPayload.redNodeIds.length,
                  target_review_number: targetReviewNumber,
                  needs_practice: needsPractice,
                })
              }
              await clearMiniPracticeSessionProgressApi(miniPalace.id)
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
