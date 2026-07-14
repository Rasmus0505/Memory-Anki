import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2, ListChecks, PlayCircle } from 'lucide-react'
import { getReviewCompletionApi } from '@/features/review/api'
import type { ReviewSessionSubmitResponse } from '@/shared/api/contracts'
import { formatDuration } from '@/entities/session/model'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { ErrorState, LoadingState } from '@/shared/components/state-placeholders'

function formatNextReview(value: string | null) {
  if (!value) return '已完成全部阶段'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('zh-CN')
}

export default function ReviewCompletion() {
  const { reviewLogId } = useParams()
  const [result, setResult] = useState<ReviewSessionSubmitResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const id = Number(reviewLogId)
    if (!Number.isInteger(id) || id <= 0) {
      setError('复习完成记录编号无效。')
      return
    }
    let active = true
    void getReviewCompletionApi(id)
      .then((response) => {
        if (active) setResult(response)
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '加载复习完成记录失败。')
      })
    return () => {
      active = false
    }
  }, [reviewLogId])

  if (error) {
    return <ErrorState title="完成记录加载失败" description={error} />
  }
  if (!result) {
    return <LoadingState text="正在加载复习完成结果…" />
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-6">
      <Card className="border-success/40 bg-card/95">
        <CardHeader className="text-center">
          <CheckCircle2 className="mx-auto size-12 text-success" />
          <CardTitle className="text-2xl">本次复习已完成</CardTitle>
          <div className="flex justify-center gap-2">
            {result.mastered ? <Badge variant="secondary">已掌握</Badge> : null}
            {result.needs_practice ? <Badge variant="warning">仍需练习</Badge> : null}
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <div className="text-xs text-muted-foreground">本次有效时长</div>
            <div className="mt-1 text-xl font-semibold">{formatDuration(result.duration_seconds)}</div>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <div className="text-xs text-muted-foreground">复习阶段</div>
            <div className="mt-1 text-xl font-semibold">
              {result.completed_stage_count}/{result.total_stage_count}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              已完成：{result.completed_stage_label ?? '当前阶段'}
            </div>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-4 sm:col-span-2">
            <div className="text-xs text-muted-foreground">下次复习</div>
            <div className="mt-1 font-medium">{formatNextReview(result.next_review_at)}</div>
            {result.next_stage_label ? (
              <div className="mt-1 text-xs text-muted-foreground">下一阶段：{result.next_stage_label}</div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        {result.next_id ? (
          <Button asChild>
            <Link to={`/review/session/${result.next_id}`}>
              <PlayCircle className="mr-2 size-4" />
              下一条复习
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link to="/review">
            <ListChecks className="mr-2 size-4" />
            返回复习队列
          </Link>
        </Button>
      </div>
    </div>
  )
}
