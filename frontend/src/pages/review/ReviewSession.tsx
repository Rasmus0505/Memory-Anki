import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, FileText } from 'lucide-react'
import { api, type ReviewScheduleSummary } from '@/api/client'
import { PageIntro } from '@/components/layout/PageIntro'
import { MindMapReviewFlow } from '@/components/review/MindMapReviewFlow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useEffect, useState } from 'react'

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
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!id) return
    const load = async () => {
      const data = await api.getReviewSession(Number(id))
      setSession(data)
    }
    void load()
  }, [id])

  const palace = session?.palace ?? null

  const submit = async (rating: 'forgot' | 'fuzzy' | 'remembered') => {
    if (!session) return
    setSubmitting(true)
    try {
      const result = await api.submitReviewSession(session.id, {
        rating,
        chapter_id: chapterId ?? undefined,
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

  if (!session || !palace) {
    return <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">正在加载复习会话...</div>
  }

  return (
    <div className="space-y-5">
      <PageIntro
        eyebrow="正式复习"
        title={palace.title || '未命名宫殿'}
        description="这次评分会写入正式复习记录，并按照当前算法推进后续复习计划。"
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="border-border/70 bg-card/92">
          <CardContent className="p-5">
            <MindMapReviewFlow
              title={palace.title || '未命名宫殿'}
              description={palace.description}
              editorDoc={palace.editor_doc}
              submitting={submitting}
              onSubmit={submit}
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border/70 bg-card/92">
            <CardHeader>
              <CardTitle className="text-base">复习信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div>算法：{session.algorithm_used}</div>
              <div>当前轮次：第 {session.review_number + 1} 次</div>
              <div>计划间隔：{session.interval_days} 天</div>
              <div>本次提交会影响正式排程，并决定下一次到期时间。</div>
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
                    href={`/api/attachments/${attachment.id}`}
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
