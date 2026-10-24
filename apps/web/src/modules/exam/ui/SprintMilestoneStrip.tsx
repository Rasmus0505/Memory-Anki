import { Link } from 'react-router-dom'
import type { ExamOverview, FreestyleMilestoneUpcoming } from '@/shared/api/contracts'
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
}: {
  overview: ExamOverview | null
  milestones: FreestyleMilestoneUpcoming | null | undefined
  className?: string
}) {
  const groups = milestones?.groups ?? []
  if (!overview?.settings.exam_date && groups.length === 0) return null

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
