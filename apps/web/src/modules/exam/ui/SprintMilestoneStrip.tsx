import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import type { ExamOverview, FreestyleMilestoneUpcoming } from '@/shared/api/contracts'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/shared/components/ui/popover'
import { formatDaysLeft } from '../model/examFormat'

/**
 * Top-of-stage strip for the freestyle view: the countdown, then the nearest two
 * milestone days only.
 *
 * The full `ExamCountdownChip` also shows current mastery and the projected
 * ratio. During practice those numbers compete with the card for attention, so
 * this variant keeps the countdown and adds the next two checkpoints instead.
 * Each day carries every milestone on it — checkpoints cluster (10/31 holds both
 * 中国教育史完成 and 马原 8 宫完成), and hiding the sibling would misread the day.
 */
export function SprintMilestoneStrip({
  overview,
  milestones,
  className = '',
  compact = false,
}: {
  overview: ExamOverview | null
  milestones: FreestyleMilestoneUpcoming | null | undefined
  className?: string
  /**
   * One truncated line for the freestyle stage header: countdown + the nearest
   * milestone day. Tapping opens the full list. The wrapping pill variant is
   * for hosts with room; on a phone it became a three-line block over the card.
   */
  compact?: boolean
}) {
  const groups = milestones?.groups ?? []
  if (!overview?.settings.exam_date && groups.length === 0) return null

  if (compact) {
    const nearest = groups[0] ?? null
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="freestyle-milestone-line"
            aria-label="考试倒计时与近期里程碑，点击展开全部"
            className={`pointer-events-auto flex w-full min-w-0 items-center gap-1.5 rounded-full py-0.5 text-left text-[11px] leading-4 text-stage-muted transition-colors hover:text-stage-ink ${className}`}
          >
            {overview?.settings.exam_date ? (
              <span className="shrink-0 font-semibold text-stage-glow">
                {formatDaysLeft(overview.days_left)}
              </span>
            ) : null}
            {nearest ? (
              <>
                <span aria-hidden className="shrink-0 text-stage-faint">·</span>
                <span className="min-w-0 truncate">
                  <span className="font-semibold tabular-nums text-stage-ink">
                    {nearest.date.slice(5).replace('-', '/')}
                  </span>
                  <span className="ml-1 text-stage-faint">
                    {nearest.days_left === 0 ? '今天' : `${nearest.days_left} 天后`}
                  </span>
                  <span className="ml-1">{nearest.items.map((item) => item.title).join(' · ')}</span>
                </span>
              </>
            ) : null}
            <ChevronDown aria-hidden className="ml-auto size-3 shrink-0 text-stage-faint" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(20rem,calc(100vw-1.5rem))] border-stage-line-strong bg-stage-raised p-3 text-stage-ink">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold">
              {overview?.settings.exam_date ? '考试倒计时' : '近期里程碑'}
            </span>
            {overview?.settings.exam_date ? (
              <span className="text-xs font-semibold text-stage-glow">
                {formatDaysLeft(overview.days_left)}
              </span>
            ) : null}
          </div>
          <ul className="mt-2 flex flex-col gap-2">
            {groups.map((group) => (
              <li key={group.date} className="text-[11px] leading-5">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-semibold tabular-nums">
                    {group.date.slice(5).replace('-', '/')}
                  </span>
                  <span className="text-stage-muted">
                    {group.days_left === 0 ? '今天' : `${group.days_left} 天后`}
                  </span>
                </div>
                <div className="text-stage-ink/90">
                  {group.items.map((item) => item.title).join(' · ')}
                </div>
              </li>
            ))}
          </ul>
          <Link
            to="/exam"
            className="mt-3 inline-flex text-[11px] font-medium text-stage-glow underline underline-offset-2"
          >
            打开考试作战室
          </Link>
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <div
      className={`pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-stage-line bg-surface-stage-raised/95 px-3 py-1 text-[11px] leading-5 text-ink-stage shadow-sm ${className}`}
      aria-label="考试倒计时与近期里程碑"
    >
      {overview?.settings.exam_date ? (
        <Link to="/exam" className="font-semibold text-stage-glow" title="打开考试作战室">
          {formatDaysLeft(overview.days_left)}
        </Link>
      ) : null}
      {groups.map((group) => (
        <span key={group.date} className="flex min-w-0 items-center gap-1">
          <span className="shrink-0 font-semibold tabular-nums text-ink-stage">
            {group.date.slice(5).replace('-', '/')}
            <span className="ml-1 font-normal text-ink-stage-muted">
              {group.days_left === 0 ? '今天' : `${group.days_left} 天后`}
            </span>
          </span>
          <span className="truncate text-ink-stage">
            {group.items.map((item) => item.title).join(' · ')}
          </span>
        </span>
      ))}
    </div>
  )
}
