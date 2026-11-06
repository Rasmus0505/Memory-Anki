import type { ComponentProps } from 'react'
import { FreestyleRoundSettlement, type FreestyleSettlementMeta } from '@/modules/practice/ui/freestyle/components/FreestyleRoundSettlement'
import { FreestyleRoundWaiting } from '@/modules/practice/ui/freestyle/components/FreestyleRoundWaiting'

export function FreestyleClosingSlot({
  roundId,
  completion,
  quizPalaceCount,
  onClearQuizProgress,
  onSettle,
  onCancelSettlement,
  canCancelSettlement = true,
  dueTomorrowCount,
  settlementMeta,
  pendingReviewCount = 0,
  nextReviewAt = null,
}: {
  roundId: string
  completion: ComponentProps<typeof FreestyleRoundSettlement>['completion']
  quizPalaceCount: number
  onClearQuizProgress: ComponentProps<typeof FreestyleRoundSettlement>['onClearQuizProgress']
  onSettle: () => void
  onCancelSettlement: () => void
  /** False once the rated units are settled out of the feed — nowhere to return. */
  canCancelSettlement?: boolean
  dueTomorrowCount: number | null
  settlementMeta: FreestyleSettlementMeta
  /**
   * Same-day 重练 the server still owes today. While any exist this page is a
   * waiting page, never a completion: the round is not over until they are
   * served or the learner explicitly ends the day.
   */
  pendingReviewCount?: number
  nextReviewAt?: string | null
}) {
  return (
    <div className="fs-page relative box-border flex h-full min-h-0 shrink-0 flex-col snap-start snap-always p-0">
      <div
        data-testid="freestyle-round-complete-scroll"
        className="fs-depth min-h-0 flex-1 overflow-y-auto overscroll-contain pt-[calc(env(safe-area-inset-top,0px)+4.75rem)]"
      >
        {pendingReviewCount > 0 ? (
          <FreestyleRoundWaiting
            count={pendingReviewCount}
            readyAt={nextReviewAt}
            ratedCount={completion.ratedCount}
            onBack={onCancelSettlement}
            onStop={onSettle}
          />
        ) : (
          <FreestyleRoundSettlement
            completion={completion}
            roundKey={roundId}
            quizPalaceCount={quizPalaceCount}
            onClearQuizProgress={onClearQuizProgress}
            onSettle={onSettle}
            onCancelSettlement={onCancelSettlement}
            showCancel={canCancelSettlement}
            dueTomorrowCount={dueTomorrowCount}
            {...settlementMeta}
          />
        )}
      </div>
    </div>
  )
}
