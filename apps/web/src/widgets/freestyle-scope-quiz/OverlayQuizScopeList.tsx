import { useState } from 'react'
import {
  overlayScopeActivePalaces,
  overlayScopeBlockedPalaces,
  overlayScopeReasonLabel,
  overlayScopeSummary,
} from '@/modules/practice/ui/freestyle/model/overlayQuizRange'
import type { FreestyleOverlayScopePalaces } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

type ScopeRow = FreestyleOverlayScopePalaces['palaces'][number]

/**
 * The 做题 scope list.
 *
 * Renders the backend's `scope_palaces` report as-is. It exists as its own
 * component because the report is the *only* place scope membership is decided:
 * keeping the rendering isolated makes it obvious that nothing here re-derives
 * the palace set from the round plan or the feed config.
 *
 * Rows can be multi-selected to delete them from 做题 or reset those deletions.
 * Both actions go through `onSetSkipped` and the backend decides the result;
 * the selection only chooses which palaces the request names.
 *
 * Opens by default when nothing is playable, because that is exactly the case
 * where the learner needs to see why.
 */
export function OverlayQuizScopeList({
  scopePalaces,
  onSetSkipped,
}: {
  scopePalaces: FreestyleOverlayScopePalaces | null
  /** Omit to render the read-only list. */
  onSetSkipped?: (palaceIds: number[], skipped: boolean) => Promise<void>
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = overlayScopeActivePalaces(scopePalaces)
  const blocked = overlayScopeBlockedPalaces(scopePalaces)
  if (!scopePalaces || scopePalaces.scheduled_count === 0) return null

  const rows: ScopeRow[] = [...active, ...blocked]
  // 移除本队列 is owned by the round's card queue; this list cannot undo it.
  const deleteIds = rows
    .filter((row) => selected.has(row.palace_id) && row.reason !== 'palace_removed')
    .map((row) => row.palace_id)
  const resetIds = rows
    .filter((row) => selected.has(row.palace_id) && row.reason === 'palace_skipped')
    .map((row) => row.palace_id)
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.palace_id))

  const toggle = (palaceId: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(palaceId)) next.delete(palaceId)
      else next.add(palaceId)
      return next
    })
  }
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.palace_id)))
  }
  const apply = async (palaceIds: number[], skipped: boolean) => {
    if (!onSetSkipped || palaceIds.length === 0 || busy) return
    setBusy(true)
    setError('')
    try {
      await onSetSkipped(palaceIds, skipped)
      setSelected(new Set())
    } catch {
      setError('没有保存成功，请再试一次')
    } finally {
      setBusy(false)
    }
  }

  return (
    <details
      data-testid="freestyle-scope-list"
      className="rounded-xl border border-border/60 bg-background/80 px-3.5 py-3"
      open={active.length === 0}
    >
      <summary className="cursor-pointer text-sm font-medium">
        本次做题范围（{scopePalaces.in_pool_count} 座可做 / 共 {scopePalaces.scheduled_count} 座）
      </summary>
      {onSetSkipped ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              aria-label="全选宫殿"
              checked={allSelected}
              disabled={busy}
              onChange={toggleAll}
            />
            全选
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || deleteIds.length === 0}
            onClick={() => void apply(deleteIds, true)}
          >
            删除所选{deleteIds.length ? `（${deleteIds.length}）` : ''}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || resetIds.length === 0}
            onClick={() => void apply(resetIds, false)}
          >
            重置所选{resetIds.length ? `（${resetIds.length}）` : ''}
          </Button>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      <ul className="mt-2 space-y-1.5">
        {rows.map((row) => {
          const isActive = row.in_pool
          return (
            <li
              key={row.palace_id}
              className={cn(
                'flex items-center justify-between gap-3 text-xs',
                !isActive && 'text-muted-foreground',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                {onSetSkipped ? (
                  <input
                    type="checkbox"
                    className="size-3.5 shrink-0 accent-primary"
                    aria-label={`选择 ${row.title}`}
                    checked={selected.has(row.palace_id)}
                    disabled={busy}
                    onChange={() => toggle(row.palace_id)}
                  />
                ) : null}
                <span className="min-w-0 truncate" title={row.title}>{row.title}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                {isActive
                  ? <>
                      {row.question_count} 题
                      {row.subjective > 0 && row.objective > 0
                        ? `（客观 ${row.objective} · 主观 ${row.subjective}）`
                        : ''}
                    </>
                  : <>
                      {overlayScopeReasonLabel(row.reason)}
                      {row.question_count > 0 ? ` · 有 ${row.question_count} 题` : ''}
                    </>}
              </span>
            </li>
          )
        })}
      </ul>
      {blocked.some((row) => row.reason === 'palace_removed') ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          标为「已移除队列」的宫殿，是它的卡片都从本轮队列移除了，所以它的题也一起移出；
          本轮重新安排它，题就会回来，已答记录也还在。
        </p>
      ) : null}
      {blocked.some((row) => row.reason === 'palace_skipped') ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          标为「已从做题删除」的宫殿，只是不再出它的题；复习安排和评分都不受影响，选中后可以重置回来。
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
