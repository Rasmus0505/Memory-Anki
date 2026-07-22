import { useState } from 'react'
import type { DashboardResponse } from '@/shared/api/contracts'
import { formatDuration } from '@/modules/session/public'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { cn } from '@/shared/lib/utils'
import {
  buildLearningSegments,
  dashboardLearningLegend,
  formatLearningTooltip,
} from '@/modules/dashboard/ui/dashboard/model/dashboard-derive'

interface DashboardTodayLearningCardProps {
  palaces: DashboardResponse['today_learning_palaces']
}

export function DashboardTodayLearningCard({ palaces }: DashboardTodayLearningCardProps) {
  const [hoveredLearningPalaceId, setHoveredLearningPalaceId] = useState<number | null>(null)

  return (
    <Card>
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
      <CardContent>
        {palaces.length > 0 ? (
          <div className="flex flex-col gap-3">
            {palaces.map((item) => {
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
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">今天还没有产生学习时长记录。</p>
        )}
      </CardContent>
    </Card>
  )
}
