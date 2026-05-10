import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  BatchSegmentReviewSessionResponse,
  MindMapEditorState,
} from '@/shared/api/contracts'
import {
  createBatchSegmentReviewSessionApi,
  submitBatchSegmentReviewSessionApi,
} from '@/shared/api/modules/reviews'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { MindMapReviewFlow } from '@/features/review/components/MindMapReviewFlow'

function parseSegmentIds(searchParams: URLSearchParams): number[] {
  const raw = searchParams.get('segmentIds') || ''
  const items = raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0)
  return Array.from(new Set(items))
}

export default function BatchSegmentReviewSessionPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const segmentIds = useMemo(() => parseSegmentIds(searchParams), [searchParams])
  const [session, setSession] = useState<BatchSegmentReviewSessionResponse | null>(null)
  const [editorState, setEditorState] = useState<MindMapEditorState | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (segmentIds.length === 0) {
      setError('未选择可复习分块。')
      return
    }
    let active = true
    const load = async () => {
      try {
        setError('')
        const data = await createBatchSegmentReviewSessionApi({
          segment_ids: segmentIds,
        })
        if (!active) return
        setSession(data)
        setEditorState({
          editor_doc: data.editor_doc,
          editor_config: {},
          editor_local_config: {},
          lang: 'zh',
        })
      } catch (nextError) {
        if (!active) return
        setError(nextError instanceof Error ? nextError.message : '加载多块复习会话失败')
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [segmentIds])

  const segmentNameSummary = useMemo(() => {
    if (!session?.segments?.length) return ''
    return session.segments.map((segment) => segment.display_name || segment.name || `分块 ${segment.id}`).join('、')
  }, [session])

  const submitCompletion = async (payload: {
    durationSeconds: number
    completionMode: 'manual_complete' | 'auto_complete'
    revealedRemaining: boolean
    redNodeIds: string[]
  }) => {
    setSubmitting(true)
    try {
      await submitBatchSegmentReviewSessionApi({
        segment_ids: segmentIds,
        duration_seconds: payload.durationSeconds,
        completion_mode: payload.completionMode,
        revealed_remaining: payload.revealedRemaining,
        red_marked_count: payload.redNodeIds.length,
      })
      navigate('/review')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '提交多块复习失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (error && (!session || !editorState)) {
    return (
      <div className="space-y-4">
        <PageIntro
          eyebrow="分块正式复习"
          title="多块复习"
          actions={
            <Link to="/review">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回复习队列
              </Button>
            </Link>
          }
        />
        <Card className="border-border/70 bg-card/92">
          <CardContent className="p-8 text-sm text-destructive">{error}</CardContent>
        </Card>
      </div>
    )
  }

  if (!session || !editorState) {
    return <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">正在加载多块复习会话...</div>
  }

  return (
    <div className="space-y-5">
      <PageIntro
        eyebrow="分块正式复习"
        title={`${session.palace?.title || '未命名宫殿'} / 多块复习`}
        actions={
          <>
            <Link to="/review">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回复习队列
              </Button>
            </Link>
            <Badge variant="secondary">{session.segments.length} 个分块</Badge>
          </>
        }
      />

      {error ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      <div className="space-y-4">
        <Card className="border-border/70 bg-card/92">
          <CardContent className="p-5">
            <MindMapReviewFlow
              title={`${session.palace?.title || '未命名宫殿'} / 多块复习`}
              palaceId={session.palace?.id ?? null}
              sessionKind="review"
              editorState={editorState}
              submitting={submitting}
              onComplete={submitCompletion}
            />
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/92">
          <CardHeader>
            <CardTitle className="text-base">复习信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div>当前宫殿：{session.palace?.title || '未命名宫殿'}</div>
            <div>选中分块：{segmentNameSummary}</div>
            <div>预计复习时长：{session.estimated_review_seconds ?? 0} 秒</div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
