import { CheckCircle2, CircleAlert, LoaderCircle, RotateCcw } from 'lucide-react'
import {
  PalaceReviewUnitsPanel,
  type PalaceReviewUnitChangeHighlight,
} from '@/modules/practice/ui/review/components/PalaceReviewUnitsPanel'
import type { QuizRuntimeState } from '@/modules/quiz/public'
import { NodeBoundQuizDialog } from './freestyleBranchCardSupport'

export type FreestyleEditorSaveState = 'idle' | 'saving' | 'saved' | 'error'

export function FreestyleUnitReviewStatusBanner({
  saveState,
  onRetry,
  quietStatus,
}: {
  saveState: FreestyleEditorSaveState
  onRetry: () => void
  quietStatus: string
}) {
  if (saveState === 'saving' || saveState === 'saved' || saveState === 'error') {
    const isSaving = saveState === 'saving'
    const isError = saveState === 'error'
    return (
      <div
        data-testid={
          isSaving
            ? 'freestyle-return-saving'
            : isError
              ? 'freestyle-save-error'
              : 'freestyle-save-saved'
        }
        role={isError ? 'alert' : 'status'}
        className={`fixed inset-x-0 bottom-24 z-40 flex justify-center sm:bottom-6 ${
          isError ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
      >
        <span className="inline-flex items-center gap-1.5 fs-rise rounded-full border border-paper-line bg-paper-card px-3 py-1.5 text-xs font-medium text-paper-ink-soft shadow-lift">
          {isSaving ? (
            <>
              <LoaderCircle className="size-3.5 animate-spin" />
              保存中…
            </>
          ) : isError ? (
            <>
              <CircleAlert className="size-3.5 text-[hsl(8_70%_52%)]" />
              保存失败
              <button
                type="button"
                onClick={onRetry}
                className="ml-1 inline-flex items-center gap-1 ma-pressable rounded-full border border-[hsl(8_70%_52%/0.3)] bg-[hsl(8_80%_96%)] px-2 py-0.5 text-[11px] font-semibold text-[hsl(8_70%_42%)] hover:bg-[hsl(8_80%_92%)]"
              >
                <RotateCcw className="size-3" />
                重试
              </button>
            </>
          ) : (
            <>
              <CheckCircle2 className="size-3.5 text-[hsl(104_46%_38%)]" />
              已保存
            </>
          )}
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
      <span className="max-w-[min(20rem,90%)] truncate rounded-full border border-paper-line bg-paper-card/95 px-3 py-1 text-[11px] font-medium text-paper-ink-soft shadow-soft">
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
  onQuestionDeleted,
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
  onQuestionDeleted?: (questionId: number) => void
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
        onQuestionDeleted={onQuestionDeleted}
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
