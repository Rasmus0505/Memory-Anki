import { useEffect, useRef, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MasteryTrendPoint, PalaceListItem } from '@/shared/api/contracts'
import { getPalaceMasteryTrendApi } from '@/modules/memory/public'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover'
import { cn } from '@/shared/lib/utils'

function formatTrendDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function formatDelta(delta: number): string {
  if (delta > 0) return `↑ ${delta}%`
  if (delta < 0) return `↓ ${Math.abs(delta)}%`
  return '持平'
}

function deltaClassName(delta: number | null): string {
  if (delta === null) return 'bg-secondary text-secondary-foreground'
  if (delta > 0) return 'bg-success/12 text-success'
  if (delta < 0) return 'bg-destructive/10 text-destructive'
  return 'bg-secondary text-secondary-foreground'
}

function stepDeltas(points: MasteryTrendPoint[]): Array<number | null> {
  return points.map((point, index) => {
    if (index === 0) return null
    return point.mastery_percent - points[index - 1]!.mastery_percent
  })
}

function summarizeTrend(points: MasteryTrendPoint[], currentMastery: number): {
  badge: string
  badgeClass: string
  narrative: string
  firstPercent: number
  spanDelta: number
} {
  const first = points[0]!
  const last = points.at(-1)!
  const firstPercent = first.mastery_percent
  const spanDelta = last.mastery_percent - firstPercent
  const lastStep =
    points.length >= 2 ? last.mastery_percent - points.at(-2)!.mastery_percent : null

  if (points.length === 1) {
    return {
      badge: '首次记录',
      badgeClass: deltaClassName(null),
      narrative: `当前掌握度 ${currentMastery}%。这是第一次正式复习后的记录，之后每次结束都会在这里追加一点。`,
      firstPercent,
      spanDelta: 0,
    }
  }

  const badge = lastStep === null ? '持平' : formatDelta(lastStep)
  const spanText =
    spanDelta > 0
      ? `较首次 +${spanDelta}%`
      : spanDelta < 0
        ? `较首次 −${Math.abs(spanDelta)}%`
        : '与首次持平'
  const stepText =
    lastStep === null
      ? ''
      : lastStep > 0
        ? `较上次正式复习 +${lastStep}%`
        : lastStep < 0
          ? `较上次正式复习 −${Math.abs(lastStep)}%`
          : '较上次正式复习持平'

  return {
    badge,
    badgeClass: deltaClassName(lastStep),
    narrative: `${stepText}；共 ${points.length} 次正式复习，${spanText}（${firstPercent}% → ${last.mastery_percent}%）。`,
    firstPercent,
    spanDelta,
  }
}

function TrendPointTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload?: MasteryTrendPoint & { stepDelta?: number | null } }>
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  const step = point.stepDelta
  return (
    <div className="rounded-lg border border-border/70 bg-popover px-3 py-2 text-xs shadow-lg">
      <div className="text-muted-foreground">{formatTrendDate(point.at)}</div>
      <div className="mt-1 font-semibold text-foreground">掌握度 {point.mastery_percent}%</div>
      {step !== null && step !== undefined ? (
        <div className="mt-0.5 text-muted-foreground">较上次 {formatDelta(step)}</div>
      ) : (
        <div className="mt-0.5 text-muted-foreground">首次记录</div>
      )}
    </div>
  )
}

function TrendCard({ points, currentMastery }: {
  points: MasteryTrendPoint[]
  currentMastery: number
}) {
  if (!points.length) {
    return (
      <div className="w-[22rem] px-5 py-6">
        <div className="text-sm font-semibold text-foreground">掌握度趋势</div>
        <div className="mt-4 rounded-xl bg-secondary/55 px-4 py-5 text-center text-sm leading-6 text-muted-foreground">
          完成一次正式复习后，这里会显示掌握度变化
        </div>
      </div>
    )
  }

  const summary = summarizeTrend(points, currentMastery)
  const deltas = stepDeltas(points)
  const chartData = points.map((point, index) => ({
    ...point,
    stepDelta: deltas[index] ?? null,
  }))
  // Show newest first in the table so the latest change is on top.
  const tableRows = [...points]
    .map((point, index) => ({ point, stepDelta: deltas[index] ?? null }))
    .reverse()
    .slice(0, 6)

  return (
    <div className="w-[22rem] overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-5">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">掌握度趋势</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
            {currentMastery}%
          </div>
        </div>
        <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold', summary.badgeClass)}>
          {summary.badge}
        </span>
      </div>

      <p className="px-5 pb-3 text-[11px] leading-5 text-muted-foreground">{summary.narrative}</p>

      <div className="h-40 px-2 pb-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.7} />
            <XAxis
              dataKey="at"
              tickFormatter={(value) => formatTrendDate(String(value)).slice(5)}
              tick={{ fontSize: 10, fill: 'currentColor' }}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 50, 100]}
              width={28}
              tick={{ fontSize: 10, fill: 'currentColor' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `${value}`}
            />
            <RechartsTooltip content={<TrendPointTooltip />} />
            <Line
              type="monotone"
              dataKey="mastery_percent"
              stroke="hsl(var(--primary))"
              strokeWidth={2.5}
              dot={{ r: 3.5, fill: 'hsl(var(--primary))', strokeWidth: 0 }}
              activeDot={{ r: 5.5, fill: 'hsl(var(--primary))', strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="border-t border-border/60 px-5 py-3">
        <div className="mb-2 text-[11px] font-medium text-muted-foreground">最近正式复习</div>
        <ul className="space-y-1.5">
          {tableRows.map(({ point, stepDelta }) => (
            <li
              key={`${point.at}-${point.mastery_percent}`}
              className="flex items-center justify-between gap-2 text-[11px] leading-none"
            >
              <span className="text-muted-foreground">{formatTrendDate(point.at)}</span>
              <span className="font-semibold tabular-nums text-foreground">{point.mastery_percent}%</span>
              <span
                className={cn(
                  'min-w-[3.25rem] text-right tabular-nums',
                  stepDelta === null
                    ? 'text-muted-foreground'
                    : stepDelta > 0
                      ? 'text-success'
                      : stepDelta < 0
                        ? 'text-destructive'
                        : 'text-muted-foreground',
                )}
              >
                {stepDelta === null ? '起点' : formatDelta(stepDelta)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[10px] leading-4 text-muted-foreground/90">
          每个点 = 一次正式复习结束后的宫殿掌握度（0–100%）
        </p>
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

  const openTrend = () => {
    setOpen(true)
    loadTrend()
  }

  const closeTrend = () => {
    setOpen(false)
  }

  // Keep Radix controlled state in sync (click / escape / outside).
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      openTrend()
      return
    }
    closeTrend()
  }

  return (
    <div className="mt-2.5 flex w-full min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
      <span className="shrink-0 font-medium text-foreground" aria-hidden="true">
        掌握 {mastery}%
      </span>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="group relative h-3 min-w-16 flex-1 rounded-full outline-none"
            aria-label={`掌握度 ${mastery}%，查看趋势`}
            onPointerEnter={openTrend}
            onPointerLeave={closeTrend}
            onFocus={openTrend}
            onBlur={closeTrend}
          >
            <span
              className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-border/80 transition-opacity group-hover:opacity-100 group-focus-visible:ring-2 group-focus-visible:ring-ring/40"
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
          side="top"
          align="end"
          sideOffset={8}
          className="pointer-events-none w-auto overflow-hidden p-0"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {trendLoading ? (
            <div className="w-[22rem] px-5 py-6 text-sm text-muted-foreground">正在读取掌握度趋势…</div>
          ) : trendFailed ? (
            <div className="w-[22rem] px-5 py-6 text-sm text-muted-foreground">暂时无法读取趋势，请稍后再试</div>
          ) : (
            <TrendCard points={trend ?? []} currentMastery={mastery} />
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
