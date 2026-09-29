import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ExamOverview, ExamPalaceRow } from '@/shared/api/contracts'
import { getExamOverviewApi } from '../api/examApi'
import { formatDaysLeft, formatPercent } from '../model/examFormat'
import { ExamStarBadge } from './ExamStarBadge'
import { FX_ANCHORS } from '@/shared/fx'

export interface LitPalace {
  palace: ExamPalaceRow
  gainedUnits: number
  masteryDelta: number
}

/** Palaces whose learned units or mastery grew between two overview snapshots. */
export function diffLitPalaces(before: ExamOverview, after: ExamOverview): LitPalace[] {
  const previous = new Map(before.palaces.map((row) => [row.id, row]))
  const lit: LitPalace[] = []
  for (const row of after.palaces) {
    const old = previous.get(row.id)
    const gainedUnits = row.learned_count - (old?.learned_count ?? 0)
    const masteryDelta = row.mastery_ratio - (old?.mastery_ratio ?? 0)
    if (gainedUnits > 0 || masteryDelta > 0.001) lit.push({ palace: row, gainedUnits, masteryDelta })
  }
  return lit.sort((a, b) => b.palace.stars - a.palace.stars || b.gainedUnits - a.gainedUnits || b.masteryDelta - a.masteryDelta)
}

export function ExamRoundSummary({ baseline, roundKey }: { baseline: ExamOverview | null; roundKey: string }) {
  const [current, setCurrent] = useState<ExamOverview | null>(null)
  const tokenRef = useRef(0)

  useEffect(() => {
    const token = ++tokenRef.current
    setCurrent(null)
    void getExamOverviewApi()
      .then((overview) => {
        if (token === tokenRef.current) setCurrent(overview)
      })
      .catch(() => undefined)
    return () => {
      tokenRef.current += 1
    }
  }, [roundKey])

  if (!current) return null
  const lit = baseline ? diffLitPalaces(baseline, current).slice(0, 6) : []
  const before = baseline?.totals.mastery_ratio ?? current.totals.mastery_ratio
  const after = current.totals.mastery_ratio
  const weak = current.weak.slice(0, 4)

  return (
    <div data-testid="freestyle-round-exam-summary" data-fx-anchor={FX_ANCHORS.roundSummary} className="mt-4 flex flex-col gap-3 rounded-2xl border border-stage-line bg-stage-raised/70 p-4 text-left text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold tracking-[0.14em] text-stage-glow">离考试目标</span>
        <span className="text-xs text-stage-muted">{formatDaysLeft(current.days_left)}</span>
      </div>
      <div className="flex items-baseline gap-2 tabular-nums">
        <span className="text-stage-muted">{formatPercent(before)}</span>
        <span aria-hidden="true" className="text-stage-muted">→</span>
        <span className="text-xl font-semibold text-stage-ink">{formatPercent(after)}</span>
        <span className="text-xs text-stage-muted">当前掌握 · 考前预测 {formatPercent(current.totals.predicted_ratio)}</span>
      </div>

      {lit.length ? (
        <div>
          <div className="mb-1.5 text-xs text-stage-muted">这轮点亮</div>
          <ul className="flex flex-wrap gap-1.5">
            {lit.map(({ palace, gainedUnits }) => (
              <li
                key={palace.id}
                className="fs-lit-chip inline-flex items-center gap-1.5 rounded-full bg-rate-good/15 px-2.5 py-1 text-xs text-stage-ink"
              >
                <ExamStarBadge stars={palace.stars} />
                <span className="max-w-[10rem] truncate">{palace.title}</span>
                {gainedUnits > 0 ? <span className="text-rate-good">+{gainedUnits}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {weak.length ? (
        <div>
          <div className="mb-1.5 text-xs text-stage-muted">薄弱点</div>
          <ul className="flex flex-col gap-1">
            {weak.map((row) => (
              <li key={row.id} className="flex items-center gap-2 text-xs">
                <ExamStarBadge stars={row.stars} />
                <Link to={`/palaces/${row.id}`} className="min-w-0 flex-1 truncate text-stage-ink hover:underline">
                  {row.title}
                </Link>
                <span className="tabular-nums text-stage-muted">记住 {formatPercent(row.recall)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Link to="/exam" className="self-start text-xs text-stage-glow hover:underline">
        打开考试作战室 →
      </Link>
    </div>
  )
}
