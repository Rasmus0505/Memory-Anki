import type { ExamOverview } from '@/shared/api/contracts'

const WIDTH = 560
const HEIGHT = 180
const PAD = { top: 12, right: 12, bottom: 22, left: 34 }

function toPath(points: [number, number][]): string {
  return points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
}

export function ExamRetentionChart({ retention, daysLeft }: { retention: ExamOverview['retention']; daysLeft: number | null }) {
  const innerW = WIDTH - PAD.left - PAD.right
  const innerH = HEIGHT - PAD.top - PAD.bottom
  const observed = retention.observed
  const projected = retention.projected
  const span = observed.length + projected.length - 1
  const xAt = (index: number) => PAD.left + (span > 0 ? (index / span) * innerW : 0)
  const yAt = (value: number) => PAD.top + (1 - Math.max(0, Math.min(1, value))) * innerH

  const observedPoints: [number, number][] = observed
    .map((row, index) => (row.pass_rate == null ? null : ([xAt(index), yAt(row.pass_rate)] as [number, number])))
    .filter((point): point is [number, number] => point !== null)
  const projectedPoints: [number, number][] = projected.map((row, index) => [
    xAt(observed.length - 1 + index),
    yAt(row.recall),
  ])
  const todayX = xAt(observed.length - 1)
  const examIndex = daysLeft != null && daysLeft >= 0 && daysLeft < projected.length ? observed.length - 1 + daysLeft : null
  const areaPath = projectedPoints.length
    ? `${toPath(projectedPoints)} L${projectedPoints.at(-1)![0].toFixed(1)},${yAt(0)} L${projectedPoints[0]![0].toFixed(1)},${yAt(0)} Z`
    : ''
  const lastProjected = projected.at(-1)?.recall ?? 0

  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`记忆保留曲线：过去 ${observed.length} 天为实际通过率，今天之后为不复习时的预测保留率，最低降至 ${Math.round(lastProjected * 100)}%`}
      >
        <defs>
          <linearGradient id="exam-retention-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 0.9, 1].map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={yAt(tick)}
              y2={yAt(tick)}
              stroke="var(--color-border)"
              strokeDasharray={tick === 0.9 ? '4 4' : undefined}
              strokeOpacity={tick === 0.9 ? 0.9 : 0.5}
            />
            <text x={PAD.left - 6} y={yAt(tick) + 3} textAnchor="end" fontSize="10" fill="var(--color-muted-foreground)">
              {Math.round(tick * 100)}%
            </text>
          </g>
        ))}
        {areaPath ? <path d={areaPath} fill="url(#exam-retention-fill)" /> : null}
        {projectedPoints.length ? (
          <path d={toPath(projectedPoints)} fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeDasharray="5 4" />
        ) : null}
        {observedPoints.length ? (
          <path d={toPath(observedPoints)} fill="none" stroke="var(--color-success)" strokeWidth="2.25" strokeLinejoin="round" />
        ) : null}
        {observedPoints.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="2.5" fill="var(--color-success)" />
        ))}
        <line x1={todayX} x2={todayX} y1={PAD.top} y2={yAt(0)} stroke="var(--color-foreground)" strokeOpacity="0.25" />
        <text x={todayX} y={HEIGHT - 6} textAnchor="middle" fontSize="10" fill="var(--color-muted-foreground)">
          今天
        </text>
        {examIndex != null ? (
          <g>
            <line x1={xAt(examIndex)} x2={xAt(examIndex)} y1={PAD.top} y2={yAt(0)} stroke="var(--color-destructive)" strokeWidth="1.5" />
            <text x={xAt(examIndex)} y={HEIGHT - 6} textAnchor="middle" fontSize="10" fill="var(--color-destructive)">
              考试
            </text>
          </g>
        ) : null}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-success" aria-hidden="true" />
          过去 30 天实际通过率
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded border-t-2 border-dashed border-primary" aria-hidden="true" />
          从今天起不复习的预测保留
        </span>
        <span>虚线 90% 为复习目标线</span>
      </figcaption>
    </figure>
  )
}
