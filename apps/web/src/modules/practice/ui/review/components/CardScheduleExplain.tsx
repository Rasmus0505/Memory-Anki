import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Info, X } from 'lucide-react'
import type { ReviewNodeScheduleDetail } from '@/shared/api/contracts'
import { getNodeScheduleDetailApi } from '@/modules/practice/ui/review/api/scheduleInsightApi'
import {
  reviewInsightQueryKeys,
  useReviewInsightInvalidation,
  useReviewInsightQueryClient,
} from '@/modules/practice/ui/review/hooks/reviewInsightQueries'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

export function formatScheduleSource(source: string | null | undefined): string {
  if (!source) return '—'
  if (source === 'fsrs_direct') return 'FSRS 直出'
  if (source.startsWith('aggregated')) return '聚合日挪动'
  if (source === 'daily_new_release') return '今日新学放出'
  if (source === 'backlog') return '待放出新卡'
  return source
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatStabilityDays(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '—'
  if (value < 1) return `${Math.max(1, Math.round(value * 24))} 小时`
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} 天`
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium">{value}</span>
    </div>
  )
}

/**
 * "为什么是今天"：单卡调度解释面板。信息图标按钮展开；数据懒加载
 * （展开时才请求 schedule-detail）。
 */
export function CardScheduleExplain({
  palaceId,
  nodeUid,
  className,
}: {
  palaceId: number
  nodeUid: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const queryClient = useReviewInsightQueryClient()
  useReviewInsightInvalidation(queryClient)
  const query = useQuery(
    {
      queryKey: reviewInsightQueryKeys.scheduleDetail(palaceId, nodeUid),
      enabled: open && Boolean(palaceId && nodeUid),
      queryFn: async () => (await getNodeScheduleDetailApi(palaceId, nodeUid)).item,
      staleTime: 60_000,
      retry: false,
    },
    queryClient,
  )

  const detail: ReviewNodeScheduleDetail | undefined = query.data

  return (
    <div className={cn('relative', className)}>
      <Button
        type="button"
        size="sm"
        variant={open ? 'secondary' : 'ghost'}
        className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
        title="为什么是今天：查看这张卡的调度解释"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Info className="size-3.5" />
        为什么是今天
      </Button>
      {open ? (
        <div
          data-testid="card-schedule-explain"
          className="absolute right-0 top-full z-[120] mt-1 w-72 max-w-[min(90vw,20rem)] space-y-1.5 rounded-lg border border-border bg-background p-3 shadow-xl"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">调度解释</span>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="关闭调度解释"
              onClick={() => setOpen(false)}
            >
              <X className="size-3.5" />
            </button>
          </div>
          {query.isPending ? (
            <p className="text-xs text-muted-foreground">正在读取调度详情…</p>
          ) : query.isError ? (
            <p className="text-xs text-destructive">调度详情加载失败，可稍后重试。</p>
          ) : detail ? (
            <>
              {!detail.exists ? (
                <p className="text-xs text-muted-foreground">
                  这张卡尚未开始调度：{detail.schedule_reason || '等待每日新学额度放出。'}
                </p>
              ) : (
                <>
                  <DetailRow label="稳定度" value={formatStabilityDays(detail.stability_days)} />
                  <DetailRow
                    label="难度"
                    value={detail.difficulty != null ? detail.difficulty.toFixed(2) : '—'}
                  />
                  <DetailRow
                    label="当前记忆保持率"
                    value={
                      detail.retrievability != null
                        ? `${Math.round(detail.retrievability * 100)}%`
                        : '—'
                    }
                  />
                  <DetailRow label="上次复习" value={formatDateTime(detail.last_review_at)} />
                  <DetailRow label="原定到期" value={formatDateTime(detail.raw_due_at)} />
                  <DetailRow label="生效到期" value={formatDateTime(detail.effective_due_at)} />
                  <DetailRow label="调度来源" value={formatScheduleSource(detail.schedule_source)} />
                  {detail.shifted ? (
                    <p className="rounded border border-warning/30 bg-warning/5 px-2 py-1 text-[11px] text-muted-foreground">
                      到期日被挪动：{detail.schedule_reason || formatScheduleSource(detail.schedule_source)}
                    </p>
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
