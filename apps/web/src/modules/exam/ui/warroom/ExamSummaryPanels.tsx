import { Link } from 'react-router-dom'
import type { ExamOverview, ExamPalaceRow } from '@/shared/api/contracts'
import { formatDaysLeft, formatPercent } from '../../model/examFormat'
import { ExamStarBadge } from '../ExamStarBadge'

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border/60">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums tracking-tight">{value}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  )
}

export function ExamHeadline({ overview }: { overview: ExamOverview }) {
  const { totals, days_left: daysLeft, settings } = overview
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label={settings.exam_name || '考试倒计时'}
        value={daysLeft == null ? '—' : daysLeft >= 0 ? `${daysLeft} 天` : '已结束'}
        hint={settings.exam_date ? `${settings.exam_date} · ${formatDaysLeft(daysLeft)}` : '在下方设置考试日期'}
      />
      <Stat
        label="当前掌握率"
        value={formatPercent(totals.mastery_ratio)}
        hint={`已学 ${totals.learned_count}/${totals.unit_count} 单元`}
      />
      <Stat
        label="考前预测掌握率"
        value={formatPercent(totals.predicted_ratio)}
        hint={`若从今天起停学：${formatPercent(totals.predicted_if_idle_ratio)}`}
      />
      <Stat
        label="每日新学进度"
        value={`${totals.pace_per_day}/天`}
        hint={daysLeft && daysLeft > 0 ? `学完需要 ${totals.needed_per_day}/天` : `累计学习 ${totals.study_days} 天`}
      />
    </div>
  )
}

export function ExamStarDistribution({ overview }: { overview: ExamOverview }) {
  const maxUnits = Math.max(1, ...overview.stars.map((row) => row.unit_count))
  return (
    <div className="flex flex-col gap-3">
      {overview.stars.map((row) => (
        <div key={row.stars} className="flex items-center gap-3 text-sm">
          <ExamStarBadge stars={row.stars} className="w-12 shrink-0" />
          <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-primary/25"
              style={{ width: `${(row.unit_count / maxUnits) * 100}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-success"
              style={{ width: `${(row.unit_count / maxUnits) * row.mastery_ratio * 100}%` }}
            />
          </div>
          <span className="w-40 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
            {row.palace_count} 宫殿 · {row.unit_count} 单元 · 掌握 {formatPercent(row.mastery_ratio)}
          </span>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">{overview.star_rule.description}</p>
    </div>
  )
}

export function ExamWeakList({ rows, emptyText = '暂时没有明显薄弱的宫殿。' }: { rows: ExamPalaceRow[]; emptyText?: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{emptyText}</p>
  return (
    <ol className="flex flex-col divide-y divide-border/60">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-3 py-2 text-sm">
          <ExamStarBadge stars={row.stars} className="w-12 shrink-0" />
          <Link to={`/palaces/${row.id}`} className="min-w-0 flex-1 truncate hover:underline">
            {row.title}
          </Link>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            记住 {formatPercent(row.recall)} · {row.learned_count}/{row.unit_count}
          </span>
        </li>
      ))}
    </ol>
  )
}
