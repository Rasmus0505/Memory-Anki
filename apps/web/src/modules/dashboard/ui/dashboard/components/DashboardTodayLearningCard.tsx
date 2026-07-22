import { useMemo, useState } from 'react'
import type { DashboardResponse } from '@/shared/api/contracts'
import { formatDuration } from '@/modules/session/public'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Pagination } from '@/shared/components/ui/pagination'
import { cn } from '@/shared/lib/utils'
import {
  buildLearningSegments,
  dashboardLearningLegend,
  formatLearningTooltip,
} from '@/modules/dashboard/ui/dashboard/model/dashboard-derive'

const PAGE_SIZE = 4

interface DashboardTodayLearningCardProps {
  palaces: DashboardResponse['today_learning_palaces']
}

export function DashboardTodayLearningCard({ palaces }: DashboardTodayLearningCardProps) {
  const [hoveredLearningPalaceId, setHoveredLearningPalaceId] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(palaces.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE
    return palaces.slice(start, start + PAGE_SIZE)
  }, [palaces, safePage])

  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex flex-col gap-2">
          <CardTitle className="text-base">今日学习</CardTitle>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {dashboardLearningLegend.map((legend) => (
              <span key={legend.key} className="inline-flex items-center gap-1.5">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: legend.color }}
                />
                <span>{legend.label}</span>
              </span>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {palaces.length > 0 ? (
          <>
            <div className="flex min-h-[280px] flex-col gap-3">
              {pageItems.map((item) => {
                const segments = buildLearningSegments(item)
                const isTooltipVisible = hoveredLearningPalaceId === item.palace_id
                return (
                  <div key={item.palace_id} className="rounded-xl border border-border/60 bg-background/70 px-3 py-3">
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
                          <div
                            key={segment.key}
                            className="h-full"
                            style={{
                              width: `${segment.width}%`,
                              backgroundColor: segment.color,
                            }}
                          />
                        ))}
                      </div>
                      {isTooltipVisible ? (
                        <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 min-w-[180px] rounded-lg border border-border/70 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-popover">
                          {formatLearningTooltip(item).split('\n').map((line, index) => (
                            <div
                              key={`${item.palace_id}-${index}`}
                              className={cn(
                                'whitespace-nowrap',
                                index === 0 ? 'mb-1 font-medium text-foreground' : 'text-muted-foreground',
                              )}
                            >
                              {line}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
            {totalPages > 1 ? (
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
                <div className="text-xs text-muted-foreground">
                  第 {safePage} / {totalPages} 页 · 共 {palaces.length} 项
                </div>
                <Pagination
                  page={safePage}
                  totalPages={totalPages}
                  onPageChange={setPage}
                  className="justify-end"
                  aria-label="今日学习分页"
                />
              </div>
            ) : null}
          </>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">今天还没有产生学习时长记录。</p>
        )}
      </CardContent>
    </Card>
  )
}
