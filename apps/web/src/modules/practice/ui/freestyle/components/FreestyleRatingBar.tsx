import { useEffect } from 'react'
import { LoaderCircle } from 'lucide-react'
import type {
  FreestyleRatingScope,
  UnitRating,
  UnitRatingEffectDto,
} from '@/modules/practice/public'
import {
  palaceRatingEffectLine,
  palaceRatingPreviewLabel,
} from '@/modules/practice/ui/freestyle/model/freestylePalaceRating'
import {
  compactRatingEffectLabel,
  ratingEffectLabel,
} from '@/modules/practice/ui/freestyle/model/ratingEffectLabels'
import { isFreestyleShortcutBlocked } from '@/modules/practice/ui/freestyle/model/freestyleKeyboard'
import { getFreestyleRatingShortcut } from '@/modules/practice/ui/freestyle/model/freestyleRatingShortcut'
import { cn } from '@/shared/lib/utils'

export const FREESTYLE_RATINGS: Array<{
  value: UnitRating
  label: string
  className: string
  selectedClassName: string
}> = [
  {
    value: 1,
    label: '忘记',
    className: 'border-rose-400/30 bg-rose-400/10 text-rose-100 hover:bg-rose-400/18',
    selectedClassName: 'border-rose-300 bg-rose-400/25 ring-2 ring-rose-300/45',
  },
  {
    value: 2,
    label: '困难',
    className: 'border-amber-300/30 bg-amber-300/10 text-amber-50 hover:bg-amber-300/18',
    selectedClassName: 'border-amber-200 bg-amber-300/25 ring-2 ring-amber-200/45',
  },
  {
    value: 3,
    label: '记得',
    className: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-50 hover:bg-emerald-300/18',
    selectedClassName: 'border-emerald-200 bg-emerald-300/25 ring-2 ring-emerald-200/45',
  },
  {
    value: 4,
    label: '轻松',
    className: 'border-sky-300/30 bg-sky-300/10 text-sky-50 hover:bg-sky-300/18',
    selectedClassName: 'border-sky-200 bg-sky-300/25 ring-2 ring-sky-200/45',
  },
]

export function FreestyleRatingBar({
  ratingEffects,
  selectedRating,
  retryAfterCards,
  busy,
  pendingRating = null,
  locked,
  reviewReady,
  hasEncounter,
  actionError,
  blockedHint,
  shortcutsActive,
  ratingScope = 'unit',
  palaceDueCount = 1,
  onRatingScopeChange,
  onRate,
  onDismissError,
}: {
  ratingEffects: UnitRatingEffectDto[]
  selectedRating: UnitRating | null
  retryAfterCards: number
  busy: boolean
  /** The rating being submitted right now — shown as selected before the server answers. */
  pendingRating?: UnitRating | null
  locked: boolean
  reviewReady: boolean
  hasEncounter: boolean
  actionError: string | null
  /** Why 「下一组」 is unavailable — inline so touch users see it without a toast. */
  blockedHint?: string | null
  /** Only the card under the viewport owns the 1-4 shortcuts. */
  shortcutsActive: boolean
  ratingScope?: FreestyleRatingScope
  palaceDueCount?: number
  onRatingScopeChange?: (scope: FreestyleRatingScope) => void
  onRate: (rating: UnitRating) => void
  onDismissError?: () => void
}) {
  // Optimistic: the tapped button reads as chosen while the POST is in flight, so a
  // slow network no longer looks like a dropped tap.
  const shownRating = pendingRating ?? selectedRating
  const selectedEffect = ratingEffects.find((effect) => effect.rating === shownRating)
  const palaceMode = ratingScope === 'palace'

  useEffect(() => {
    if (!shortcutsActive || locked || busy) return
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || isFreestyleShortcutBlocked(event.target)) return
      const rating = getFreestyleRatingShortcut(event.key)
      if (rating == null || rating === selectedRating) return
      event.preventDefault()
      onRate(rating)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [busy, locked, onRate, selectedRating, shortcutsActive])

  return (
    <footer
      data-testid="freestyle-rating-bar"
      className={cn(
        // Phone: float over map bottom so the map keeps full height.
        // Desktop: still overlay but roomier hit targets.
        'pointer-events-none absolute inset-x-0 bottom-0 z-10 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] sm:p-2.5 sm:pb-2.5',
      )}
    >
      <div className="pointer-events-auto rounded-[1.2rem] border border-white/12 bg-zinc-950/88 p-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.42)] backdrop-blur-md sm:rounded-2xl sm:p-2">
        {actionError ? (
          <div
            className="mb-1.5 whitespace-pre-wrap rounded-lg border border-rose-300/25 bg-rose-400/10 px-2.5 py-1.5 text-[11px] text-rose-100"
            role="alert"
          >
            <div>{actionError}</div>
            <div className="mt-1 flex gap-3">
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => void navigator.clipboard?.writeText(actionError)}
              >
                复制诊断
              </button>
              {onDismissError ? (
                <button type="button" className="underline underline-offset-2" onClick={onDismissError}>
                  收起
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {selectedEffect ? (
          <div
            data-testid="freestyle-rating-effect-line"
            className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-zinc-100 sm:text-xs"
          >
            {pendingRating != null ? (
              <LoaderCircle className="size-3 shrink-0 animate-spin text-zinc-300" aria-hidden />
            ) : null}
            <span className="min-w-0 truncate">
              {pendingRating != null
                ? `正在记录${selectedEffect.label}`
                : palaceMode
                  ? palaceRatingEffectLine(selectedEffect.label, palaceDueCount)
                  : `已选${selectedEffect.label} · ${ratingEffectLabel(selectedEffect, retryAfterCards)}`}
            </span>
            {locked && pendingRating == null ? (
              <span className="shrink-0 text-zinc-500">已锁定</span>
            ) : null}
          </div>
        ) : null}
        {blockedHint ? (
          <div
            data-testid="freestyle-sequential-hint"
            /* The gate explanation is two clauses ("还有 N 个单元未评分" + what 忘记/困难 do);
               truncating it at phone width cut the half that says why. */
            className="mb-1.5 line-clamp-2 rounded-lg border border-amber-300/25 bg-amber-300/8 px-2.5 py-1 text-[11px] leading-snug text-amber-100"
          >
            {blockedHint}
          </div>
        ) : null}
        {onRatingScopeChange ? (
          <div
            data-testid="freestyle-rating-scope"
            className="mb-1.5 grid grid-cols-2 gap-1 rounded-xl bg-white/[0.06] p-0.5"
            role="tablist"
            aria-label="评分范围"
          >
            {([
              { value: 'unit' as const, label: '小节' },
              { value: 'palace' as const, label: `宫殿 · 今日 ${Math.max(1, palaceDueCount)}` },
            ]).map((item) => {
              const selected = ratingScope === item.value
              return (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  data-testid={`freestyle-rating-scope-${item.value}`}
                  disabled={busy}
                  className={cn(
                    'rounded-[0.7rem] px-2 py-1 text-[11px] font-semibold transition-colors sm:text-xs',
                    selected
                      ? 'bg-white/16 text-zinc-50 shadow-sm'
                      : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200',
                  )}
                  onClick={() => onRatingScopeChange(item.value)}
                >
                  {item.label}
                </button>
              )
            })}
          </div>
        ) : null}
        <div className="grid grid-cols-4 gap-1 sm:gap-1.5">
          {FREESTYLE_RATINGS.map((item) => {
            const effect = ratingEffects.find((value) => value.rating === item.value)
            const palaceKind = effect
              ? effect.passed
                ? palaceDueCount <= 1 && effect.schedule_changed === false
                  ? 'locked'
                  : 'pass'
                : 'fail'
              : null
            const hint = effect
              ? palaceMode && palaceKind
                ? palaceRatingEffectLine(effect.label, palaceDueCount)
                : ratingEffectLabel(effect, retryAfterCards)
              : reviewReady ? '计划不可用' : '加载中'
            const preview = effect
              ? palaceMode && palaceKind
                ? palaceRatingPreviewLabel(palaceDueCount, palaceKind)
                : compactRatingEffectLabel(effect, retryAfterCards)
              : null
            const selected = shownRating === item.value
            const pending = pendingRating === item.value
            return (
              <button
                data-testid={`freestyle-rating-button-${item.value}`}
                key={item.value}
                type="button"
                disabled={busy || locked || selected || !hasEncounter}
                aria-pressed={selected}
                aria-busy={pending || undefined}
                data-pending={pending ? 'true' : undefined}
                aria-label={`${item.label}：${hint}`}
                title={actionError || hint}
                className={cn(
                  // transition-[colors,transform] + scale-95: the old transition-colors
                  // never animated the active scale, so a tap had no felt response.
                  'relative flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-1.5 text-center transition-[color,background-color,border-color,transform,box-shadow] duration-150 active:scale-95 disabled:pointer-events-none sm:min-h-12 sm:rounded-2xl sm:px-2',
                  item.className,
                  selected && item.selectedClassName,
                  // Keep the chosen button legible: the shared 55% dim made the
                  // learner's own selection the faintest thing on the bar.
                  selected ? 'disabled:opacity-100' : 'disabled:opacity-55',
                )}
                onClick={() => onRate(item.value)}
              >
                {pending ? (
                  <LoaderCircle
                    data-testid={`freestyle-rating-pending-${item.value}`}
                    className="absolute right-1 top-1 size-3 animate-spin opacity-80"
                    aria-hidden
                  />
                ) : null}
                <span className="text-xs font-semibold leading-none sm:text-sm">{item.label}</span>
                {/* Touch has no hover: the schedule consequence must be readable pre-tap. */}
                {preview ? (
                  <span className="max-w-full truncate text-[10px] font-normal leading-none opacity-75 sm:text-[11px]">
                    {preview}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
    </footer>
  )
}
