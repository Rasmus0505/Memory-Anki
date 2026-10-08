import {
  overlayScopeActivePalaces,
  overlayScopeBlockedPalaces,
  overlayScopeReasonLabel,
  overlayScopeSummary,
} from '@/modules/practice/ui/freestyle/model/overlayQuizRange'
import type { FreestyleOverlayScopePalaces } from '@/shared/api/contracts'

/**
 * The 做题 scope list.
 *
 * Renders the backend's `scope_palaces` report as-is. It exists as its own
 * component because the report is the *only* place scope membership is decided:
 * keeping the rendering isolated makes it obvious that nothing here re-derives
 * the palace set from the round plan or the feed config.
 *
 * Opens by default when nothing is playable, because that is exactly the case
 * where the learner needs to see why.
 */
export function OverlayQuizScopeList({
  scopePalaces,
}: {
  scopePalaces: FreestyleOverlayScopePalaces | null
}) {
  const active = overlayScopeActivePalaces(scopePalaces)
  const blocked = overlayScopeBlockedPalaces(scopePalaces)
  if (!scopePalaces || scopePalaces.scheduled_count === 0) return null
  return (
    <details
      data-testid="freestyle-scope-list"
      className="rounded-xl border border-border/60 bg-background/80 px-3.5 py-3"
      open={active.length === 0}
    >
      <summary className="cursor-pointer text-sm font-medium">
        本次做题范围（{scopePalaces.in_pool_count} 座可做 / 共 {scopePalaces.scheduled_count} 座）
      </summary>
      <ul className="mt-2 space-y-1.5">
        {active.map((row) => (
          <li key={row.palace_id} className="flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate" title={row.title}>{row.title}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {row.question_count} 题
              {row.subjective > 0 && row.objective > 0
                ? `（客观 ${row.objective} · 主观 ${row.subjective}）`
                : ''}
            </span>
          </li>
        ))}
        {blocked.map((row) => (
          <li
            key={row.palace_id}
            className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
          >
            <span className="min-w-0 truncate" title={row.title}>{row.title}</span>
            <span className="shrink-0">
              {overlayScopeReasonLabel(row.reason)}
              {row.question_count > 0 ? ` · 有 ${row.question_count} 题` : ''}
            </span>
          </li>
        ))}
      </ul>
      {blocked.some((row) => row.reason === 'palace_removed') ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          标为「已移除队列」的宫殿，是它的卡片都从本轮队列移除了，所以它的题也一起移出；
          本轮重新安排它，题就会回来，已答记录也还在。
        </p>
      ) : null}
    </details>
  )
}

/** Summary line above the list. Same report, so the two can never disagree. */
export function OverlayQuizScopeSummary({
  scopePalaces,
}: {
  scopePalaces: FreestyleOverlayScopePalaces | null
}) {
  return (
    <p className="text-sm text-muted-foreground">
      {overlayScopeSummary(scopePalaces)}。只出这些宫殿的题，不会改训练方向。
    </p>
  )
}

/**
 * Notice shown when a 随心 config edit took palaces out of 做题.
 *
 * Named palaces, not a bare count: a silent shrink was half of the original
 * complaint, so the copy has to say *which* ones left.
 */
export function OverlayQuizScopeLeftNotice({
  notice,
  onDismiss,
}: {
  notice: string
  onDismiss: () => void
}) {
  if (!notice) return null
  return (
    <div
      data-testid="freestyle-scope-left-notice"
      className="flex items-start justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200"
    >
      <span className="min-w-0">{notice}</span>
      <button type="button" className="shrink-0 underline underline-offset-2" onClick={onDismiss}>
        知道了
      </button>
    </div>
  )
}
