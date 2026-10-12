import { FreestyleRoundCompleteCard } from '@/modules/practice/ui/freestyle/components/FreestyleRoundCompleteCard'
import type { FreestylePartialSettlementSnapshot } from '@/modules/practice/domain/partialSettlement'

export function FreestylePartialSettlement({
  snapshot,
  roundId,
  onExit,
  onConfirmPartial,
}: {
  snapshot: FreestylePartialSettlementSnapshot
  roundId: string
  onExit: () => void
  onConfirmPartial: (snapshot: FreestylePartialSettlementSnapshot) => void
}) {
  return (
    <div
      data-testid="freestyle-partial-settlement"
      data-keyboard-shortcuts-suspended="true"
      className="absolute inset-0 z-[70] flex flex-col bg-stage/95 backdrop-blur-sm"
    >
      <div className="flex shrink-0 items-center justify-end px-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))]">
        <button
          type="button"
          data-testid="freestyle-partial-settlement-exit"
          className="ma-pressable rounded-full border border-stage-line-strong bg-stage-raised/90 px-4 py-2 text-sm font-medium text-stage-ink shadow-lg"
          onClick={onExit}
        >
          退出
        </button>
      </div>
      <div className="mx-auto min-h-0 w-full max-w-2xl flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
        <FreestyleRoundCompleteCard
          variant="partial"
          completion={{
            ratedCount: snapshot.ratedCount,
            passedCount: snapshot.passedCount,
            retriedCount: snapshot.retryCount,
            retryCount: snapshot.retryCount,
            remainingCandidates: 0,
            quizCount: snapshot.quizCount,
            newCount: snapshot.newCount,
            reviewCount: snapshot.reviewCount,
            involvedUnitCount: snapshot.ratedCount,
            totalUnits: snapshot.bySubject.reduce((sum, subject) => sum + subject.totalUnits, 0),
            bySubject: snapshot.bySubject,
          }}
          roundKey={`${roundId}:${snapshot.id}`}
          quizPalaceCount={0}
          onClearQuizProgress={async () => undefined}
          onCancelSettlement={onExit}
          onConfirmPartial={() => onConfirmPartial(snapshot)}
        />
      </div>
    </div>
  )
}
