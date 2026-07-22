import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2, ListChecks, PlayCircle } from 'lucide-react'
import {
  formatLastReviewDetailLabel,
  formatNextReviewDetailLabel,
  formatReviewAbsolute,
} from '@/entities/review/model/reviewScheduleFormat'
import { MasteryDeltaBadge } from '@/features/review/components/MasteryDeltaBadge'
import { getReviewCompletionApi } from '@/features/review/api'
import type { ReviewSessionSubmitResponse } from '@/shared/api/contracts'
import { formatDuration } from '@/entities/session/model'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { ErrorState, LoadingState } from '@/shared/components/state-placeholders'

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
  if (error) return <ErrorState title="完成记录加载失败" description={error} />
  if (!result) return <LoadingState text="正在加载复习完成结果…" />

  const nextNodeCount = result.next_review_node_count ?? result.remaining_due_node_count
  const tertiaryBits: string[] = []
  if (result.unrated_due_node_count > 0) {
    tertiaryBits.push(`本次未评分 ${result.unrated_due_node_count} 个到期节点保持到期`)
  }
  if ((result.out_of_scope_due_node_count ?? 0) > 0) {
    tertiaryBits.push(`仍有 ${result.out_of_scope_due_node_count} 个到期节点尚未并入本次`)
  }
  if (result.today_review_count && result.today_review_count > 0) {
    tertiaryBits.push(`该宫殿今日第 ${result.today_review_count} 次复习`)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-6">
      <Card className="border-success/40 bg-card/95">
        <CardHeader className="text-center">
          <CheckCircle2 className="mx-auto size-12 text-success" />
          <CardTitle className="text-2xl">本次 FSRS 复习已完成</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-4">
              <div className="text-xs text-muted-foreground">有效时长</div>
              <b className="text-xl">{formatDuration(result.duration_seconds)}</b>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-xs text-muted-foreground">本次评分</div>
              <b className="text-xl">
                {result.rated_node_count}/{result.scope_node_count}
              </b>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-xs text-muted-foreground">掌握 / 记忆</div>
              <b className="inline-flex items-baseline text-xl">
                <span>{result.mastery_percent}%</span>
                <MasteryDeltaBadge
                  current={result.mastery_percent}
                  previous={result.previous_mastery_percent}
                />
                <span className="mx-1 text-base text-muted-foreground">/</span>
                <span>{result.memory_health_percent}%</span>
              </b>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center text-sm">
            {Object.entries(
              result.rating_counts ?? { 忘记: 0, 困难: 0, 记得: 0, 轻松: 0 },
            ).map(([label, count]) => (
              <div key={label} className="rounded-lg border p-3">
                <div>{label}</div>
                <b className="text-lg">{count}</b>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-4">
              <div className="text-xs text-muted-foreground">上次复习</div>
              <b className="mt-0.5 block">
                {result.last_review_at ? formatReviewAbsolute(result.last_review_at) : '—'}
              </b>
              <div className="mt-1 text-sm text-muted-foreground">
                {formatLastReviewDetailLabel(result.last_review_at)}
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-xs text-muted-foreground">下次复习</div>
              <b className="mt-0.5 block">{formatReviewAbsolute(result.next_review_at)}</b>
              <div className="mt-1 text-sm text-muted-foreground">
                {formatNextReviewDetailLabel({
                  nextReviewAt: result.next_review_at,
                  nextReviewNodeCount: nextNodeCount,
                  nextReviewEntryMode: result.next_review_entry_mode,
                  nextReviewEntryLabel: result.next_review_entry_label,
                })}
              </div>
            </div>
          </div>
          {tertiaryBits.length > 0 ? (
            <div className="text-xs text-muted-foreground">{tertiaryBits.join('；')}。</div>
          ) : null}
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
            复习队列
          </Link>
        </Button>
      </div>
    </div>
  )
}
