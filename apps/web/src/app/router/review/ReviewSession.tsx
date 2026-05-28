import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  buildAttachmentUrl,
  getPalaceEditorApi,
} from '@/shared/api/modules/palaces'
import {
  clearReviewSessionProgressApi,
  getReviewSessionApi,
  getReviewSessionProgressApi,
  saveReviewSessionProgressApi,
  submitReviewSessionApi,
} from '@/shared/api/modules/reviews'
import type { MindMapEditorState, ReviewScheduleSummary } from '@/shared/api/contracts'
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

function nextOverviewHref(chapterId: number | null) {
  return chapterId == null ? '/review' : `/review?chapterId=${chapterId}`
}

export default function ReviewSession() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const chapterIdParam = searchParams.get('chapterId')
  const chapterId = chapterIdParam ? Number(chapterIdParam) : null
  const [session, setSession] = useState<ReviewScheduleSummary | null>(null)
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
      const data = await getReviewSessionApi(Number(id))
      setSession(data)
      if (data.palace_id) {
        const [editor, progressResponse] = await Promise.all([
          getPalaceEditorApi(data.palace_id),
          getReviewSessionProgressApi(Number(id)),
        ])
        setEditorState({
          editor_doc: editor.editor_doc,
          editor_config: editor.editor_config,
          editor_local_config: editor.editor_local_config,
          lang: editor.lang,
        })
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
    }
    void load()
  }, [id])

  const palace = session?.palace ?? null

  const submitCompletion = async (payload: {
    durationSeconds: number
    completionMode: 'manual_complete' | 'auto_complete'
    revealedRemaining: boolean
    redNodeIds: string[]
  }) => {
    if (!session) return
    await clearReviewSessionProgressApi(session.id)
    if (payload.completionMode === 'auto_complete') {
      setSubmitting(true)
      try {
        await submitReviewSessionApi(session.id, {
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

  const handleStageConfirmWithPractice = async (targetReviewNumber: number, needsPractice: boolean) => {
    if (!session || !pendingPayload) return
    setStageDialogOpen(false)
    setSubmitting(true)
    try {
      await submitReviewSessionApi(session.id, {
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

  if (!session || !palace || !editorState) {
    return <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">正在加载复习会话...</div>
  }

  return (
    <div className="space-y-5">
      {!mindMapFullscreen ? (
        <PageIntro
          eyebrow="正式复习"
          title={palace.title || '未命名宫殿'}
          compact
          actions={
            <>
              <Link to={nextOverviewHref(chapterId)}>
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
          title={palace.title || '未命名宫殿'}
          palaceId={palace.id}
          sessionKind="review"
          editorState={editorState}
          submitting={submitting}
          persistProgress
          initialSnapshot={initialSnapshot}
          onFullscreenChange={setMindMapFullscreen}
          onSnapshotChange={async (snapshot) => {
            if (snapshot.completed) {
              await clearReviewSessionProgressApi(session.id)
              return
            }
            await saveReviewSessionProgressApi(session.id, {
              completed: snapshot.completed,
              reveal_map: snapshot.revealMap,
              red_node_ids: snapshot.redNodeIds,
            })
          }}
          onComplete={submitCompletion}
        />

        {!mindMapFullscreen && palace.attachments.length > 0 ? (
          <Card className="border-border/70 bg-card/92">
            <CardHeader>
              <CardTitle className="text-base">附件</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {palace.attachments.map((attachment) => (
                <a
                  key={attachment.id}
                  href={buildAttachmentUrl(attachment.id)}
                  target="_blank"
                  className="block rounded-2xl border border-border/70 bg-background/70 px-3 py-3 transition-colors hover:text-foreground"
                >
                  <span className="inline-flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    {attachment.original_name}
                  </span>
                </a>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>

      {palace?.stage_labels && palace?.review_stages && (
        <StageSelectDialog
          open={stageDialogOpen}
          stageLabels={palace.stage_labels}
          stages={palace.review_stages}
          currentReviewNumber={session.review_number}
          onConfirm={handleStageConfirmWithPractice}
          onCancel={handleStageCancel}
        />
      )}
    </div>
  )
}
