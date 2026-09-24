import type { FreestyleReviewHintCard } from '@/shared/api/contracts'
import { FreestyleRatingBar } from './FreestyleRatingBar'

/**
 * Yellow boundary hint: the queue's single "next card starts formal review"
 * marker. Ratings on this card only advance the feed — no score, encounter,
 * or round-plan write ever happens for it.
 */
export function FreestyleReviewHintCardView({
  card,
  active = false,
  onAdvance,
}: {
  card: FreestyleReviewHintCard
  /** Only the card under the viewport owns the 1-4 shortcuts. */
  active?: boolean
  onAdvance: () => void
}) {
  return (
    <div
      data-testid="freestyle-review-hint-card"
      className="relative flex h-full min-h-0 flex-col items-center justify-center bg-amber-300 px-6 pb-24"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          className="text-3xl font-semibold leading-snug text-zinc-900 sm:text-4xl"
          data-testid="freestyle-review-hint-text"
        >
          {card.text}
        </span>
        <span className="text-sm text-zinc-800/70">路径到此为止，接下来是正式复习单元</span>
      </div>
      <FreestyleRatingBar
        hintMode
        ratingEffects={[]}
        selectedRating={null}
        retryAfterCards={0}
        busy={false}
        locked={false}
        reviewReady
        hasEncounter
        actionError={null}
        shortcutsActive={active}
        onRate={() => onAdvance()}
      />
    </div>
  )
}
