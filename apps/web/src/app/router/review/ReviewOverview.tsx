import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BookOpen, Brain, CalendarClock, RotateCcw } from 'lucide-react'
import { toast } from '@/shared/feedback/toast'
import type {
  ReviewQueueResponse,
  ReviewStageProgressHealthResponse,
  SpreadOverdueResponse,
} from '@/shared/api/contracts'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { EmptyState, ErrorState } from '@/shared/components/state-placeholders'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  getChapterReviewQueueApi,
  getReviewQueueApi,
  getReviewSessionApi,
  getReviewSessionProgressApi,
  getReviewStageProgressHealthApi,
  previewSpreadOverdueApi,
  repairReviewStageProgressApi,
  spreadOverdueApi,
  undoSpreadOverdueApi,
} from '@/features/review/api'
import { ReviewLoadForecastCard } from '@/features/review/components/ReviewLoadForecastCard'
import { buildReviewSessionPath } from '@/entities/review'
import { prefetchStudySession } from '@/shared/api/studySessionWarmup'

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
  const [spreadPreview, setSpreadPreview] = useState<SpreadOverdueResponse | null>(null)
  const [lastSpreadCount, setLastSpreadCount] = useState(0)
  const [spreadAction, setSpreadAction] = useState<'preview' | 'confirm' | 'undo' | null>(null)
  const [health, setHealth] = useState<ReviewStageProgressHealthResponse | null>(null)
  const [repairing, setRepairing] = useState(false)

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

  useEffect(() => {
    if (chapterId) {
      setHealth(null)
      return
    }
    getReviewStageProgressHealthApi()
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [chapterId])

  const chapterLabel = useMemo(() => {
    if (!queue?.chapter) return null
    if (queue.chapter.subject?.name) return `${queue.chapter.subject.name} / ${queue.chapter.name}`
    return queue.chapter.name
  }, [queue?.chapter])

  const handlePreviewSpread = useCallback(async () => {
    setSpreadAction('preview')
    try {
      setSpreadPreview(await previewSpreadOverdueApi())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '逾期平滑预览失败')
    } finally {
      setSpreadAction(null)
    }
  }, [])

  const handleConfirmSpread = useCallback(async () => {
    setSpreadAction('confirm')
    try {
      const result = await spreadOverdueApi()
      setLastSpreadCount(result.spread)
      setSpreadPreview(null)
      void loadQueue().catch(() => undefined)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '逾期平滑失败')
    } finally {
      setSpreadAction(null)
    }
  }, [loadQueue])

  const handleUndoSpread = useCallback(async () => {
    setSpreadAction('undo')
    try {
      const result = await undoSpreadOverdueApi()
      setLastSpreadCount(0)
      setSpreadPreview(null)
      toast.success(`已恢复 ${result.restored} 项`)
      void loadQueue().catch(() => undefined)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '撤销逾期平滑失败')
    } finally {
      setSpreadAction(null)
    }
  }, [loadQueue])

  const handleRepairStageProgress = useCallback(async () => {
    setRepairing(true)
    try {
      const result = await repairReviewStageProgressApi()
      toast.success(`修复完成：重建 ${result.palace_count} 个宫殿`)
      setHealth(await getReviewStageProgressHealthApi())
      await loadQueue()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '修复失败，请稍后重试')
    } finally {
      setRepairing(false)
    }
  }, [loadQueue])

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
            {!chapterId && queue.overdue_count > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={spreadAction !== null}
                onClick={() => void handlePreviewSpread()}
              >
                <CalendarClock className="mr-2 size-4" />
                平滑逾期（{queue.overdue_count}）
              </Button>
            ) : null}
          </>
        }
      />

      {spreadPreview ? (
        <Card className="memory-anki-warm-panel memory-anki-surface-glow border-border/60 bg-card/90">
          <CardHeader>
            <CardTitle className="text-base">确认平滑逾期</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>将把 {spreadPreview.spread} 项逾期复习分摊到未来 7 天，最早的排在最前。</p>
            {spreadPreview.moves.length > 0 ? (
              <ul className="space-y-2">
                {spreadPreview.moves.slice(0, 5).map((move) => (
                  <li key={move.schedule_id} className="rounded-md border border-border/60 bg-background/70 px-3 py-2">
                    <span className="font-medium text-foreground">{move.palace_title || `宫殿 ${move.palace_id}`}</span>
                    <span className="ml-2">{move.old_date} → {move.new_date}</span>
                  </li>
                ))}
                {spreadPreview.moves.length > 5 ? (
                  <li className="px-3 text-xs">...等 {spreadPreview.moves.length} 项</li>
                ) : null}
              </ul>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={spreadAction !== null}
                onClick={() => setSpreadPreview(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={spreadAction !== null || spreadPreview.spread <= 0}
                onClick={() => void handleConfirmSpread()}
              >
                <CalendarClock className="mr-2 size-4" />
                确认平滑
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {health?.needs_repair ? (
        <Card className="memory-anki-warm-panel memory-anki-surface-glow border-warning/45 bg-warning/10">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm font-medium text-amber-800 dark:text-amber-200">
            <span className="min-w-0 flex-1">
              检测到 {health.total_issues} 处复习进度异常（孤儿进度 {health.orphan_progress_count}、
              孤儿会话 {health.orphan_study_session_count}、阶段断档 {health.stage_gap_palace_count}），建议立即修复。
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-warning/40 bg-background/80 text-amber-800 hover:bg-warning/15 dark:text-amber-200"
              disabled={repairing}
              onClick={() => void handleRepairStageProgress()}
            >
              {repairing ? '修复中...' : '一键修复'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {queue.smoothed_count > 0 || lastSpreadCount > 0 ? (
        <Card className="memory-anki-warm-panel memory-anki-surface-glow border-border/60 bg-card/90">
          <CardContent className="flex items-center justify-between gap-3 p-4 text-sm text-muted-foreground">
            <span>系统已将 {lastSpreadCount || queue.smoothed_count} 项逾期任务平滑到后续日期。</span>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">已平滑</Badge>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={spreadAction !== null}
                onClick={() => void handleUndoSpread()}
              >
                <RotateCcw className="mr-2 size-4" />
                撤销
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="memory-anki-warm-panel memory-anki-surface-glow border-border/70 bg-card/90">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg tracking-tight">待处理任务</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {queue.reviews.length > 0 ? (
            queue.reviews.map((review) => (
              <Link
                key={review.id}
                to={buildReviewSessionPath(review.id, chapterId)}
                onFocus={() => prefetchStudySession('review-session', review.id, () => Promise.all([getReviewSessionApi(review.id), getReviewSessionProgressApi(review.id)]).then(([session, progress]) => ({ session, progress })))}
                onMouseEnter={() => prefetchStudySession('review-session', review.id, () => Promise.all([getReviewSessionApi(review.id), getReviewSessionProgressApi(review.id)]).then(([session, progress]) => ({ session, progress })))}
              >
                <div className="memory-anki-soft-card flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-background/80 px-4 py-4 transition-all hover:-translate-y-[1px] hover:border-primary/35 hover:bg-secondary/75">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Brain className="size-4 shrink-0 text-primary" />
                      <span className="truncate font-semibold text-foreground">{review.palace?.title || '未命名宫殿'}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{formatReviewStage(review.review_type, review.review_number)}</span>
                      <span>间隔 {review.interval_days} 天</span>
                      {review.schedule_count > 1 ? <span>累计 {review.schedule_count} 次待复习</span> : <span>1 个宫殿复习对象</span>}
                      {review.overdue_schedule_count > 0 ? <span>{review.overdue_schedule_count} 次已逾期</span> : null}
                    </div>
                  </div>
                  <Button size="sm" className="shrink-0 shadow-sm">
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

      {!chapterId ? <ReviewLoadForecastCard /> : null}
    </div>
  )
}
