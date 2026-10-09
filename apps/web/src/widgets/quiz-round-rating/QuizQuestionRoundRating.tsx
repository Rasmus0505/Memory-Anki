import { QuizQuestionRoundRatingBadge } from './QuizQuestionRoundRatingBadge'
import { useRoundQuestionRatings } from '@/modules/practice/ui/freestyle/hooks/useRoundQuestionRatings'
import { overlayQuestionRating } from '@/modules/practice/ui/freestyle/model/overlayQuizRange'

/**
 * The this-round rating badge, wired to its data.
 *
 * Both answering windows render this rather than each fetching and deriving a
 * score: the rule ("weakest bound knowledge point, this round") is the backend's
 * (`build_round_question_ratings`), and one container keeps 做题 and 关联题目
 * from drifting apart.
 *
 * `roundId` absent means "not inside a 随心 round" — then nothing renders at all.
 * Outside a round there is no score to show, and claiming 「本轮尚未复习」 about a
 * round that does not exist would be worse than showing nothing.
 */
export function QuizQuestionRoundRating({
  roundId,
  questionId,
  palaceId,
  open = true,
  onOpenSource,
}: {
  roundId: string | null | undefined
  questionId: number | null | undefined
  palaceId: number | null
  /** Skip the fetch while the window is closed. */
  open?: boolean
  onOpenSource?: () => void
}) {
  const badge = useRoundQuestionRatings({
    roundId,
    enabled: open && Boolean(roundId),
  })
  if (!roundId || badge == null) return null
  const rating = overlayQuestionRating(badge.ratings, questionId)
  const pending =
    questionId != null && badge.pendingIds.includes(String(questionId))
  if (rating == null && !pending) return null
  return (
    <QuizQuestionRoundRatingBadge
      rating={rating}
      pending={pending}
      palaceId={palaceId}
      onOpenSource={onOpenSource}
    />
  )
}
