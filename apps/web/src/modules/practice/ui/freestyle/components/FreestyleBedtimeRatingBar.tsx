import { LoaderCircle, Moon } from 'lucide-react'
import type { UnitRating } from '@/modules/practice/public'
import { cn } from '@/shared/lib/utils'
import { FREESTYLE_RATINGS } from './FreestyleRatingBar'

/**
 * 睡前复习的评分条.
 *
 * The unit was already rated today, so this grade is a self-check: the server
 * records it on the round plan only. The bar says that out loud ("不改动复习
 * 安排") instead of showing a next-review date it will not honour.
 */
export function FreestyleBedtimeRatingBar({
  selectedRating,
  busy = false,
  error = null,
  palacePass = false,
  onRate,
  onDismissError,
}: {
  selectedRating: UnitRating | null
  busy?: boolean
  error?: string | null
  /** Whole-palace pass: one grade for the palace, not for a permanent-mark slice. */
  palacePass?: boolean
  onRate: (rating: UnitRating) => void
  onDismissError?: () => void
}) {
  return (
    <footer
      data-testid="freestyle-bedtime-rating-bar"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] sm:p-2.5 sm:pb-2.5"
    >
      <div className="freestyle-rating-dock pointer-events-auto relative rounded-[1.35rem] border border-stage-line-strong p-1.5 sm:rounded-[1.4rem] sm:p-2">
        <div
          data-testid="freestyle-bedtime-note"
          className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-stage-line px-2.5 py-1 text-[11px] font-medium text-stage-ink sm:text-xs"
        >
          <Moon className="size-3 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            睡前复习{palacePass ? ' · 整座宫殿' : ''} · 这次评分只记录，不改动复习安排
          </span>
          {busy ? <LoaderCircle className="size-3 shrink-0 animate-spin" aria-hidden /> : null}
        </div>
        {error ? (
          <div
            className="mb-1.5 flex items-center gap-2 rounded-lg border border-rate-again/30 bg-rate-again/12 px-2.5 py-1.5 text-[11px] text-stage-ink"
            role="alert"
          >
            <span className="min-w-0 flex-1">{error}</span>
            {onDismissError ? (
              <button type="button" className="shrink-0 underline underline-offset-2" onClick={onDismissError}>
                收起
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-1 max-sm:grid-cols-4 sm:grid-cols-4 sm:gap-1.5">
          {FREESTYLE_RATINGS.map((item) => {
            const selected = selectedRating === item.value
            return (
              <button
                key={item.value}
                type="button"
                data-testid={`freestyle-bedtime-rating-button-${item.value}`}
                disabled={busy}
                aria-pressed={selected}
                aria-label={`${item.label}：记下这次睡前复习`}
                title="只记录本次，不改动复习安排"
                data-tone={item.tone}
                data-selected={selected ? 'true' : undefined}
                className={cn(
                  'freestyle-rate-button relative flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-1.5 text-center disabled:pointer-events-none sm:min-h-12 sm:rounded-2xl sm:px-2',
                  selected ? 'disabled:opacity-100' : 'disabled:opacity-55',
                )}
                onClick={() => onRate(item.value)}
              >
                <span className="freestyle-rate-label inline-flex items-center gap-1 text-xs font-semibold leading-none sm:text-sm">
                  <span className="freestyle-rate-pip" aria-hidden />
                  {item.label}
                </span>
                <span className="max-w-full truncate text-[10px] font-normal leading-none opacity-75 sm:text-[11px]">
                  {selected ? '已记下' : '记下'}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </footer>
  )
}
