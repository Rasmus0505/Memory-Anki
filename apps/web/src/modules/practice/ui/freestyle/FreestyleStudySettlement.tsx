import type { ComponentProps } from 'react'
import { FreestyleRoundSettlement, type FreestyleSettlementMeta } from '@/modules/practice/ui/freestyle/components/FreestyleRoundSettlement'
import { toast } from '@/shared/feedback/toast'

export function FreestyleStudySettlement({
  roundId,
  completion,
  quizPalaceCount,
  onClearQuizProgress,
  onCancelSettlement,
  onAnotherRound,
  onContinueWithDueToday,
  dueTomorrowCount,
  settlementMeta,
}: {
  roundId: string
  completion: ComponentProps<typeof FreestyleRoundSettlement>['completion']
  quizPalaceCount: number
  onClearQuizProgress: ComponentProps<typeof FreestyleRoundSettlement>['onClearQuizProgress']
  onCancelSettlement: () => void
  onAnotherRound: () => void
  onContinueWithDueToday: () => Promise<void>
  dueTomorrowCount: number | null
  settlementMeta: FreestyleSettlementMeta
}) {
  return (
    <div
      role="dialog"
      aria-label="结束本次学习"
      aria-modal="true"
      data-keyboard-shortcuts-suspended="true"
      data-testid="freestyle-study-settlement"
      className="absolute inset-0 z-[70] overflow-y-auto overscroll-contain bg-stage/95 px-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] backdrop-blur-sm"
    >
      <FreestyleRoundSettlement
        key={`${roundId}:study`}
        completion={completion}
        roundKey={`${roundId}:study`}
        quizPalaceCount={quizPalaceCount}
        onClearQuizProgress={onClearQuizProgress}
        onCancelSettlement={onCancelSettlement}
        cancelLabel="返回本轮"
        onAnotherRound={onAnotherRound}
        onAddDueToday={() => { void onContinueWithDueToday().catch((error: unknown) => toast.error(error instanceof Error ? error.message : '更新今天到期内容失败。')) }}
        dueTomorrowCount={dueTomorrowCount}
        {...settlementMeta}
      />
    </div>
  )
}
