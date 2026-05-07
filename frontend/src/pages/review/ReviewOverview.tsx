import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BookOpen, Brain, Sparkles } from 'lucide-react'
import { api, type ReviewQueueResponse } from '@/api/client'
import { PageIntro } from '@/components/layout/PageIntro'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

function formatSessionHref(reviewId: number, chapterId: number | null) {
  if (chapterId == null) return `/review/session/${reviewId}`
  return `/review/session/${reviewId}?chapterId=${chapterId}`
}

export default function ReviewOverview() {
  const [searchParams] = useSearchParams()
  const chapterIdParam = searchParams.get('chapterId')
  const chapterId = chapterIdParam ? Number(chapterIdParam) : null
  const [queue, setQueue] = useState<ReviewQueueResponse | null>(null)

  useEffect(() => {
    const load = async () => {
      const nextQueue = chapterId ? await api.getChapterReviewQueue(chapterId) : await api.getReviewQueue()
      setQueue(nextQueue)
    }
    void load()
  }, [chapterId])

  const chapterLabel = useMemo(() => {
    if (!queue?.chapter) return null
    if (queue.chapter.subject?.name) return `${queue.chapter.subject.name} / ${queue.chapter.name}`
    return queue.chapter.name
  }, [queue?.chapter])

  if (!queue) {
    return <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">正在加载复习队列...</div>
  }

  const title = chapterLabel ? `章节复习：${chapterLabel}` : '今日复习队列'
  const description = chapterLabel
    ? '这里只展示当前章节下已经到期的正式复习任务。'
    : '从今天到期的正式复习队列开始，完成后会自动推进后续排程。'

  return (
    <div className="space-y-6">
      <PageIntro
        eyebrow="复习"
        title={title}
        description={description}
        actions={
          <>
            {chapterId ? (
              <Link to="/review">
                <Button variant="outline" size="sm">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  返回总览
                </Button>
              </Link>
            ) : null}
            <Badge variant="secondary">{queue.due_count} 项待复习</Badge>
          </>
        }
      />

      {queue.smoothed_count > 0 ? (
        <Card className="border-border/70 bg-card/92">
          <CardContent className="flex items-center justify-between gap-3 p-4 text-sm text-muted-foreground">
            <span>系统已将 {queue.smoothed_count} 项逾期任务自动平滑到后续日期。</span>
            <Badge variant="secondary">已平滑</Badge>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/70 bg-card/92">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">今日到期</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{queue.due_count}</div>
            <p className="mt-2 text-xs text-muted-foreground">今天需要完成的正式宫殿复习任务。</p>
          </CardContent>
        </Card>
        <Card className="border-border/70 bg-card/92">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">逾期任务</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-semibold ${queue.overdue_count > 0 ? 'text-destructive' : ''}`}>{queue.overdue_count}</div>
            <p className="mt-2 text-xs text-muted-foreground">已超过计划日期、尚未完成的复习任务数量。</p>
          </CardContent>
        </Card>
        <Card className="border-border/70 bg-card/92">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">本周完成率</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{queue.stats.completion_rate}%</div>
            <p className="mt-2 text-xs text-muted-foreground">
              本周已完成 {queue.stats.completed} / {queue.stats.total} 次正式复习。
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 bg-card/92">
        <CardHeader>
          <CardTitle className="text-base">待处理任务</CardTitle>
          <CardDescription>正式复习会使用“先回忆，再按主分支逐条揭示”的导图复习流程。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {queue.reviews.length > 0 ? (
            queue.reviews.map((review) => (
              <Link key={review.id} to={formatSessionHref(review.id, chapterId)}>
                <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/70 px-4 py-4 transition-colors hover:bg-secondary/70">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Brain className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate font-medium">{review.palace?.title || '未命名宫殿'}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">{review.algorithm_used}</Badge>
                      <span>第 {review.review_number + 1} 次</span>
                      <span>间隔 {review.interval_days} 天</span>
                      <span>{review.palace?.chapters.length || 0} 个关联章节</span>
                    </div>
                  </div>
                  <Button size="sm">
                    开始复习
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </Link>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-border/80 px-4 py-8 text-center text-sm text-muted-foreground">
              {chapterId ? '当前章节暂时没有到期的正式复习任务。' : '当前没有需要处理的正式复习任务。'}
              {!chapterId ? (
                <div className="mt-3">
                  <Link to="/knowledge">
                    <Button variant="outline" size="sm">
                      <BookOpen className="mr-2 h-4 w-4" />
                      前往知识树查看章节
                    </Button>
                  </Link>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/92">
        <CardHeader>
          <CardTitle className="text-base">说明</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            <span>每次正式复习都会从中心主题开始，再按主分支顺序逐条揭示。</span>
          </div>
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            <span>只有在所有主分支都揭示完成后，才允许提交正式评分。</span>
          </div>
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            <span>从章节专题进入复习时，会保留当前章节上下文并继续在该范围内推进任务。</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
