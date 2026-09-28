import { useMemo, useState } from 'react'
import type { DashboardResponse } from '@/shared/api/contracts'
import { formatDuration } from '@/modules/session/public'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { cn } from '@/shared/lib/utils'
import {
  buildLearningSegments,
  dashboardLearningLegend,
  formatLearningTooltip,
} from '@/modules/dashboard/ui/dashboard/model/dashboard-derive'
import { useFitPageSize } from '@/modules/dashboard/ui/dashboard/model/useFitPageSize'
import { CompactPager } from './CompactPager'

const ITEM_HEIGHT = 58
const ITEM_GAP = 8
const FALLBACK_PAGE_SIZE = 4

interface DashboardTodayLearningCardProps {
  palaces: DashboardResponse['today_learning_palaces']
  className?: string
}

export function DashboardTodayLearningCard({ palaces, className }: DashboardTodayLearningCardProps) {
  const [hoveredLearningPalaceId, setHoveredLearningPalaceId] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const { ref: listRef, pageSize } = useFitPageSize<HTMLDivElement>(ITEM_HEIGHT, ITEM_GAP, FALLBACK_PAGE_SIZE)
  const totalPages = Math.max(1, Math.ceil(palaces.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return palaces.slice(start, start + pageSize)
  }, [palaces, safePage, pageSize])

  return (
    <Card className={cn('flex min-h-0 flex-col', className)}>
      <CardHeader className="shrink-0 gap-1.5 space-y-0 p-4 pb-2">
        <CardTitle className="text-base">今日学习</CardTitle>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {dashboardLearningLegend.map((legend) => (
            <span key={legend.key} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: legend.color }} />
              <span>{legend.label}</span>
            </span>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col p-4 pt-1">
        <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2">
          {palaces.length > 0 ? (
            pageItems.map((item) => {
              const segments = buildLearningSegments(item)
              const isTooltipVisible = hoveredLearningPalaceId === item.palace_id
              return (
                <div key={item.palace_id} className="shrink-0 rounded-xl border border-border/60 bg-background/70 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate text-sm font-medium">{item.palace_title || '未命名宫殿'}</div>
                    <div className="shrink-0 text-xs text-muted-foreground">{formatDuration(item.total_seconds)}</div>
                  </div>
                  <div className="relative mt-2">
                    <div
                      className="flex h-3 overflow-hidden rounded-full border border-border/60 bg-secondary/80 shadow-inner"
                      onMouseEnter={() => setHoveredLearningPalaceId(item.palace_id)}
                      onMouseLeave={() => setHoveredLearningPalaceId((current) => (current === item.palace_id ? null : current))}
                      onFocus={() => setHoveredLearningPalaceId(item.palace_id)}
                      onBlur={() => setHoveredLearningPalaceId((current) => (current === item.palace_id ? null : current))}
                      tabIndex={0}
                      role="img"
                      aria-label={`${item.palace_title || '未命名宫殿'} 学习时长结构`}
                    >
                      {segments.map((segment) => (
                        <div key={segment.key} className="h-full" style={{ width: `${segment.width}%`, backgroundColor: segment.color }} />
                      ))}
                    </div>
                    {isTooltipVisible ? (
                      <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 min-w-[180px] rounded-lg border border-border/70 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-popover">
                        {formatLearningTooltip(item).split('\n').map((line, index) => (
                          <div
                            key={`${item.palace_id}-${index}`}
                            className={cn('whitespace-nowrap', index === 0 ? 'mb-1 font-medium text-foreground' : 'text-muted-foreground')}
                          >
                            {line}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })
          ) : (
            <p className="m-auto text-center text-sm text-muted-foreground">今天还没有产生学习时长记录。</p>
          )}
        </div>
        {palaces.length > 0 ? (
          <div className="mt-2 flex h-8 shrink-0 items-center justify-between gap-3 border-t border-border/60 pt-1">
            <div className="text-xs text-muted-foreground">共 {palaces.length} 项</div>
            {totalPages > 1 ? (
              <CompactPager page={safePage} totalPages={totalPages} onPageChange={setPage} aria-label="今日学习分页" />
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
