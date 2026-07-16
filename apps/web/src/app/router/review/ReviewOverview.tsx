import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Brain, CalendarClock } from 'lucide-react'
import type { ReviewQueueResponse } from '@/shared/api/contracts'
import { getChapterReviewQueueApi, getReviewQueueApi, getReviewSessionApi, getReviewSessionProgressApi } from '@/features/review/api'
import { buildReviewSessionPath } from '@/entities/review'
import { formatDuration } from '@/entities/session/model'
import { prefetchStudySession } from '@/shared/api/studySessionWarmup'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/state-placeholders'
import { ReviewLoadForecastCard } from '@/features/review/components/ReviewLoadForecastCard'

function formatReviewTime(value?: string | null) {
  if (!value) return '现在'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
export default function ReviewOverview() {
  const [searchParams] = useSearchParams()
  const rawChapterId = searchParams.get('chapterId')
  const chapterId = rawChapterId ? Number(rawChapterId) : null
  const [queue, setQueue] = useState<ReviewQueueResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    const request = chapterId ? getChapterReviewQueueApi(chapterId) : getReviewQueueApi()
    void request.then((result) => { if (active) setQueue(result) }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '加载复习队列失败') })
    return () => { active = false }
  }, [chapterId])
  if (error) return <ErrorState title="复习队列加载失败" description={error} />
  if (!queue) return <LoadingState text="正在读取 FSRS 到期节点…" />
  const warm = (id: string | number) => prefetchStudySession('review-session', Number(id), () => Promise.all([getReviewSessionApi(id), getReviewSessionProgressApi(id)]).then(([session, progress]) => ({ session, progress })))
  return (
    <div className="space-y-5">
      <PageIntro eyebrow="FSRS" title={chapterId ? '章节复习' : '今日复习'} description="队列只由节点级 FSRS 到期时间生成；未评分节点会保持到期。" compact />
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">当前到期节点</div><b className="text-2xl">{queue.due_count}</b></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">逾期节点</div><b className="text-2xl">{queue.overdue_count}</b></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">本周复习时长</div><b className="text-2xl">{formatDuration(queue.stats.review_duration_seconds)}</b></CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Brain className="size-5 text-primary" />现在到期（{queue.due_count} 个节点）</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {queue.reviews.length ? queue.reviews.map((review) => <Link key={review.palace_id} to={buildReviewSessionPath(review.palace_id, chapterId)} onFocus={() => warm(review.palace_id)} onMouseEnter={() => warm(review.palace_id)}>
            <div className="flex items-center justify-between gap-4 rounded-2xl border bg-background/80 px-4 py-4 transition hover:border-primary/35">
              <div><div className="font-semibold">{review.palace?.title || '未命名宫殿'}</div><div className="mt-1 text-xs text-muted-foreground">到期 {review.due_node_count} · 逾期 {review.overdue_node_count} · 最早 {formatReviewTime(review.next_due_at ?? review.due_at)}</div></div>
              <Button size="sm">开始复习<ArrowRight className="ml-2 size-4" /></Button>
            </div>
          </Link>) : <EmptyState variant="review" title="今天没有到期的正式复习" description="有节点到期时，FSRS 会自动将宫殿加入这里。" />}
        </CardContent>
      </Card>
      {queue.later_today_reviews.length ? <Card><CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-5 text-warning" />今日稍后到期（{queue.later_today_count} 个节点）</CardTitle></CardHeader><CardContent className="space-y-3">{queue.later_today_reviews.map((review) => <Link key={review.palace_id} to={buildReviewSessionPath(review.palace_id, chapterId)}><div className="flex items-center justify-between rounded-2xl border border-warning/25 bg-warning/5 px-4 py-4"><div><b>{review.palace?.title || '未命名宫殿'}</b><div className="text-xs text-muted-foreground">{formatReviewTime(review.next_due_at ?? review.due_at)} · {review.due_node_count} 个节点</div></div><Button size="sm" variant="outline">提前复习</Button></div></Link>)}</CardContent></Card> : null}
      {!chapterId ? <ReviewLoadForecastCard /> : null}
    </div>
  )
}
