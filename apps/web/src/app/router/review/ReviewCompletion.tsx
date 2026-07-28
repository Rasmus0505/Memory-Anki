import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2, Library } from 'lucide-react'
import {
  getUnitReviewCompletionApi,
  type UnitReviewCompletionDto,
} from '@/modules/practice/public'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { ErrorState, LoadingState } from '@/shared/components/state-placeholders'

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return minutes > 0 ? `${minutes}分${remainder}秒` : `${remainder}秒`
}

function formatDate(value: string | null) {
  if (!value) return '暂无安排'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}

export default function ReviewCompletion() {
  const { reviewLogId: sessionId = '' } = useParams()
  const [result, setResult] = useState<UnitReviewCompletionDto | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void getUnitReviewCompletionApi(sessionId)
      .then((response) => {
        if (active) setResult(response)
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '加载复习结算失败')
      })
    return () => {
      active = false
    }
  }, [sessionId])

  if (error) return <ErrorState title="结算加载失败" description={error} />
  if (!result) return <LoadingState text="正在加载单元复习结算…" />

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-6">
      <Card className="border-success/40 bg-card/95">
        <CardHeader className="text-center">
          <CheckCircle2 className="mx-auto size-12 text-success" />
          <CardTitle className="text-2xl">本次单元复习已完成</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-4">
              <div className="text-xs text-muted-foreground">完成单元</div>
              <b className="text-xl">{result.completed_unit_count}</b>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-xs text-muted-foreground">总用时</div>
              <b className="text-xl">{formatDuration(result.duration_seconds)}</b>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-xs text-muted-foreground">困难 / 忘记重练</div>
              <b className="text-xl">{result.hard_retry_count} / {result.again_retry_count}</b>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-xs text-muted-foreground">最近下次复习</div>
              <b className="text-xl">{formatDate(result.next_review_date)}</b>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-center">
        <Button asChild>
          <Link to="/library">
            <Library className="mr-2 size-4" />返回知识书架
          </Link>
        </Button>
      </div>
    </div>
  )
}
