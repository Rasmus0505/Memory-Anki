import type { FreestyleOverviewResponse } from '@/shared/api/contracts'
import { formatPalaceUnit } from '@/modules/practice/ui/freestyle/model/formatPalaceUnit'

const PREVIEW_LIMIT = 3

interface FreestyleDayRecapProps {
  yesterday: FreestyleOverviewResponse['yesterday']
  onDismiss: () => void
}

export function FreestyleDayRecap({ yesterday, onDismiss }: FreestyleDayRecapProps) {
  const weak = yesterday.weak_units.slice(0, PREVIEW_LIMIT)
  return (
    <section
      aria-label="昨日回顾"
      className="flex flex-col gap-3 rounded-2xl border border-stage-line bg-stage-raised p-4 text-stage-ink"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">昨天的回顾</h3>
        <button type="button" onClick={onDismiss} className="text-xs text-stage-muted">
          知道了
        </button>
      </div>
      {yesterday.learned_units === 0 ? (
        <p className="text-sm text-stage-muted">昨天没有学习记录</p>
      ) : (
        <p className="text-sm text-stage-muted">
          学了{' '}
          <span className="tabular-nums text-stage-ink">
            {formatPalaceUnit(yesterday.learned_palace_count, yesterday.learned_units)}
          </span>
        </p>
      )}
      {weak.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-stage-muted">还比较薄弱</span>
          <ul className="flex flex-col gap-1 text-sm">
            {weak.map((item) => (
              <li key={item.unit_id} className="flex justify-between gap-3">
                <span className="truncate">{item.name || item.palace_name}</span>
                <span className="shrink-0 tabular-nums text-stage-muted">
                  忘记 {Math.round(item.again_ratio * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
