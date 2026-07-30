import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  getPalaceLadderProgressApi,
  type LadderProgressRange,
  type PalaceLadderProgressDto,
} from '../api/unitReviewApi'
import { cn } from '@/shared/lib/utils'

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
const DEFAULT_LADDER = [0, 1, 3, 7, 14, 30, 60, 120, 240, 365] as const
const EMPTY_SUMMARY = {
  range: 'all' as LadderProgressRange,
  unit_count: 0,
  total_seconds: 0,
  freestyle_rating_count: 0,
  quiz_count: 0,
}

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

function stageLabel(intervalDays: number): string {
  return intervalDays === 0 ? '首学阶段' : `${intervalDays}天阶段`
}

function compactStageLabel(intervalDays: number): string {
  return intervalDays === 0 ? '首学' : `${intervalDays}天`
}

type NodeKind = 'past' | 'current' | 'future'

function nodeKind(stageIndex: number, currentStage: number | null): NodeKind {
  if (currentStage == null) return 'future'
  if (stageIndex < currentStage) return 'past'
  if (stageIndex === currentStage) return 'current'
  return 'future'
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
}

export function PalaceLadderProgress({
  palaceId,
  unitId = null,
  className,
  refreshKey = null,
}: PalaceLadderProgressProps) {
  const [range, setRange] = useState<LadderProgressRange>(() => readStoredRange())
  const [data, setData] = useState<PalaceLadderProgressDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hoverStage, setHoverStage] = useState<number | null>(null)
  const [hoverTrack, setHoverTrack] = useState(false)
  const [hoverSummary, setHoverSummary] = useState<'range' | 'palace' | null>(null)
  const [floatPos, setFloatPos] = useState<FloatingPos | null>(null)
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
    setHoverStage(null)
    setHoverTrack(false)
    setHoverSummary(null)
    setFloatPos(null)
  }, [clearHideTimer])

  const scheduleHide = useCallback(() => {
    clearHideTimer()
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null
      setHoverStage(null)
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
      setError(err instanceof Error ? err.message : '加载阶梯进度失败')
    }
  }, [palaceId, range, unitId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const currentStage = data?.current?.stage_index ?? null
  const currentDue = Boolean(data?.current?.due)
  const ladder = useMemo(
    () => (data?.ladder?.length ? data.ladder : [...DEFAULT_LADDER]),
    [data?.ladder],
  )
  const lastIndex = Math.max(1, ladder.length - 1)
  const fillRatio =
    currentStage == null ? 0 : Math.max(0, Math.min(1, currentStage / lastIndex))

  useEffect(() => {
    if (hoverStage == null && !hoverTrack && !hoverSummary) return
    const reposition = () => {
      if (hoverStage != null) {
        const days = ladder[hoverStage]
        const node = document.querySelector<HTMLElement>(
          `[data-testid="ladder-node-${days}"]`,
        )
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
  }, [hoverStage, hoverSummary, hoverTrack, ladder])

  const handleRangeChange = (next: LadderProgressRange) => {
    setRange(next)
    try {
      localStorage.setItem(RANGE_STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }

  const stageTooltip = useMemo(() => {
    if (hoverStage == null || !data) return null
    const interval = ladder[hoverStage] ?? 0
    const kind = nodeKind(hoverStage, currentStage)
    const status =
      kind === 'past'
        ? '已走过'
        : kind === 'current'
          ? (currentDue ? '当前 · 已到期' : '当前')
          : '未到达'
    const stats = data.unit_range_stats.per_stage[hoverStage]
    const passCount = stats?.pass_count ?? 0
    const seconds = stats?.seconds ?? 0
    const hasDetails = passCount > 0 || seconds > 0 || Boolean(stats?.last_at)
    const rangeLabel = RANGE_LABELS[range]
    const emptyText =
      range === 'all' && kind === 'past'
        ? '无可用历史明细（可能由跨级或旧进度产生）'
        : kind === 'future' && range === 'all'
          ? '尚未到达本阶段'
          : `${rangeLabel}内无直接复习记录`
    return {
      title: stageLabel(interval),
      status,
      unitTitle: data.current?.title || '未命名单元',
      dueText:
        kind === 'current' && data.current?.due_date
          ? `下次复习：${formatShortDate(data.current.due_date)}${currentDue ? '（已到期）' : ''}`
          : null,
      rangeLabel,
      passCount,
      lastAt: formatShortDate(stats?.last_at),
      seconds: formatSeconds(seconds),
      hasDetails,
      emptyText,
    }
  }, [currentDue, currentStage, data, hoverStage, ladder, range])

  const trackTooltip = useMemo(() => {
    if (!hoverTrack || hoverStage != null || hoverSummary != null || !data) return null
    const histogram = data.palace.stage_histogram || []
    const distribution = ladder
      .map((days, index) => {
        const count = histogram[index] ?? 0
        return count > 0 ? `${compactStageLabel(days)}×${count}` : null
      })
      .filter(Boolean)
      .join(' · ')
    const share = data.palace_range_stats.rating_share
    const rangeLabel = RANGE_LABELS[range]
    return {
      current: data.current
        ? stageLabel(data.current.interval_days)
        : '无当前单元',
      unitTitle: data.current?.title || '未命名单元',
      due: data.current?.due_date
        ? `下次复习：${formatShortDate(data.current.due_date)}${data.current.due ? '（已到期）' : ''}`
        : null,
      palace: `宫殿：${data.palace.unit_count} 个单元 · ${data.palace.due_count} 个到期`
        + (data.palace.weakest_stage_index != null
          ? ` · 最弱 ${stageLabel(ladder[data.palace.weakest_stage_index] ?? 1)}`
          : ''),
      distribution: `等级分布：${distribution || '暂无分布'}`,
      reviews: data.palace_range_stats.total_reviews > 0 || data.palace_range_stats.total_seconds > 0
        ? `${rangeLabel}：${data.palace_range_stats.total_reviews} 次 · 学习总时长 ${formatSeconds(data.palace_range_stats.total_seconds)}`
        : `${rangeLabel}：无复习明细`,
      ratings: `评分：忘记 ${share.forgot} · 困难 ${share.hard} · 记得 ${share.remember} · 轻松 ${share.easy}`,
      scope: data.scope === 'unit' ? '当前单元' : '整宫最弱',
    }
  }, [data, hoverStage, hoverSummary, hoverTrack, ladder, range])

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

  const openStage = (index: number, el: HTMLElement) => {
    clearHideTimer()
    setHoverStage(index)
    setHoverTrack(false)
    setHoverSummary(null)
    setFloatPos(positionBelow(el))
  }

  const openTrack = (el: HTMLElement) => {
    clearHideTimer()
    setHoverTrack(true)
    setHoverSummary(null)
    if (hoverStage == null) setFloatPos(positionBelow(el, 300))
  }

  const openSummary = (scope: 'range' | 'palace', el: HTMLElement) => {
    clearHideTimer()
    setHoverStage(null)
    setHoverTrack(false)
    setHoverSummary(scope)
    setFloatPos(positionBelow(el, 260))
  }

  if (!palaceId) return null

  const floating =
    floatPos && (stageTooltip || trackTooltip || summaryTooltip) && typeof document !== 'undefined'
      ? createPortal(
          <div
            role="tooltip"
            data-testid={stageTooltip ? 'ladder-stage-tooltip' : summaryTooltip ? 'ladder-summary-tooltip' : 'ladder-track-tooltip'}
            className="pointer-events-none w-max max-w-[280px] rounded-lg border border-border bg-popover px-2.5 py-2 text-left text-[11px] text-popover-foreground shadow-xl"
            style={{
              position: 'fixed',
              left: floatPos.left,
              top: floatPos.top,
              transform: 'translateX(-50%)',
              zIndex: TOOLTIP_Z,
            }}
          >
            {stageTooltip ? (
              <>
                <div className="font-semibold">
                  {stageTooltip.title} · {stageTooltip.status}
                </div>
                <div className="mt-1 text-muted-foreground">单元：{stageTooltip.unitTitle}</div>
                {stageTooltip.dueText ? (
                  <div className="text-muted-foreground">{stageTooltip.dueText}</div>
                ) : null}
                {stageTooltip.hasDetails ? (
                  <>
                    <div className="text-muted-foreground">
                      {stageTooltip.rangeLabel}：{stageTooltip.passCount} 次
                    </div>
                    <div className="text-muted-foreground">最近通过：{stageTooltip.lastAt}</div>
                    <div className="text-muted-foreground">学习总时长：{stageTooltip.seconds}</div>
                  </>
                ) : (
                  <div className="text-muted-foreground">{stageTooltip.emptyText}</div>
                )}
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

  const currentLabel = data?.current
    ? stageLabel(data.current.interval_days)
    : null

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
        className="relative min-h-8 min-w-[120px] flex-1 overflow-visible px-1"
        onMouseEnter={(event) => openTrack(event.currentTarget)}
        onMouseLeave={scheduleHide}
      >
        <div
          className="relative h-8 w-full"
          role="img"
          aria-label={
            data?.current
              ? `复习阶梯 · 当前 ${stageLabel(data.current.interval_days)}`
              : '复习阶梯'
          }
        >
          {/* Base rail */}
          <div className="pointer-events-none absolute inset-x-1 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-muted" />
          {/* Progress fill to current stage */}
          <div
            className={cn(
              'pointer-events-none absolute left-1 top-1/2 h-[3px] -translate-y-1/2 rounded-full',
              currentDue ? 'bg-amber-500/80' : 'bg-primary/75',
            )}
            style={{ width: `calc((100% - 8px) * ${fillRatio})` }}
          />

          {ladder.map((days, index) => {
            const kind = nodeKind(index, currentStage)
            const isCurrent = kind === 'current'
            const overdue = isCurrent && currentDue
            const leftPct = (index / lastIndex) * 100
            return (
              <button
                key={days}
                type="button"
                data-testid={`ladder-node-${days}`}
                data-kind={kind}
                aria-label={stageLabel(days)}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'absolute top-1/2 box-border size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-colors duration-100',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  kind === 'past' && 'border-primary/50 bg-primary/80',
                  kind === 'current'
                    && !overdue
                    && 'z-[1] border-primary bg-primary',
                  kind === 'current'
                    && overdue
                    && 'z-[1] border-amber-500 bg-amber-500',
                  kind === 'future' && 'border-muted-foreground/35 bg-background',
                  isCurrent && 'size-3.5',
                )}
                style={{ left: `${leftPct}%` }}
                onMouseEnter={(event) => openStage(index, event.currentTarget)}
                onMouseLeave={scheduleHide}
                onFocus={(event) => openStage(index, event.currentTarget)}
                onBlur={hideFloating}
              />
            )
          })}
        </div>

        {error && !data ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
            进度暂不可用
          </div>
        ) : null}
      </div>

      {currentLabel ? (
        <span
          className={cn(
            'hidden shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] tabular-nums sm:inline',
            currentDue
              ? 'bg-amber-500/15 text-amber-200'
              : 'bg-primary/10 text-primary',
          )}
          title={currentDue ? `${currentLabel} · 已到期` : currentLabel}
        >
          {compactStageLabel(data?.current?.interval_days ?? 0)}
        </span>
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
