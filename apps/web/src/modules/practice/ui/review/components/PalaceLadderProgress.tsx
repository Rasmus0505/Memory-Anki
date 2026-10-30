import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  getPalaceLadderProgressApi,
  type AdjustUnitScheduleResultDto,
  type DueHorizonKey,
  type LadderProgressRange,
  type PalaceLadderProgressDto,
} from '../api/unitReviewApi'
import { cn } from '@/shared/lib/utils'
import { intervalBadgeLabel, intervalOutlookLabel } from '../model/intervalBands'
import { UnitScheduleAdjustPopover } from './UnitScheduleAdjustPopover'

const RANGE_OPTIONS: Array<{ value: LadderProgressRange; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'today', label: '今天' },
  { value: 'last3days', label: '近3天' },
  { value: 'week', label: '本周' },
]
const RANGE_LABELS: Record<LadderProgressRange, string> = {
  all: '全部记录',
  today: '今天',
  last3days: '近3天',
  week: '本周',
}

const RANGE_STORAGE_KEY = 'memory-anki.ladder-progress.range'
const TOOLTIP_Z = 10_000
const EMPTY_SUMMARY = {
  range: 'all' as LadderProgressRange,
  unit_count: 0,
  total_seconds: 0,
  freestyle_rating_count: 0,
  quiz_count: 0,
}

type HorizonKey = DueHorizonKey

/**
 * Due-date horizons, not ladder levels. FSRS books each unit at its own real
 * interval, so the useful shape of a palace is "how much work is due when".
 */
const HORIZONS: ReadonlyArray<{ key: HorizonKey; label: string; className: string }> = [
  { key: 'today', label: '今天', className: 'border-amber-500/60 bg-amber-500/15 text-amber-200' },
  { key: 'd3', label: '3天内', className: 'border-primary/50 bg-primary/15 text-primary' },
  { key: 'week', label: '本周', className: 'border-primary/35 bg-primary/10 text-primary/90' },
  { key: 'month', label: '本月', className: 'border-border bg-muted/60 text-muted-foreground' },
  { key: 'later', label: '更远', className: 'border-border/60 bg-transparent text-muted-foreground/80' },
]

function readStoredRange(): LadderProgressRange {
  try {
    const raw = localStorage.getItem(RANGE_STORAGE_KEY)
    if (raw === 'today' || raw === 'last3days' || raw === 'week' || raw === 'all') return raw
  } catch {
    // ignore storage failures
  }
  return 'all'
}

function formatSeconds(total: number): string {
  const seconds = Math.max(0, Math.round(total))
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}小时${rest}分` : `${hours}小时`
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const day = iso.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const [, month, date] = day.split('-')
    return `${Number(month)}月${Number(date)}日`
  }
  try {
    const parsed = new Date(iso)
    if (Number.isNaN(parsed.getTime())) return '—'
    return `${parsed.getMonth() + 1}月${parsed.getDate()}日`
  } catch {
    return '—'
  }
}

type FloatingPos = { left: number; top: number }

function positionBelow(el: HTMLElement, width = 260): FloatingPos {
  const rect = el.getBoundingClientRect()
  const margin = 8
  const half = width / 2
  let left = rect.left + rect.width / 2
  left = Math.max(half + margin, Math.min(left, window.innerWidth - half - margin))
  let top = rect.bottom + 8
  if (top + 120 > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - 8 - 96)
  }
  return { left, top }
}

export type PalaceLadderProgressProps = {
  palaceId: number
  unitId?: string | null
  className?: string
  refreshKey?: string | number | null
  /** Make the current-interval badge open the manual schedule override. */
  adjustable?: boolean
  /** Fired after a manual due-date change; hosts rebuild/open the card. */
  onScheduleAdjusted?: (result: AdjustUnitScheduleResultDto) => void
}

export function PalaceLadderProgress({
  palaceId,
  unitId = null,
  className,
  refreshKey = null,
  adjustable = false,
  onScheduleAdjusted,
}: PalaceLadderProgressProps) {
  const [range, setRange] = useState<LadderProgressRange>(() => readStoredRange())
  const [data, setData] = useState<PalaceLadderProgressDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hoverHorizon, setHoverHorizon] = useState<HorizonKey | null>(null)
  const [hoverTrack, setHoverTrack] = useState(false)
  const [hoverSummary, setHoverSummary] = useState<'range' | 'palace' | null>(null)
  const [floatPos, setFloatPos] = useState<FloatingPos | null>(null)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const hideTimerRef = useRef<number | null>(null)

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const hideFloating = useCallback(() => {
    clearHideTimer()
    setHoverHorizon(null)
    setHoverTrack(false)
    setHoverSummary(null)
    setFloatPos(null)
  }, [clearHideTimer])

  const scheduleHide = useCallback(() => {
    clearHideTimer()
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null
      setHoverHorizon(null)
      setHoverTrack(false)
      setHoverSummary(null)
      setFloatPos(null)
    }, 80)
  }, [clearHideTimer])

  useEffect(() => () => clearHideTimer(), [clearHideTimer])

  const load = useCallback(async () => {
    if (!palaceId) return
    try {
      const item = await getPalaceLadderProgressApi(palaceId, {
        range,
        unitId: unitId || undefined,
      })
      setData(item)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载复习间隔失败')
    }
  }, [palaceId, range, unitId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const currentDue = Boolean(data?.current?.due)
  const horizonCounts = data?.palace.due_horizon ?? null
  const currentHorizon = (data?.current?.horizon ?? null) as HorizonKey | null
  const totalUnits = useMemo(
    () => (horizonCounts ? Object.values(horizonCounts).reduce((sum, n) => sum + n, 0) : 0),
    [horizonCounts],
  )

  useEffect(() => {
    if (hoverHorizon == null && !hoverTrack && !hoverSummary) return
    const reposition = () => {
      if (hoverHorizon != null) {
        const node = document.querySelector<HTMLElement>(`[data-testid="horizon-${hoverHorizon}"]`)
        if (node) setFloatPos(positionBelow(node))
        return
      }
      if (hoverTrack && trackRef.current) setFloatPos(positionBelow(trackRef.current, 300))
      if (hoverSummary) {
        const node = document.querySelector<HTMLElement>(`[data-testid="ladder-summary-${hoverSummary}"]`)
        if (node) setFloatPos(positionBelow(node, 260))
      }
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [hoverHorizon, hoverSummary, hoverTrack])

  const handleRangeChange = (next: LadderProgressRange) => {
    setRange(next)
    try {
      localStorage.setItem(RANGE_STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }

  const horizonTooltip = useMemo(() => {
    if (hoverHorizon == null || !data || !horizonCounts) return null
    const definition = HORIZONS.find((item) => item.key === hoverHorizon)
    if (!definition) return null
    const count = horizonCounts[hoverHorizon] ?? 0
    const share = totalUnits > 0 ? Math.round((count / totalUnits) * 100) : 0
    return {
      title: `${definition.label} · ${count} 个单元`,
      lines: [
        `占整宫 ${share}%`,
        currentHorizon === hoverHorizon
          ? `当前单元在这里${data.current?.due_date ? `（${formatShortDate(data.current.due_date)}）` : ''}`
          : null,
        count === 0 ? '这段时间没有单元到期' : null,
      ].filter((line): line is string => Boolean(line)),
    }
  }, [currentHorizon, data, horizonCounts, hoverHorizon, totalUnits])

  const trackTooltip = useMemo(() => {
    if (!hoverTrack || hoverHorizon != null || hoverSummary != null || !data) return null
    const distribution = HORIZONS
      .map((item) => {
        const count = horizonCounts?.[item.key] ?? 0
        return count > 0 ? `${item.label}×${count}` : null
      })
      .filter(Boolean)
      .join(' · ')
    const share = data.palace_range_stats.rating_share
    const rangeLabel = RANGE_LABELS[range]
    return {
      current: data.current
        ? `当前间隔 ${intervalOutlookLabel(data.current.interval_days)}`
        : '无当前单元',
      unitTitle: data.current?.title || '未命名单元',
      due: data.current?.due_date
        ? `下次复习：${formatShortDate(data.current.due_date)}${data.current.due ? '（已到期）' : ''}`
        : null,
      palace: `宫殿：${data.palace.unit_count} 个单元 · ${data.palace.due_count} 个到期`
        + (data.palace.next_review_date
          ? ` · 最近到期 ${formatShortDate(data.palace.next_review_date)}`
          : ''),
      distribution: `到期分布：${distribution || '暂无分布'}`,
      reviews: data.palace_range_stats.total_reviews > 0 || data.palace_range_stats.total_seconds > 0
        ? `${rangeLabel}：${data.palace_range_stats.total_reviews} 次 · 学习总时长 ${formatSeconds(data.palace_range_stats.total_seconds)}`
        : `${rangeLabel}：无复习明细`,
      ratings: `评分：忘记 ${share.forgot} · 困难 ${share.hard} · 记得 ${share.remember} · 轻松 ${share.easy}`,
      scope: data.scope === 'unit' ? '当前单元' : '整宫最近到期',
    }
  }, [data, horizonCounts, hoverHorizon, hoverSummary, hoverTrack, range])

  const summaryTooltip = useMemo(() => {
    if (!hoverSummary || !data) return null
    const stats = (hoverSummary === 'range'
      ? data.selected_range_summary
      : data.palace_all_time_summary) ?? EMPTY_SUMMARY
    return {
      title: hoverSummary === 'range' ? `${RANGE_LABELS[range]}学习情况` : '当前宫殿 · 全部学习情况',
      stats,
    }
  }, [data, hoverSummary, range])

  const openHorizon = (key: HorizonKey, el: HTMLElement) => {
    clearHideTimer()
    setHoverHorizon(key)
    setHoverTrack(false)
    setHoverSummary(null)
    setFloatPos(positionBelow(el))
  }

  const openTrack = (el: HTMLElement) => {
    clearHideTimer()
    setHoverHorizon(null)
    setHoverTrack(true)
    setHoverSummary(null)
    setFloatPos(positionBelow(el, 300))
  }

  const openSummary = (scope: 'range' | 'palace', el: HTMLElement) => {
    clearHideTimer()
    setHoverHorizon(null)
    setHoverTrack(false)
    setHoverSummary(scope)
    setFloatPos(positionBelow(el, 260))
  }

  if (!palaceId) return null

  const floating =
    floatPos && (horizonTooltip || trackTooltip || summaryTooltip) && typeof document !== 'undefined'
      ? createPortal(
          <div
            role="tooltip"
            data-testid={horizonTooltip ? 'ladder-horizon-tooltip' : summaryTooltip ? 'ladder-summary-tooltip' : 'ladder-track-tooltip'}
            className="pointer-events-none w-max max-w-70 rounded-lg border border-border bg-popover px-2.5 py-2 text-left text-[11px] text-popover-foreground shadow-xl"
            style={{
              position: 'fixed',
              left: floatPos.left,
              top: floatPos.top,
              transform: 'translateX(-50%)',
              zIndex: TOOLTIP_Z,
            }}
          >
            {horizonTooltip ? (
              <>
                <div className="font-semibold">{horizonTooltip.title}</div>
                {horizonTooltip.lines.map((line) => (
                  <div key={line} className="mt-1 text-muted-foreground">{line}</div>
                ))}
              </>
            ) : summaryTooltip ? (
              <>
                <div className="font-semibold">{summaryTooltip.title}</div>
                <div className="mt-1 text-muted-foreground">学习单元数：{summaryTooltip.stats.unit_count}</div>
                <div className="text-muted-foreground">学习总时长：{formatSeconds(summaryTooltip.stats.total_seconds)}</div>
                <div className="text-muted-foreground">随心刷卡次数：{summaryTooltip.stats.freestyle_rating_count} 次</div>
                <div className="text-muted-foreground">刷题数量：{summaryTooltip.stats.quiz_count} 题</div>
              </>
            ) : trackTooltip ? (
              <>
                <div className="font-semibold">
                  {trackTooltip.scope} · {trackTooltip.current}
                </div>
                <div className="mt-1 text-muted-foreground">单元：{trackTooltip.unitTitle}</div>
                {trackTooltip.due ? <div className="text-muted-foreground">{trackTooltip.due}</div> : null}
                <div className="text-muted-foreground">{trackTooltip.palace}</div>
                <div className="text-muted-foreground">{trackTooltip.distribution}</div>
                <div className="text-muted-foreground">{trackTooltip.reviews}</div>
                <div className="text-muted-foreground">{trackTooltip.ratings}</div>
              </>
            ) : null}
          </div>,
          document.body,
        )
      : null

  const currentLabel = data?.current ? intervalBadgeLabel(data.current.interval_days) : null
  const distributionLabel = HORIZONS
    .map((item) => `${item.label} ${horizonCounts?.[item.key] ?? 0}`)
    .join(' · ')

  return (
    <div
      className={cn('flex min-w-0 flex-1 items-center gap-2', className)}
      data-testid="palace-ladder-progress"
    >
      <div className="flex shrink-0 items-center gap-1" aria-label="学习情况汇总">
        <button
          type="button"
          data-testid="ladder-summary-range"
          aria-label={`${RANGE_LABELS[range]}学习情况汇总`}
          className="size-4 rounded-full border-2 border-violet-400 bg-violet-500/80 shadow-sm transition-colors hover:bg-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
          onMouseEnter={(event) => openSummary('range', event.currentTarget)}
          onMouseLeave={scheduleHide}
          onFocus={(event) => openSummary('range', event.currentTarget)}
          onBlur={hideFloating}
        />
        <button
          type="button"
          data-testid="ladder-summary-palace"
          aria-label="当前宫殿全部学习情况汇总"
          className="size-4 rounded-full border-2 border-cyan-400 bg-cyan-500/80 shadow-sm transition-colors hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
          onMouseEnter={(event) => openSummary('palace', event.currentTarget)}
          onMouseLeave={scheduleHide}
          onFocus={(event) => openSummary('palace', event.currentTarget)}
          onBlur={hideFloating}
        />
      </div>
      <div
        ref={trackRef}
        className="flex min-h-8 min-w-30 flex-1 items-center"
        title={error ?? undefined}
        onMouseEnter={(event) => openTrack(event.currentTarget)}
        onMouseLeave={scheduleHide}
      >
        <div
          className="flex w-full items-center gap-1"
          role="group"
          aria-label={horizonCounts ? `到期分布 · ${distributionLabel}` : '到期分布'}
        >
          {horizonCounts == null ? (
            <span className="text-[10px] text-muted-foreground">进度暂不可用</span>
          ) : totalUnits === 0 ? (
            <span className="text-[10px] text-muted-foreground">暂无单元</span>
          ) : (
            HORIZONS.map((item) => {
              const count = horizonCounts[item.key] ?? 0
              const isCurrent = currentHorizon === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  data-testid={`horizon-${item.key}`}
                  data-current={isCurrent ? 'true' : undefined}
                  aria-label={`${item.label} ${count} 个单元`}
                  className={cn(
                    'flex h-5 min-w-0 flex-1 items-center justify-center gap-1 rounded-full border px-1.5 text-[10px] tabular-nums transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    item.className,
                    isCurrent && 'ring-1 ring-inset ring-current font-semibold',
                    count === 0 && 'opacity-45',
                  )}
                  onMouseEnter={(event) => openHorizon(item.key, event.currentTarget)}
                  onMouseLeave={scheduleHide}
                  onFocus={(event) => openHorizon(item.key, event.currentTarget)}
                  onBlur={hideFloating}
                >
                  <span className="truncate">{item.label}</span>
                  <span className="shrink-0">{count}</span>
                </button>
              )
            })
          )}
        </div>
      </div>

      {currentLabel ? (
        adjustable && data?.current ? (
          <UnitScheduleAdjustPopover
            unitId={data.current.unit_id}
            dueDate={data.current.due_date}
            open={adjustOpen}
            onOpenChange={(next) => {
              if (next) hideFloating()
              setAdjustOpen(next)
            }}
            onAdjusted={(result) => {
              void load()
              onScheduleAdjusted?.(result)
            }}
          >
            <button
              type="button"
              data-testid="ladder-current-adjust"
              aria-label={`${currentDue ? '今天到期' : currentLabel}，点击调整复习进度`}
              title="点击调整复习进度"
              className={cn(
                'hidden shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] tabular-nums transition-colors sm:inline',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                currentDue
                  ? 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                  : 'bg-primary/10 text-primary hover:bg-primary/20',
              )}
            >
              {currentLabel}
            </button>
          </UnitScheduleAdjustPopover>
        ) : (
          <span
            className={cn(
              'hidden shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] tabular-nums sm:inline',
              currentDue
                ? 'bg-amber-500/15 text-amber-200'
                : 'bg-primary/10 text-primary',
            )}
            title={currentDue ? `${currentLabel} · 已到期` : currentLabel}
          >
            {currentLabel}
          </span>
        )
      ) : null}

      <label className="sr-only" htmlFor={`ladder-range-${palaceId}`}>
        时间范围
      </label>
      <select
        id={`ladder-range-${palaceId}`}
        data-testid="ladder-range-select"
        className="h-7 shrink-0 rounded-md border border-border/70 bg-background px-1.5 text-[11px] text-muted-foreground"
        value={range}
        onChange={(event) => handleRangeChange(event.target.value as LadderProgressRange)}
        onMouseEnter={hideFloating}
      >
        {RANGE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {data?.scope === 'palace' ? (
        <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">整宫</span>
      ) : null}

      {floating}
    </div>
  )
}
