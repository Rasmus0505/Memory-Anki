import { Link } from 'react-router-dom'
import type { ExamOverview } from '@/shared/api/contracts'
import { formatDaysLeft, formatPercent } from '../model/examFormat'

export function ExamCountdownChip({ overview, className = '' }: { overview: ExamOverview | null; className?: string }) {
  if (!overview) return null
  const { totals, days_left: daysLeft } = overview
  const mastery = totals.mastery_ratio
  return (
    <Link
      to="/exam"
      className={`exam-countdown-chip ${className}`}
      aria-label={`${formatDaysLeft(daysLeft)}，当前掌握 ${formatPercent(mastery)}，预测考前 ${formatPercent(totals.predicted_ratio)}`}
      title="打开考试作战室"
    >
      <span>{formatDaysLeft(daysLeft)}</span>
      <span className="exam-countdown-bar" aria-hidden="true">
        <span style={{ width: `${Math.round(mastery * 100)}%` }} />
      </span>
      <span>
        {formatPercent(mastery)}
        <span className="exam-countdown-forecast opacity-60"> → {formatPercent(totals.predicted_ratio)}</span>
      </span>
    </Link>
  )
}
