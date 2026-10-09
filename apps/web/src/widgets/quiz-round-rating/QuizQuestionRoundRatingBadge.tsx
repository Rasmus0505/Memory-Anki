import { Gauge } from 'lucide-react'
import { overlayQuestionRatingLabel } from '@/modules/practice/ui/freestyle/model/overlayQuizRange'
import { cn } from '@/shared/lib/utils'

/**
 * This-round rating badge for the question on screen.
 *
 * Shared by both answering windows — the toolbar 做题 overlay and 关联题目 — so
 * 「本轮最低 N」 cannot mean one thing in one window and something else in the
 * other. The *rule* behind the number is owned by the backend
 * (`build_round_question_ratings`); this component only renders it.
 *
 * Shows the weakest score among the question's bound knowledge points, or
 * 「本轮尚未复习」 only when `pending` is true: the progress bar still has that
 * point open, and it has no 1–4 yet. A point the bar already drew as done, or
 * one this round never scheduled, hides the badge. Saying it was not reviewed
 * would contradict the bar.
 *
 * A missing score renders as words, never as `0`: "not reviewed yet" and
 * "reviewed and forgotten" must not look alike.
 */
export function QuizQuestionRoundRatingBadge({
  rating,
  pending = false,
  palaceId,
  onOpenSource,
}: {
  rating: number | null
  /** True only when this question's unit is still unfinished on the bar. */
  pending?: boolean
  palaceId: number | null
  onOpenSource?: () => void
}) {
  const scored = rating === 1 || rating === 2 || rating === 3 || rating === 4
  if (!scored && !pending) return null
  const label = scored ? overlayQuestionRatingLabel(rating) : '本轮尚未复习'
  const tone =
    rating == null
      ? 'border-border/60 bg-muted/40 text-muted-foreground'
      : rating <= 2
        ? 'border-rate-again/40 bg-rate-again/10 text-rate-again'
        : 'border-rate-good/40 bg-rate-good/10 text-rate-good'
  const content = (
    <>
      <Gauge className="size-3" aria-hidden="true" />
      {label}
    </>
  )
  const className = cn(
    'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]',
    tone,
  )
  // No palace to point at means no jump target; keep it a plain label rather
  // than a disabled-looking button.
  if (!onOpenSource || palaceId == null) {
    return (
      <span data-testid="overlay-question-rating" className={className}>
        {content}
      </span>
    )
  }
  return (
    <button
      type="button"
      data-testid="overlay-question-rating"
      className={cn(className, 'ma-pressable hover:bg-muted/70')}
      aria-label={`${label}，点击查看这个知识点`}
      title="查看这个知识点的原文"
      onClick={onOpenSource}
    >
      {content}
    </button>
  )
}
