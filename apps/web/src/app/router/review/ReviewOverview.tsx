import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BookOpen, Brain } from 'lucide-react'
import type { ReviewQueueResponse } from '@/shared/api/contracts'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { EmptyState, ErrorState } from '@/shared/components/state-placeholders'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  getChapterReviewQueueApi,
  getReviewQueueApi,
} from '@/features/review/api'
import { buildReviewSessionPath } from '@/features/review/reviewSessionRoutes'
import { prefetchStudySession } from '@/features/review/studyWarmup'

function formatReviewStage(reviewType: string, reviewNumber: number) {
  if (reviewType === '1h') return '首日 1 小时'
  if (reviewType === 'sleep') return '首日睡前'
  return `第 ${reviewNumber + 1} 次`
}

function ReviewQueueSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>

      <Card className="memory-anki-warm-panel border-border/60 bg-card/90">
        <CardHeader>
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-background/80 px-4 py-4"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

export default function ReviewOverview() {
  const [searchParams] = useSearchParams()
  const chapterIdParam = searchParams.get('chapterId')
  const chapterId = chapterIdParam ? Number(chapterIdParam) : null
  const [queue, setQueue] = useState<ReviewQueueResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadQueue = useCallback(async () => {
    setLoadError(null)
    setQueue(null)
    try {
      const nextQueue = chapterId ? await getChapterReviewQueueApi(chapterId) : await getReviewQueueApi()
      setQueue(nextQueue)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '加载复习队列失败。')
      throw error
    }
  }, [chapterId])

  useEffect(() => {
    void loadQueue().catch(() => undefined)
  }, [loadQueue])

  const chapterLabel = useMemo(() => {
    if (!queue?.chapter) return null
    if (queue.chapter.subject?.name) return `${queue.chapter.subject.name} / ${queue.chapter.name}`
    return queue.chapter.name
  }, [queue?.chapter])

  if (loadError) {
    return (
      <ErrorState
        title="复习队列加载失败"
        description={loadError}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => void loadQueue().catch(() => undefined)}>
            重新加载
          </Button>
        }
      />
    )
  }

  if (!queue) {
    return <ReviewQueueSkeleton />
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
                  <ArrowLeft className="mr-2 size-4" />
                  返回总览
                </Button>
              </Link>
            ) : null}
          </>
        }
      />

      {queue.smoothed_count > 0 ? (
        <Card className="memory-anki-warm-panel memory-anki-surface-glow border-border/60 bg-card/90">
          <CardContent className="flex items-center justify-between gap-3 p-4 text-sm text-muted-foreground">
            <span>系统已将 {queue.smoothed_count} 项逾期任务自动平滑到后续日期。</span>
            <Badge variant="secondary">已平滑</Badge>
          </CardContent>
        </Card>
      ) : null}

      <Card className="memory-anki-warm-panel memory-anki-surface-glow border-border/60 bg-card/90">
        <CardHeader>
          <CardTitle className="text-base">待处理任务</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {queue.reviews.length > 0 ? (
            queue.reviews.map((review) => (
              <Link
                key={review.id}
                to={buildReviewSessionPath(review.id, chapterId)}
                onFocus={() => prefetchStudySession('review-session', review.id)}
                onMouseEnter={() => prefetchStudySession('review-session', review.id)}
              >
                <div className="memory-anki-soft-card flex items-center justify-between rounded-[24px] border border-border/60 bg-background/80 px-4 py-4 transition-all hover:-translate-y-[1px] hover:bg-secondary/75">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Brain className="size-4 text-muted-foreground" />
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
                    <ArrowRight className="ml-2 size-4" />
                  </Button>
                </div>
              </Link>
            ))
          ) : (
            <EmptyState
              variant="review"
              title={chapterId ? '这个章节今天不用正式复习' : '今天没有到期的正式复习'}
              description={
                chapterId
                  ? '可以回到知识树继续学习，或稍后再来查看新的复习计划。'
                  : '可以继续学习新内容；有知识点到期时，复习任务会自动出现在这里。'
              }
              action={
                !chapterId ? (
                  <Link to="/knowledge">
                    <Button variant="outline" size="sm">
                      <BookOpen className="mr-2 size-4" />
                      前往知识树查看章节
                    </Button>
                  </Link>
                ) : null
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
