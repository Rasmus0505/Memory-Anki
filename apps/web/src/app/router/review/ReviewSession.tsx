import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
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

function nextOverviewHref(chapterId: number | null) {
  return chapterId == null ? '/review' : `/review?chapterId=${chapterId}`
}

export default function ReviewSession() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const chapterIdParam = searchParams.get('chapterId')
  const chapterId = chapterIdParam ? Number(chapterIdParam) : null
  const [session, setSession] = useState<ReviewScheduleSummary | null>(null)
  const [editorState, setEditorState] = useState<MindMapEditorState | null>(null)
  const [initialSnapshot, setInitialSnapshot] = useState<ReviewFlowSnapshot | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
    setSubmitting(true)
    try {
      await clearReviewSessionProgressApi(session.id)
      const result = await submitReviewSessionApi(session.id, {
        chapter_id: chapterId ?? undefined,
        duration_seconds: payload.durationSeconds,
        completion_mode: payload.completionMode,
        revealed_remaining: payload.revealedRemaining,
        red_marked_count: payload.redNodeIds.length,
      })
      if (result.next_id) {
        const nextHref =
          chapterId == null
            ? `/review/session/${result.next_id}`
            : `/review/session/${result.next_id}?chapterId=${chapterId}`
        navigate(nextHref)
      } else {
        navigate(nextOverviewHref(chapterId))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (!session || !palace || !editorState) {
    return <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">正在加载复习会话...</div>
  }

  return (
    <div className="space-y-5">
      <PageIntro
        eyebrow="正式复习"
        title={palace.title || '未命名宫殿'}
        actions={
          <>
            <Link to={nextOverviewHref(chapterId)}>
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回复习队列
              </Button>
            </Link>
            <Badge variant="secondary">{session.algorithm_used}</Badge>
            <Badge variant="outline">第 {session.review_number + 1} 次</Badge>
          </>
        }
      />

      <div className="space-y-4">
        <Card className="border-border/70 bg-card/92">
          <CardContent className="p-5">
            <MindMapReviewFlow
              title={palace.title || '未命名宫殿'}
              palaceId={palace.id}
              sessionKind="review"
              editorState={editorState}
              submitting={submitting}
              persistProgress
              initialSnapshot={initialSnapshot}
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
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="border-border/70 bg-card/92">
            <CardHeader>
              <CardTitle className="text-base">复习信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div>当前轮次：第 {session.review_number + 1} 次</div>
              <div>计划间隔：{session.interval_days} 天</div>
              <div>本轮不再按“忘记/模糊/记住”改变排程强弱，完成后会固定推进到下一轮。</div>
              <div>如果你提前点击完成，剩余未出现节点会直接揭示并标红，然后立即结束本轮。</div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/92">
            <CardHeader>
              <CardTitle className="text-base">附件</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {palace.attachments.length > 0 ? (
                palace.attachments.map((attachment) => (
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
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border/80 px-3 py-4 text-muted-foreground">
                  没有附件。
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
