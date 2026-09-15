import { LoaderCircle } from 'lucide-react'
import {
  PalaceReviewUnitsPanel,
  type PalaceReviewUnitChangeHighlight,
} from '@/modules/practice/ui/review/components/PalaceReviewUnitsPanel'
import type { QuizRuntimeState } from '@/modules/quiz/public'
import { NodeBoundQuizDialog } from './freestyleBranchCardSupport'

export function FreestyleUnitReviewStatusBanner({
  returnSaveState,
  quietStatus,
}: {
  returnSaveState: string
  quietStatus: string
}) {
  if (returnSaveState === 'saving') {
    return (
      <div
        data-testid="freestyle-return-saving"
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center sm:bottom-6"
      >
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300/80 bg-white/95 px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-lg backdrop-blur-sm dark:border-white/20 dark:bg-zinc-900/92 dark:text-zinc-100">
          <LoaderCircle className="size-3.5 animate-spin" />
          正在保存宫殿…
        </span>
      </div>
    )
  }
  if (!quietStatus) return null
  return (
    <div
      data-testid="freestyle-quiet-status"
      role="status"
      className="pointer-events-none absolute inset-x-0 bottom-20 z-30 flex justify-center sm:bottom-16"
    >
      <span className="max-w-[min(20rem,90%)] truncate rounded-full border border-black/8 bg-white/92 px-3 py-1 text-[11px] font-medium text-zinc-700 shadow-sm backdrop-blur-sm">
        {quietStatus}
      </span>
    </div>
  )
}

export function FreestyleUnitReviewFlipDialogs({
  nodeQuizOpen,
  setNodeQuizOpen,
  palaceId,
  nodeQuizNodeUid,
  nodeQuizQuestionIds,
  nodeQuizInitialIndex,
  questionStates,
  updateQuestionState,
  markQuestionCompleted,
  reviewUnitsPanelOpen,
  setReviewUnitsPanelOpen,
  lastUndoToken,
  recentUnitChanges,
  onUnitsReconciled,
}: {
  nodeQuizOpen: boolean
  setNodeQuizOpen: (open: boolean) => void
  palaceId: number
  nodeQuizNodeUid: string | null
  nodeQuizQuestionIds: number[]
  nodeQuizInitialIndex: number
  questionStates: Record<number, QuizRuntimeState>
  updateQuestionState: (questionId: number, next: QuizRuntimeState) => void
  markQuestionCompleted: (questionId: number) => void
  reviewUnitsPanelOpen: boolean
  setReviewUnitsPanelOpen: (open: boolean) => void
  lastUndoToken: string | null
  recentUnitChanges: PalaceReviewUnitChangeHighlight[]
  onUnitsReconciled?: () => void
}) {
  return (
    <>
      <NodeBoundQuizDialog
        open={nodeQuizOpen}
        onOpenChange={setNodeQuizOpen}
        palaceId={palaceId}
        nodeUid={nodeQuizNodeUid}
        questionIds={nodeQuizQuestionIds}
        initialIndex={nodeQuizInitialIndex}
        initialQuestionStates={questionStates}
        onQuestionStateChange={updateQuestionState}
        onQuestionCompleted={markQuestionCompleted}
      />
      <PalaceReviewUnitsPanel
        open={reviewUnitsPanelOpen}
        palaceId={palaceId}
        onClose={() => setReviewUnitsPanelOpen(false)}
        undoToken={lastUndoToken}
        recentChanges={recentUnitChanges}
        onScheduleChanged={() => onUnitsReconciled?.()}
      />
    </>
  )
}
