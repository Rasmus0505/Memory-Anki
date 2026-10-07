import { useCallback, useEffect, useRef, useState } from 'react'
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
  ratingDestinationLabel,
  ratingEffectLabel,
} from '@/modules/practice/ui/freestyle/model/ratingEffectLabels'
import { isFreestyleShortcutBlocked } from '@/modules/practice/ui/freestyle/model/freestyleKeyboard'
import {
  getFreestyleRatingShortcut,
  isFreestyleRemoveFromQueueShortcut,
} from '@/modules/practice/ui/freestyle/model/freestyleRatingShortcut'
import { cn } from '@/shared/lib/utils'
import { FreestyleComboChip } from './LazyFreestyleMotion'

export type FreestyleRatingTone = 'again' | 'hard' | 'good' | 'easy'

export const FREESTYLE_RATINGS: Array<{
  value: UnitRating
  label: string
  tone: FreestyleRatingTone
}> = [
  { value: 1, label: '忘记', tone: 'again' },
  { value: 2, label: '困难', tone: 'hard' },
  { value: 3, label: '记得', tone: 'good' },
  { value: 4, label: '轻松', tone: 'easy' },
]

export function FreestyleRatingBar({
  ratingEffects,
  selectedRating,
  recordedRating = null,
  retryAfterCards,
  busy,
  pendingRating = null,
  locked,
  reviewReady,
  hasEncounter,
  actionError,
  blockedHint,
  disabledReason = null,
  shortcutsActive,
  ratingScope = 'unit',
  palaceDueCount = 1,
  hintMode = false,
  onRatingScopeChange,
  onRate,
  onRemoveFromQueue,
  onDismissError,
}: {
  ratingEffects: UnitRatingEffectDto[]
  selectedRating: UnitRating | null
  /** This-round last rating while the amend glance is still empty. */
  recordedRating?: UnitRating | null
  retryAfterCards: number
  busy: boolean
  /** The rating being submitted right now — shown as selected before the server answers. */
  pendingRating?: UnitRating | null
  locked: boolean
  reviewReady: boolean
  hasEncounter: boolean
  actionError: string | null
  /** Why every rating button is unavailable. Without it a disabled bar is silent. */
  disabledReason?: string | null
  /** Why 「下一组」 is unavailable — inline so touch users see it without a toast. */
  blockedHint?: string | null
  /** Only the card under the viewport owns the 1-4 shortcuts. */
  shortcutsActive: boolean
  ratingScope?: FreestyleRatingScope
  palaceDueCount?: number
  /** Yellow hint card: buttons only advance, so never show schedule copy. */
  hintMode?: boolean
  onRatingScopeChange?: (scope: FreestyleRatingScope) => void
  onRate: (rating: UnitRating) => void
  /**
   * Drop this card from the current round only. First press arms it; the second
   * press calls this. No schedule write.
   */
  onRemoveFromQueue?: () => void
  onDismissError?: () => void
}) {
  // Confirmed fill only. In-flight uses 正在记录 so a failed POST cannot look like
  // a kept score, and a late response cannot light the wrong button.
  const [removeArmed, setRemoveArmed] = useState(false)
  const removeArmedRef = useRef(false)
  const disarmRemove = useCallback(() => {
    removeArmedRef.current = false
    setRemoveArmed(false)
  }, [])
  const requestRemove = useCallback(() => {
    if (!onRemoveFromQueue || busy) return
    if (!removeArmedRef.current) {
      removeArmedRef.current = true
      setRemoveArmed(true)
      return
    }
    disarmRemove()
    onRemoveFromQueue()
  }, [busy, disarmRemove, onRemoveFromQueue])
  const shownRating = removeArmed ? null : (selectedRating ?? recordedRating)
  const showingRecorded = !removeArmed && pendingRating == null && selectedRating == null && recordedRating != null
  const selectedEffect = ratingEffects.find(
    (effect) => effect.rating === (pendingRating ?? shownRating),
  )
  const palaceMode = ratingScope === 'palace'

  // Adjust-state-during-render: a new pick (not a restored one on mount) floats a destination tag.
  const activeRating = pendingRating ?? selectedRating
  const [prevActiveRating, setPrevActiveRating] = useState(activeRating)
  const [flyTag, setFlyTag] = useState<{ rating: UnitRating; text: string; seq: number } | null>(null)
  if (prevActiveRating !== activeRating) {
    setPrevActiveRating(activeRating)
    const effect = activeRating != null && !hintMode
      ? ratingEffects.find((value) => value.rating === activeRating)
      : undefined
    if (effect && activeRating != null) {
      setFlyTag((current) => ({
        rating: activeRating,
        text: ratingDestinationLabel(effect, retryAfterCards),
        seq: (current?.seq ?? 0) + 1,
      }))
    }
  }

  useEffect(() => {
    if (pendingRating != null) disarmRemove()
  }, [disarmRemove, pendingRating])

  useEffect(() => {
    if (!shortcutsActive || busy) return
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || isFreestyleShortcutBlocked(event.target)) return
      if (onRemoveFromQueue && isFreestyleRemoveFromQueueShortcut(event.key)) {
        event.preventDefault()
        requestRemove()
        return
      }
      if (locked) return
      const rating = getFreestyleRatingShortcut(event.key)
      if (rating == null) return
      event.preventDefault()
      disarmRemove()
      onRate(rating)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [busy, disarmRemove, locked, onRate, onRemoveFromQueue, requestRemove, shortcutsActive])

  return (
    <footer
      data-testid="freestyle-rating-bar"
      className={cn(
        // Phone: float over map bottom so the map keeps full height.
        // Desktop: still overlay but roomier hit targets.
        'pointer-events-none absolute inset-x-0 bottom-0 z-10 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] sm:p-2.5 sm:pb-2.5',
      )}
    >
      <div className="freestyle-rating-dock pointer-events-auto relative rounded-[1.35rem] border border-stage-line-strong p-1.5 sm:rounded-[1.4rem] sm:p-2">
        <FreestyleComboChip />
        {actionError ? (
          <div
            className="mb-1.5 whitespace-pre-wrap rounded-lg border border-rate-again/30 bg-rate-again/12 px-2.5 py-1.5 text-[11px] text-stage-ink"
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
        {removeArmed ? (
          <div
            data-testid="freestyle-rating-effect-line"
            className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-stage-line px-2.5 py-1 text-[11px] font-medium text-stage-ink sm:text-xs"
          >
            <span className="min-w-0 truncate">再点确认移除 · 本轮不再安排</span>
          </div>
        ) : selectedEffect ? (
          <div
            data-testid="freestyle-rating-effect-line"
            className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-stage-line px-2.5 py-1 text-[11px] font-medium text-stage-ink sm:text-xs"
          >
            {pendingRating != null ? (
              <LoaderCircle className="size-3 shrink-0 animate-spin text-stage-glow" aria-hidden />
            ) : null}
            <span className="min-w-0 truncate">
              {pendingRating != null
                ? `正在记录${selectedEffect.label}`
                : palaceMode
                  ? palaceRatingEffectLine(selectedEffect.label, palaceDueCount)
                  : `已选${selectedEffect.label} · ${ratingEffectLabel(selectedEffect, retryAfterCards)}`}
            </span>
            {locked && pendingRating == null ? (
              <span className="shrink-0 text-stage-faint">已锁定</span>
            ) : showingRecorded ? (
              <span className="shrink-0 text-stage-faint">上次评分</span>
            ) : pendingRating == null && shownRating != null ? (
              <span className="shrink-0 text-stage-faint">再点取消</span>
            ) : null}
          </div>
        ) : null}
        {blockedHint ? (
          <div
            data-testid="freestyle-sequential-hint"
            /* The gate explanation is two clauses ("还有 N 个单元未评分" + what 忘记/困难 do);
               truncating it at phone width cut the half that says why. */
            className="mb-1.5 line-clamp-2 rounded-lg border border-rate-hard/30 bg-rate-hard/10 px-2.5 py-1 text-[11px] leading-snug text-stage-ink"
          >
            {blockedHint}
          </div>
        ) : null}
        {disabledReason && !blockedHint ? (
          <div
            data-testid="freestyle-rating-disabled-reason"
            /* A disabled button cannot be tapped, so it can never explain itself.
               State the reason above the bar instead of dimming in silence. */
            className="mb-1.5 line-clamp-2 rounded-lg border border-stage-line-strong bg-stage-line px-2.5 py-1 text-[11px] leading-snug text-stage-muted"
          >
            {disabledReason}
          </div>
        ) : null}
        {onRatingScopeChange ? (
          <div
            data-testid="freestyle-rating-scope"
            className="mb-1.5 grid grid-cols-2 gap-1 rounded-xl bg-stage-line p-0.5"
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
                      ? 'bg-stage-raised text-stage-glow shadow-sm'
                      : 'text-stage-muted hover:bg-stage-line hover:text-stage-ink',
                  )}
                  onClick={() => onRatingScopeChange(item.value)}
                >
                  {item.label}
                </button>
              )
            })}
          </div>
        ) : null}
        <div className={cn('grid gap-1 sm:gap-1.5', onRemoveFromQueue ? 'grid-cols-5' : 'grid-cols-4')}>
          {onRemoveFromQueue ? (
            <button
              data-testid="freestyle-rating-button-remove"
              type="button"
              disabled={busy}
              aria-pressed={removeArmed}
              aria-label={
                removeArmed
                  ? '移除本队列：本轮不再安排复习，不改复习进度。再点确认移除'
                  : '移除本队列：本轮不再安排复习，不改复习进度'
              }
              title={removeArmed ? '再点确认，本轮不再安排，不改复习进度' : '本轮不再安排这张卡，不改复习进度'}
              data-tone="neutral"
              data-selected={removeArmed ? 'true' : undefined}
              className={cn(
                'freestyle-rate-button relative flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl border px-0.5 py-1.5 text-center disabled:pointer-events-none disabled:opacity-55 sm:min-h-12 sm:rounded-2xl sm:px-1',
                removeArmed && 'disabled:opacity-100',
              )}
              onClick={requestRemove}
            >
              <span className="max-w-full text-[10px] font-semibold leading-tight sm:text-xs">移除本队列</span>
              <span className="max-w-full truncate text-[10px] font-normal leading-none opacity-75 sm:text-[11px]">
                {removeArmed ? '再点确认' : '本轮结束'}
              </span>
            </button>
          ) : null}
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
              : hintMode
                ? '继续'
                : reviewReady
                  ? '计划不可用'
                  : '加载中'
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
                disabled={busy || locked || !hasEncounter}
                aria-pressed={selected}
                aria-busy={pending || undefined}
                data-pending={pending ? 'true' : undefined}
                aria-label={
                  selected && !locked && !showingRecorded
                    ? `${item.label}：${hint}。再点取消评分`
                    : selected && showingRecorded
                      ? `${item.label}：${hint}。上次评分`
                      : `${item.label}：${hint}`
                }
                title={actionError || hint}
                data-tone={item.tone}
                data-key={item.value}
                data-selected={selected ? 'true' : undefined}
                className={cn(
                  'freestyle-rate-button relative flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-1.5 text-center disabled:pointer-events-none sm:min-h-12 sm:rounded-2xl sm:px-2',
                  // Keep the chosen button legible: the shared 55% dim made the
                  // learner's own selection the faintest thing on the bar.
                  selected ? 'disabled:opacity-100' : 'disabled:opacity-55',
                )}
                onClick={() => {
                  disarmRemove()
                  onRate(item.value)
                }}
              >
                {pending ? (
                  <LoaderCircle
                    data-testid={`freestyle-rating-pending-${item.value}`}
                    className="absolute right-1 top-1 size-3 animate-spin opacity-80"
                    aria-hidden
                  />
                ) : null}
                <span className="freestyle-rate-label inline-flex items-center gap-1 text-xs font-semibold leading-none sm:text-sm">
                  <span className="freestyle-rate-pip" aria-hidden />
                  {item.label}
                </span>
                {/* Touch has no hover: the schedule consequence must be readable pre-tap. */}
                {preview ? (
                  <span className="max-w-full truncate text-[10px] font-normal leading-none opacity-75 sm:text-[11px]">
                    {preview}
                  </span>
                ) : null}
                {flyTag?.rating === item.value ? (
                  <span
                    key={flyTag.seq}
                    className="freestyle-rate-fly"
                    aria-hidden
                    onAnimationEnd={() => setFlyTag(null)}
                  >
                    {flyTag.text}
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
