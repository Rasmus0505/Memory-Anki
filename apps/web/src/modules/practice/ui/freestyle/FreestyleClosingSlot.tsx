import type { ComponentProps } from 'react'
import { FreestyleRoundSettlement, type FreestyleSettlementMeta } from '@/modules/practice/ui/freestyle/components/FreestyleRoundSettlement'
import { toast } from '@/shared/feedback/toast'

export function FreestyleClosingSlot({
  roundId,
  completion,
  quizPalaceCount,
  onClearQuizProgress,
  onAnotherRound,
  onCancelSettlement,
  onFinishStudy,
  onContinueWithDueToday,
  dueTomorrowCount,
  settlementMeta,
}: {
  roundId: string
  completion: ComponentProps<typeof FreestyleRoundSettlement>['completion']
  quizPalaceCount: number
  onClearQuizProgress: ComponentProps<typeof FreestyleRoundSettlement>['onClearQuizProgress']
  onAnotherRound: () => void
  onCancelSettlement: () => void
  onFinishStudy: () => void
  onContinueWithDueToday: () => Promise<void>
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
          onAnotherRound={onAnotherRound}
          onCancelSettlement={onCancelSettlement}
          onFinishStudy={onFinishStudy}
          onAddDueToday={() => { void onContinueWithDueToday().catch((error: unknown) => toast.error(error instanceof Error ? error.message : '更新今天到期内容失败。')) }}
          dueTomorrowCount={dueTomorrowCount}
          {...settlementMeta}
        />
      </div>
    </div>
  )
}
