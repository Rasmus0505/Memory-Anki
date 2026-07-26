import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { CalendarCheck2, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react'
import type { ReviewTodayPlan } from '@/shared/api/contracts'
import { getReviewTodayPlanApi } from '@/modules/practice/ui/review/api/scheduleInsightApi'
import {
  reviewInsightQueryKeys,
  useReviewInsightInvalidation,
  useReviewInsightQueryClient,
} from '@/modules/practice/ui/review/hooks/reviewInsightQueries'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { cn } from '@/shared/lib/utils'

export function formatDeferReason(reason: string | null | undefined): string {
  if (!reason) return '已顺延'
  if (reason === 'over_review_quota') return '今日复习额度已满'
  if (reason === 'over_new_quota') return '今日新学额度已满'
  return reason
}

function ProgressBar({ done, total, className }: { done: number; total: number; className?: string }) {
  const percent = total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : 0
  return (
    <div className="h-2 overflow-hidden rounded-full bg-secondary">
      <div
        className={cn('h-full rounded-full bg-primary transition-[width]', className)}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

/**
 * 今日任务卡：复习/新学双额度进度、打卡完成态、顺延明细与 backlog 提示。
 * 放在复习队列页顶部。
 */
export function TodayPlanCard() {
  const queryClient = useReviewInsightQueryClient()
  useReviewInsightInvalidation(queryClient)
  const [deferredOpen, setDeferredOpen] = useState(false)
  const query = useQuery(
    {
      queryKey: reviewInsightQueryKeys.todayPlan,
      queryFn: async () => (await getReviewTodayPlanApi()).item,
      staleTime: 30_000,
      retry: false,
    },
    queryClient,
  )

  const plan: ReviewTodayPlan | undefined = query.data
  if (query.isPending || !plan) return null

  const reviewTotal = plan.review_done + plan.review_pending
  const newTotal = plan.new_done + plan.new_pending
  const deferredDetails = plan.deferred_details ?? []
  const deferredCount = plan.review_deferred || deferredDetails.length

  return (
    <Card data-testid="today-plan-card" className="border-border/70 bg-card/95">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <CalendarCheck2 className="size-5 text-primary" />
            今日任务：复习 {reviewTotal} 张 + 新学 {newTotal} 张
          </span>
          {plan.completed ? (
            <Badge className="bg-success text-white hover:bg-success">
              <CheckCircle2 className="mr-1 size-3.5" />
              今日打卡完成
            </Badge>
          ) : (
            <Badge variant="outline">{plan.local_date}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>复习进度</span>
              <span className="tabular-nums">
                {plan.review_done}/{reviewTotal}（额度 {plan.review_quota}）
              </span>
            </div>
            <ProgressBar done={plan.review_done} total={reviewTotal} />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>新学进度</span>
              <span className="tabular-nums">
                {plan.new_done}/{newTotal}（额度 {plan.new_quota}）
              </span>
            </div>
            <ProgressBar done={plan.new_done} total={newTotal} className="bg-info" />
          </div>
        </div>

        {plan.backlog_new > 0 ? (
          <div className="rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
            还有 {plan.backlog_new} 张新卡待逐日放出（按每日新学额度自动释放）。
          </div>
        ) : null}

        {deferredCount > 0 ? (
          <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-full justify-between px-1 text-xs font-normal text-muted-foreground hover:text-foreground"
              onClick={() => setDeferredOpen((value) => !value)}
              aria-expanded={deferredOpen}
            >
              <span>因今日复习额度已满，{deferredCount} 张顺延至明天</span>
              {deferredOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </Button>
            {deferredOpen && deferredDetails.length > 0 ? (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                {deferredDetails.map((detail) => (
                  <li
                    key={`${detail.palace_id}:${detail.node_uid}`}
                    className="flex items-center justify-between gap-2 rounded border border-border/60 bg-background/70 px-2 py-1"
                  >
                    <span className="truncate">{detail.palace_title}</span>
                    <span className="shrink-0">{formatDeferReason(detail.defer_reason)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {plan.palaces.length > 0 ? (
          <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
            {plan.palaces.map((palace) => (
              <div
                key={palace.palace_id}
                className="flex items-center justify-between gap-2 rounded border border-border/50 px-2 py-1"
              >
                <span className="truncate">{palace.title}</span>
                <span className="shrink-0 tabular-nums">
                  复习 {palace.review_done}/{palace.review_done + palace.review_pending}
                  {palace.new_done + palace.new_pending > 0
                    ? ` · 新学 ${palace.new_done}/${palace.new_done + palace.new_pending}`
                    : ''}
                  {palace.review_deferred > 0 ? ` · 顺延 ${palace.review_deferred}` : ''}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
