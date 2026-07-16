import { useEffect, useRef, useState } from 'react'
import { Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis } from 'recharts'
import type { MasteryTrendPoint, PalaceListItem } from '@/shared/api/contracts'
import { getPalaceMasteryTrendApi } from '@/entities/review/api'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover'
import { cn } from '@/shared/lib/utils'

function formatTrendDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function TrendPointTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload?: MasteryTrendPoint }>
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <div className="rounded-lg border border-border/70 bg-popover px-3 py-2 text-xs shadow-lg">
      <div className="text-muted-foreground">{formatTrendDate(point.at)}</div>
      <div className="mt-1 font-semibold text-foreground">掌握度 {point.mastery_percent}%</div>
    </div>
  )
}

function trendChange(points: MasteryTrendPoint[]) {
  if (points.length < 2) {
    return { label: '首次记录', className: 'bg-secondary text-secondary-foreground' }
  }
  const delta = points.at(-1)!.mastery_percent - points.at(-2)!.mastery_percent
  if (delta > 0) {
    return { label: `↑ ${delta}%`, className: 'bg-success/12 text-success' }
  }
  if (delta < 0) {
    return { label: `↓ ${Math.abs(delta)}%`, className: 'bg-destructive/10 text-destructive' }
  }
  return { label: '持平', className: 'bg-secondary text-secondary-foreground' }
}

function TrendCard({ points, currentMastery }: {
  points: MasteryTrendPoint[]
  currentMastery: number
}) {
  if (!points.length) {
    return (
      <div className="w-80 px-5 py-6">
        <div className="text-sm font-semibold text-foreground">掌握度趋势</div>
        <div className="mt-4 rounded-xl bg-secondary/55 px-4 py-5 text-center text-sm leading-6 text-muted-foreground">
          完成一次正式复习后，这里会显示掌握度变化
        </div>
      </div>
    )
  }
  const latest = points.at(-1)!
  const change = trendChange(points)
  return (
    <div className="w-80 overflow-hidden">
      <div className="flex items-end justify-between gap-4 px-5 pb-3 pt-5">
        <div>
          <div className="text-xs font-medium text-muted-foreground">当前掌握度</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
            {currentMastery}%
          </div>
        </div>
        <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', change.className)}>
          {change.label}
        </span>
      </div>
      <div className="h-36 px-3 pb-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 12, right: 12, bottom: 0, left: 12 }}>
            <XAxis
              dataKey="at"
              tickFormatter={(value) => formatTrendDate(String(value)).slice(5)}
              tick={{ fontSize: 10, fill: 'currentColor' }}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
            />
            <RechartsTooltip content={<TrendPointTooltip />} />
            <Line
              type="monotone"
              dataKey="mastery_percent"
              stroke="hsl(var(--primary))"
              strokeWidth={2.5}
              dot={{ r: 3, fill: 'hsl(var(--primary))', strokeWidth: 0 }}
              activeDot={{ r: 5, fill: 'hsl(var(--primary))', strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="border-t border-border/60 px-5 py-3 text-xs text-muted-foreground">
        最近正式复习：{formatTrendDate(latest.at)}
      </div>
    </div>
  )
}

export function PalaceMemoryProgress({ palace }: {
  palace: Pick<PalaceListItem, 'id' | 'mastery_percent'>
}) {
  const mastery = Math.max(0, Math.min(100, Math.round(palace.mastery_percent ?? 0)))
  const [open, setOpen] = useState(false)
  const [trend, setTrend] = useState<MasteryTrendPoint[] | null>(null)
  const [trendLoading, setTrendLoading] = useState(false)
  const [trendFailed, setTrendFailed] = useState(false)
  const requestOwnerRef = useRef(0)

  useEffect(() => {
    requestOwnerRef.current += 1
    setOpen(false)
    setTrend(null)
    setTrendLoading(false)
    setTrendFailed(false)
  }, [palace.id])

  const loadTrend = () => {
    if (trend !== null || trendLoading) return
    const owner = ++requestOwnerRef.current
    setTrendLoading(true)
    void getPalaceMasteryTrendApi(palace.id)
      .then((response) => {
        if (requestOwnerRef.current !== owner) return
        setTrend(response.points)
        setTrendFailed(false)
      })
      .catch(() => {
        if (requestOwnerRef.current === owner) setTrendFailed(true)
      })
      .finally(() => {
        if (requestOwnerRef.current === owner) setTrendLoading(false)
      })
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) loadTrend()
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mt-2.5 flex w-full min-w-0 items-center gap-2 text-left text-[11px] text-muted-foreground outline-none"
          aria-label={`掌握度 ${mastery}%，查看趋势`}
          onMouseEnter={() => handleOpenChange(true)}
          onMouseLeave={() => setOpen(false)}
          onFocus={() => handleOpenChange(true)}
        >
          <span className="shrink-0 font-medium text-foreground">掌握 {mastery}%</span>
          <span
            className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-border/80"
            role="progressbar"
            aria-label={`掌握度 ${mastery}%`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={mastery}
          >
            <span
              className="block h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${mastery}%` }}
            />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-auto overflow-hidden p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {trendLoading ? (
          <div className="w-80 px-5 py-6 text-sm text-muted-foreground">正在读取掌握度趋势…</div>
        ) : trendFailed ? (
          <div className="w-80 px-5 py-6 text-sm text-muted-foreground">暂时无法读取趋势，请稍后再试</div>
        ) : (
          <TrendCard points={trend ?? []} currentMastery={mastery} />
        )}
      </PopoverContent>
    </Popover>
  )
}
