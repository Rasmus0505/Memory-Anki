import type { ComponentProps } from 'react'
import { FreestyleRoundSettlement, type FreestyleSettlementMeta } from '@/modules/practice/ui/freestyle/components/FreestyleRoundSettlement'

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
}) {
  return (
    <div className="fs-page relative box-border flex h-full min-h-0 shrink-0 flex-col snap-start snap-always p-0">
      <div
        data-testid="freestyle-round-complete-scroll"
        className="fs-depth min-h-0 flex-1 overflow-y-auto overscroll-contain pt-[calc(env(safe-area-inset-top,0px)+4.75rem)]"
      >
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
      </div>
    </div>
  )
}
