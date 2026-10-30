import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import {
  adjustUnitScheduleApi,
  type AdjustUnitScheduleResultDto,
} from '@/modules/practice/ui/review/api/unitReviewApi'
import {
  intervalDaysUntil,
  isoDateFromStudyDay,
  schedulableDueMax,
  studyDayStart,
  toIsoDate,
} from '@/modules/practice/ui/review/model/scheduleLimits'
import { Button } from '@/shared/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover'
import { cn } from '@/shared/lib/utils'

const PRESETS: Array<{ days: number; label: string }> = [
  { days: 1, label: '明天' },
  { days: 3, label: '3天后' },
  { days: 7, label: '7天后' },
  { days: 14, label: '14天后' },
  { days: 30, label: '30天后' },
]

function operationId() {
  return (
    crypto.randomUUID?.() ??
    `unit-schedule-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
}

function dateLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return `${month}月${day}日`
}

/**
 * Manual schedule override for one review unit.
 *
 * Deliberately explicit about what it does and does not touch: this write moves
 * the due date only. The memory assessment (FSRS stability/difficulty) and the
 * anchor counter stay as they are, so the next rating continues from the new
 * gap instead of pretending a review happened.
 */
export function UnitScheduleAdjustPopover({
  unitId,
  dueDate,
  open,
  onOpenChange,
  onAdjusted,
  children,
}: {
  unitId: string
  /** The due date the learner currently sees, for context. */
  dueDate: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdjusted?: (result: AdjustUnitScheduleResultDto) => void
  children: ReactNode
}) {
  const maxDate = useMemo(() => schedulableDueMax(), [])
  const minDate = useMemo(() => toIsoDate(studyDayStart()), [])
  const [customDate, setCustomDate] = useState(dueDate ?? minDate)
  const [busyDate, setBusyDate] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setCustomDate(dueDate && dueDate >= minDate && dueDate <= maxDate ? dueDate : minDate)
  }, [open, dueDate, minDate, maxDate])

  const save = async (nextDue: string) => {
    if (busyDate) return
    setBusyDate(nextDue)
    setError(null)
    try {
      const result = await adjustUnitScheduleApi(unitId, {
        operation_id: operationId(),
        due_date: nextDue,
      })
      onAdjusted?.(result)
      onOpenChange(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '调整失败，请重试')
    } finally {
      setBusyDate(null)
    }
  }

  const customValid = customDate >= minDate && customDate <= maxDate
  const customInterval = intervalDaysUntil(customDate)

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-80 space-y-3 p-3">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">调整复习进度</p>
          <p className="text-xs text-muted-foreground">
            {dueDate ? `当前到期 ${dateLabel(dueDate)}` : '当前没有已排的到期日'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((preset) => {
            const target = isoDateFromStudyDay(preset.days)
            if (target > maxDate) return null
            const busy = busyDate === target
            return (
              <button
                key={preset.days}
                type="button"
                data-testid={`schedule-preset-${preset.days}`}
                disabled={Boolean(busyDate)}
                onClick={() => void save(target)}
                className={cn(
                  'flex min-h-11 flex-col items-start rounded-lg border border-border/70 px-2.5 py-1.5 text-left transition-colors',
                  'hover:border-primary/50 hover:bg-primary/5 disabled:opacity-55',
                  target === dueDate && 'border-primary/60 bg-primary/10',
                )}
              >
                <span className="flex items-center gap-1 text-xs font-medium">
                  {preset.label}
                  {busy ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : null}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {dateLabel(target)} · 间隔 {preset.days}天
                </span>
              </button>
            )
          })}
        </div>

        <div className="space-y-1.5 border-t border-border/60 pt-2.5">
          <label className="text-xs font-medium" htmlFor={`unit-schedule-custom-${unitId}`}>
            自定义日期
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id={`unit-schedule-custom-${unitId}`}
              data-testid="schedule-custom-date"
              type="date"
              min={minDate}
              max={maxDate}
              value={customDate}
              disabled={Boolean(busyDate)}
              onChange={(event) => setCustomDate(event.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-border/70 bg-background px-2 text-xs"
            />
            <Button
              type="button"
              size="sm"
              data-testid="schedule-custom-save"
              disabled={!customValid || Boolean(busyDate)}
              onClick={() => void save(customDate)}
            >
              保存
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {customValid
              ? `到期 ${dateLabel(customDate)} · 间隔 ${customInterval ?? 0}天`
              : '最长一年，更远的日期不会保存。'}
          </p>
        </div>

        <p className="text-[11px] leading-4 text-muted-foreground">
          只改到期日，不改记忆评估；下次评分会按新间隔继续。
        </p>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
