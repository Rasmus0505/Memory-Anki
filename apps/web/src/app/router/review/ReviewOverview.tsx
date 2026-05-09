import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BookOpen, Brain } from 'lucide-react'
import type { ReviewQueueResponse } from '@/shared/api/contracts'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { getChapterReviewQueueApi, getReviewQueueApi } from '@/shared/api/modules/reviews'

function formatReviewStage(reviewType: string, reviewNumber: number) {
  if (reviewType === '1h') return '首日 1 小时'
  if (reviewType === 'sleep') return '首日睡前'
  return `第 ${reviewNumber + 1} 次`
}

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
      const nextQueue = chapterId ? await getChapterReviewQueueApi(chapterId) : await getReviewQueueApi()
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

  const title = chapterLabel ? `章节复习：${chapterLabel}` : `今日复习队列：${queue.due_count}`

  return (
    <div className="space-y-6">
      <PageIntro
        title={title}
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

      <Card className="border-border/70 bg-card/92">
        <CardHeader>
          <CardTitle className="text-base">待处理任务</CardTitle>
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
                      <span>{formatReviewStage(review.review_type, review.review_number)}</span>
                      <span>间隔 {review.interval_days} 天</span>
                      {review.schedule_count > 1 ? <span>累计 {review.schedule_count} 次待复习</span> : <span>1 个宫殿复习对象</span>}
                      {review.overdue_schedule_count > 0 ? <span>{review.overdue_schedule_count} 次已逾期</span> : null}
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
    </div>
  )
}
