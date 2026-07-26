import { useQuery } from '@tanstack/react-query'
import { CalendarDays } from 'lucide-react'
import { getReviewLoadForecastApi } from '@/modules/practice/ui/review/api/reviewApi'
import {
  reviewInsightQueryKeys,
  useReviewInsightInvalidation,
  useReviewInsightQueryClient,
} from '@/modules/practice/ui/review/hooks/reviewInsightQueries'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { cn } from '@/shared/lib/utils'

const FORECAST_DAYS = 30

/**
 * 未来 30 天复习负载日历：纯 CSS div 柱状图（不引图表库）。
 * 今天高亮；逾期数在标题区单独显示，不混入柱子。
 */
export function ReviewLoadCalendar() {
  const queryClient = useReviewInsightQueryClient()
  useReviewInsightInvalidation(queryClient)
  const query = useQuery(
    {
      queryKey: reviewInsightQueryKeys.loadForecast(FORECAST_DAYS),
      queryFn: () => getReviewLoadForecastApi(FORECAST_DAYS),
      staleTime: 30_000,
      retry: false,
    },
    queryClient,
  )

  const data = query.data
  if (!data) return null

  const maxCount = Math.max(1, ...data.items.map((item) => item.due_count))

  return (
    <Card data-testid="review-load-calendar" className="min-w-0 border-border/70 bg-card/95 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base font-semibold">
          <span className="flex items-center gap-2">
            <CalendarDays className="size-5 text-primary" />
            复习日历 · 未来 {data.days} 天共 {data.total_upcoming} 张
          </span>
          {data.overdue_count > 0 ? (
            <span className="rounded-full border border-error/30 bg-error/10 px-2 py-0.5 text-xs font-medium text-error">
              逾期 {data.overdue_count} 张
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="flex h-32 items-end gap-[3px]" role="img" aria-label="未来复习负载柱状图">
          {data.items.map((item) => {
            const heightPercent = item.due_count > 0 ? Math.max(6, (item.due_count / maxCount) * 100) : 0
            return (
              <div
                key={item.date}
                className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
                title={`${item.date} · ${item.due_count} 张${item.is_today ? '（今天）' : ''}`}
              >
                <div
                  data-testid={item.is_today ? 'load-bar-today' : undefined}
                  className={cn(
                    'w-full rounded-t-sm transition-colors',
                    item.is_today
                      ? 'bg-warning'
                      : item.due_count > 0
                        ? 'bg-primary/70 group-hover:bg-primary'
                        : 'h-[2px] bg-border',
                  )}
                  style={item.due_count > 0 ? { height: `${heightPercent}%` } : undefined}
                />
              </div>
            )
          })}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{data.items[0]?.is_today ? '今天' : data.items[0]?.date.slice(5)}</span>
          <span>{data.items[Math.floor(data.items.length / 2)]?.date.slice(5)}</span>
          <span>{data.items[data.items.length - 1]?.date.slice(5)}</span>
        </div>
        <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-2 rounded-sm bg-warning" />今天
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-2 rounded-sm bg-primary/70" />未来到期
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
