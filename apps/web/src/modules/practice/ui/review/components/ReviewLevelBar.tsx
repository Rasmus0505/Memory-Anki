import { useCallback, useEffect, useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import {
  adjustUnitScheduleApi,
  type AdjustUnitScheduleResultDto,
} from '@/modules/practice/ui/review/api/unitReviewApi'
import { INTERVAL_BAND_BOUNDS, intervalBandLabel } from '@/modules/practice/ui/review/model/intervalBands'
import {
  intervalDaysUntil,
  isoDateFromStudyDay,
  schedulableDueMax,
  studyDayStart,
  toIsoDate,
} from '@/modules/practice/ui/review/model/scheduleLimits'
import { Button } from '@/shared/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/shared/components/ui/popover'
import { Slider } from '@/shared/components/ui/slider'
import { cn } from '@/shared/lib/utils'

const LEVELS = INTERVAL_BAND_BOUNDS.length
const LAST_LEVEL = LEVELS - 1
const QUICK_DAYS = [1, 3, 7] as const
const QUICK_LABELS: Record<number, string> = { 1: '明天', 3: '3天后', 7: '7天后' }

function operationId() {
  return (
    crypto.randomUUID?.() ??
    `unit-level-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
}

function clampLevel(value: number) {
  return Math.max(0, Math.min(LAST_LEVEL, Math.round(value)))
}

function dateLabel(value: string | null | undefined) {
  if (!value) return '未排期'
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return `${month}月${day}日`
}

function levelTargetDate(level: number) {
  return isoDateFromStudyDay(INTERVAL_BAND_BOUNDS[level])
}

function levelDays(level: number) {
  return INTERVAL_BAND_BOUNDS[level]
}

export type ReviewLevelBarProps = {
  unitId: string
  /** Display projection of the unit's earned interval band. */
  stageIndex: number
  intervalDays: number
  dueDate: string | null
  due: boolean
  wrongThisRound?: boolean
  /** False renders the level read-only (the review-units panel edits dates itself). */
  adjustable?: boolean
  compact?: boolean
  className?: string
  onScheduleAdjusted?: (result: AdjustUnitScheduleResultDto) => void
}

/**
 * One bar, two facts: the unit's current review level and where the learner
 * wants it to be. Dragging never writes on its own — releasing commits a draft
 * and the popover explains the exact date before 「应用」 books it.
 *
 * Level 0 is 首学 (today, and `has_passed` goes back to false); every higher
 * level books its nominal interval from today and marks the unit as learned.
 */
export function ReviewLevelBar({
  unitId,
  stageIndex,
  intervalDays,
  dueDate,
  due,
  wrongThisRound = false,
  adjustable = false,
  compact = false,
  className,
  onScheduleAdjusted,
}: ReviewLevelBarProps) {
  const current = clampLevel(stageIndex)
  const [draft, setDraft] = useState<number | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [customDate, setCustomDate] = useState<string>(() => levelTargetDate(current))
  const [useCustomDate, setUseCustomDate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const maxDate = useMemo(() => schedulableDueMax(), [])
  const minDate = useMemo(() => toIsoDate(studyDayStart()), [])

  useEffect(() => {
    setDraft(null)
    setConfirmOpen(false)
    setError(null)
    setUseCustomDate(false)
  }, [unitId])

  const target = draft == null ? current : clampLevel(draft)
  const targetDate = useCustomDate ? customDate : levelTargetDate(target)
  const targetDays = useCustomDate ? (intervalDaysUntil(customDate) ?? 0) : levelDays(target)

  const openConfirm = useCallback(
    (level: number) => {
      const next = clampLevel(level)
      if (next === current) {
        setDraft(null)
        return
      }
      setDraft(next)
      setCustomDate(levelTargetDate(next))
      setUseCustomDate(false)
      setError(null)
      setConfirmOpen(true)
    },
    [current],
  )

  const closeConfirm = useCallback(() => {
    setConfirmOpen(false)
    setDraft(null)
    setError(null)
    setUseCustomDate(false)
  }, [])

  const apply = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = useCustomDate
        ? await adjustUnitScheduleApi(unitId, {
            operation_id: operationId(),
            due_date: customDate,
          })
        : await adjustUnitScheduleApi(unitId, {
            operation_id: operationId(),
            stage_index: target,
            has_passed: target > 0,
          })
      onScheduleAdjusted?.(result)
      setConfirmOpen(false)
      setDraft(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '调整失败，请重试')
    } finally {
      setBusy(false)
    }
  }, [busy, customDate, onScheduleAdjusted, target, unitId, useCustomDate])

  const currentLabel = intervalBandLabel(current)
  const targetLabel = intervalBandLabel(target)

  return (
    <Popover
      open={confirmOpen}
      onOpenChange={(next) => {
        if (!next) closeConfirm()
      }}
    >
      <PopoverAnchor asChild>
        <div
          data-testid="review-level-bar"
          data-adjustable={adjustable ? 'true' : undefined}
          data-wrong-this-round={wrongThisRound ? 'true' : undefined}
          title={wrongThisRound ? '本轮关联题目答错' : undefined}
          className={cn(
            'flex min-w-0 flex-1 flex-col gap-1',
            compact ? 'max-w-52' : 'max-w-[26rem]',
            className,
          )}
        >
          <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] leading-4">
            <span className="truncate text-foreground" data-testid="review-level-current">
              等级 {current + 1} · {currentLabel}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {due ? '今天到期' : `间隔 ${Math.max(0, Math.round(intervalDays))}天`}
            </span>
          </div>
          <Slider
            data-testid="review-level-slider"
            thumbAriaLabel="复习等级"
            min={0}
            max={LAST_LEVEL}
            step={1}
            value={[draft ?? current]}
            disabled={!adjustable || busy}
            onValueChange={(value) => setDraft(clampLevel(value[0]))}
            onValueCommit={(value) => openConfirm(value[0])}
            className={cn(!adjustable && 'opacity-80', wrongThisRound && '[&_[data-slot=slider-range]]:bg-red-500 [&_[data-slot=slider-track]]:bg-red-500/30 [&_[role=slider]]:border-red-500')}
          />
          {compact ? null : (
            <div className="flex items-center justify-between text-[10px] leading-3 text-muted-foreground">
              <span>首学</span>
              <span>{dueDate ? dateLabel(dueDate) : '未排期'}</span>
              <span>365天以上</span>
            </div>
          )}
        </div>
      </PopoverAnchor>

      <PopoverContent align="center" side="bottom" className="w-80 space-y-3 p-3">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">调整复习等级</p>
          <p className="text-xs text-muted-foreground">
            {useCustomDate
              ? `精确日期 ${dateLabel(targetDate)} · 间隔 ${targetDays}天`
              : target === 0
                ? '首学 · 今天（重置为第一次学）'
                : `等级 ${target + 1} · ${targetLabel} · ${dateLabel(targetDate)} · 间隔 ${targetDays}天`}
          </p>
        </div>

        <div className="flex gap-1.5">
          {QUICK_DAYS.map((days) => {
            const level = INTERVAL_BAND_BOUNDS.indexOf(days)
            const active = !useCustomDate && target === level
            return (
              <button
                key={days}
                type="button"
                data-testid={`review-level-quick-${days}`}
                disabled={Boolean(busy)}
                onClick={() => {
                  setDraft(level)
                  setCustomDate(levelTargetDate(level))
                  setUseCustomDate(false)
                }}
                className={cn(
                  'flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors',
                  active
                    ? 'border-primary/60 bg-primary/10 text-primary'
                    : 'border-border/70 hover:border-primary/50 hover:bg-primary/5',
                )}
              >
                {QUICK_LABELS[days]}
              </button>
            )
          })}
        </div>

        <div className="space-y-1.5 border-t border-border/60 pt-2.5">
          <label className="text-xs font-medium" htmlFor={`review-level-date-${unitId}`}>
            精确日期
          </label>
          <input
            id={`review-level-date-${unitId}`}
            data-testid="review-level-custom-date"
            type="date"
            min={minDate}
            max={maxDate}
            value={customDate}
            disabled={Boolean(busy)}
            onChange={(event) => {
              setCustomDate(event.target.value)
              setUseCustomDate(true)
            }}
            className="h-8 w-full rounded-md border border-border/70 bg-background px-2 text-xs"
          />
        </div>

        <p className="text-[11px] leading-4 text-muted-foreground">
          只改排期，不改记忆评估；下次评分会按新间隔继续。
        </p>

        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={Boolean(busy)} onClick={closeConfirm}>
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="review-level-apply"
            disabled={Boolean(busy) || (useCustomDate && !customDate)}
            onClick={() => void apply()}
          >
            {busy ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : null}
            应用
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
