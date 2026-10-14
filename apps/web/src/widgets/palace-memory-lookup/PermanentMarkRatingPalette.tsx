import { cn } from '@/shared/lib/utils'
import {
  RATING_WORDS,
  type PermanentMarkRatingRow,
} from '@/widgets/palace-memory-lookup/model/memoryLookupRatingView'

const RATINGS = [1, 2, 3, 4] as const

/** Same colour semantics as the 随心 rating bar: 忘记 red, 困难 amber, 记得 green, 轻松 cyan. */
const RATING_TONE: Record<number, string> = {
  1: 'border-rate-again/60 text-rate-again hover:bg-rate-again/10',
  2: 'border-rate-hard/60 text-rate-hard hover:bg-rate-hard/10',
  3: 'border-rate-good/60 text-rate-good hover:bg-rate-good/10',
  4: 'border-rate-easy/60 text-rate-easy hover:bg-rate-easy/10',
}
const RATING_TONE_ACTIVE: Record<number, string> = {
  1: 'bg-rate-again text-white border-rate-again',
  2: 'bg-rate-hard text-white border-rate-hard',
  3: 'bg-rate-good text-white border-rate-good',
  4: 'bg-rate-easy text-white border-rate-easy',
}

/**
 * Rating palette for the mind-map node the learner clicked. One click sets the
 * rating; the current one is filled and disabled. Shows how many descendant marks
 * the change will also reach, so the cascade is never silent.
 */
export function PermanentMarkRatingPalette({
  row,
  cascadeCount,
  busy,
  error,
  onChangeRating,
}: {
  /** The selected permanent-mark node, or null when nothing is selected. */
  row: PermanentMarkRatingRow | null
  /** Descendant marks (rated) that a change to `row` also sets. */
  cascadeCount: number
  busy: boolean
  error: string
  onChangeRating: (rating: number) => void
}) {
  if (!row) {
    return <p className="text-xs text-muted-foreground">点击导图上的永久标记节点，即可改它的评分。</p>
  }
  const rateable = row.unitId != null && row.rating != null
  return (
    <div data-testid="permanent-mark-rating-palette" className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium">{row.text}</span>
        {rateable ? (
          <div role="group" aria-label={`改评分：${row.text}`} className="flex gap-1.5">
            {RATINGS.map((value) => {
              const active = value === row.rating
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  disabled={busy || active}
                  onClick={() => onChangeRating(value)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-default',
                    active ? RATING_TONE_ACTIVE[value] : RATING_TONE[value],
                  )}
                >
                  {RATING_WORDS[value]}
                </button>
              )
            })}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">未评分</span>
        )}
      </div>
      {rateable && cascadeCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          改这一项会同时改下面 {cascadeCount} 个永久标记节点。
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
