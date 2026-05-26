import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import {
  clearSegmentReviewSessionProgressApi,
  getSegmentReviewSessionApi,
  getSegmentReviewSessionProgressApi,
  saveSegmentReviewSessionProgressApi,
  submitSegmentReviewSessionApi,
} from '@/shared/api/modules/reviews'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import {
  MindMapReviewFlow,
  type ReviewFlowSnapshot,
} from '@/features/review/components/MindMapReviewFlow'
import { StageSelectDialog } from '@/features/review/components/StageSelectDialog'

function formatReviewStage(reviewType: string, reviewNumber: number) {
  if (reviewType === '1h') return '首日 1 小时'
  if (reviewType === 'sleep') return '首日睡前'
  return `第 ${reviewNumber + 1} 次`
}

function getSegmentDisplayName(session: any) {
  return session?.segment?.display_name || session?.segment?.name || '未命名分块'
}

export default function SegmentReviewSessionPage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const chapterIdParam = searchParams.get('chapterId')
  const chapterId = chapterIdParam ? Number(chapterIdParam) : null
  const [session, setSession] = useState<any | null>(null)
  const [editorState, setEditorState] = useState<MindMapEditorState | null>(null)
  const [initialSnapshot, setInitialSnapshot] = useState<ReviewFlowSnapshot | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [mindMapFullscreen, setMindMapFullscreen] = useState(false)
  const [stageDialogOpen, setStageDialogOpen] = useState(false)
  const [pendingPayload, setPendingPayload] = useState<{
    durationSeconds: number
    completionMode: 'manual_complete' | 'auto_complete'
    revealedRemaining: boolean
    redNodeIds: string[]
  } | null>(null)

  useEffect(() => {
    if (!id) return
    const load = async () => {
      const data = await getSegmentReviewSessionApi(Number(id))
      setSession(data)
      setEditorState({
        editor_doc: data.editor_doc,
        editor_config: {},
        editor_local_config: {},
        lang: 'zh',
      })
      const progressResponse = await getSegmentReviewSessionProgressApi(Number(id))
      const progress = progressResponse.progress
      setInitialSnapshot(
        progress && !progress.completed
          ? {
              revealMap: progress.reveal_map,
              redNodeIds: progress.red_node_ids,
              completed: progress.completed,
            }
          : null,
      )
    }
    void load()
  }, [id])

  const submitCompletion = async (payload: {
    durationSeconds: number
    completionMode: 'manual_complete' | 'auto_complete'
    revealedRemaining: boolean
    redNodeIds: string[]
  }) => {
    if (!session) return
    await clearSegmentReviewSessionProgressApi(session.id)
    if (payload.completionMode === 'auto_complete') {
      setSubmitting(true)
      try {
        await submitSegmentReviewSessionApi(session.id, {
          chapter_id: chapterId ?? undefined,
          duration_seconds: payload.durationSeconds,
          completion_mode: payload.completionMode,
          revealed_remaining: payload.revealedRemaining,
          red_marked_count: payload.redNodeIds.length,
        })
      } finally {
        setSubmitting(false)
      }
      return
    }
    setPendingPayload(payload)
    setStageDialogOpen(true)
  }

  const handleStageConfirm = async (targetReviewNumber: number, needsPractice: boolean) => {
    if (!session || !pendingPayload) return
    setStageDialogOpen(false)
    setSubmitting(true)
    try {
      await submitSegmentReviewSessionApi(session.id, {
        chapter_id: chapterId ?? undefined,
        duration_seconds: pendingPayload.durationSeconds,
        completion_mode: pendingPayload.completionMode,
        revealed_remaining: pendingPayload.revealedRemaining,
        red_marked_count: pendingPayload.redNodeIds.length,
        target_review_number: targetReviewNumber,
        needs_practice: needsPractice,
      })
    } finally {
      setSubmitting(false)
      setPendingPayload(null)
    }
  }

  const handleStageCancel = () => {
    setStageDialogOpen(false)
    setPendingPayload(null)
  }

  if (!session || !editorState) {
    return <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">正在加载分块复习会话...</div>
  }

  const segmentDisplayName = getSegmentDisplayName(session)

  return (
    <div className="space-y-5">
      {!mindMapFullscreen ? (
        <PageIntro
          eyebrow="分块正式复习"
          title={`${session.palace?.title || '未命名宫殿'} / ${segmentDisplayName}`}
          actions={
            <>
              <Link to="/review">
                <Button variant="outline" size="sm">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  返回复习队列
                </Button>
              </Link>
              <Badge variant="secondary">{session.algorithm_used}</Badge>
              <Badge variant="outline">{formatReviewStage(session.review_type, session.review_number)}</Badge>
            </>
          }
        />
      ) : null}

      <div className="space-y-4">
        <MindMapReviewFlow
          title={`${session.palace?.title || '未命名宫殿'} / ${segmentDisplayName}`}
          palaceId={session.palace_id}
          sessionKind="review"
          editorState={editorState}
          submitting={submitting}
          persistProgress
          initialSnapshot={initialSnapshot}
          onFullscreenChange={setMindMapFullscreen}
          onSnapshotChange={async (snapshot) => {
            if (snapshot.completed) {
              await clearSegmentReviewSessionProgressApi(session.id)
              return
            }
            await saveSegmentReviewSessionProgressApi(session.id, {
              completed: snapshot.completed,
              reveal_map: snapshot.revealMap,
              red_node_ids: snapshot.redNodeIds,
            })
          }}
          onComplete={submitCompletion}
        />

        {!mindMapFullscreen ? (
          <Card className="border-border/70 bg-card/92">
            <CardHeader>
              <CardTitle className="text-base">复习信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div>当前分块：{segmentDisplayName}</div>
              <div>计划间隔：{session.interval_days} 天</div>
              <div>预计复习时长：{session.estimated_review_seconds ?? 0} 秒</div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {session.segment?.stage_labels && session.segment?.review_stages && (
        <StageSelectDialog
          open={stageDialogOpen}
          stageLabels={session.segment.stage_labels}
          stages={session.segment.review_stages}
          currentReviewNumber={session.review_number}
          onConfirm={handleStageConfirm}
          onCancel={handleStageCancel}
        />
      )}
    </div>
  )
}
