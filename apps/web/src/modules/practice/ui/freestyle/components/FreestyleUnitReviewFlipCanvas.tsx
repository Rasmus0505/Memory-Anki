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
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300/80 bg-white/95 px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-lg backdrop-blur-sm dark:border-white/20 dark:bg-zinc-900/92 dark:text-zinc-100">
          {isSaving ? (
            <>
              <LoaderCircle className="size-3.5 animate-spin" />
              保存中…
            </>
          ) : isError ? (
            <>
              <CircleAlert className="size-3.5 text-rose-600 dark:text-rose-300" />
              保存失败
              <button
                type="button"
                onClick={onRetry}
                className="ml-1 inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-400/40 dark:bg-rose-950/70 dark:text-rose-200"
              >
                <RotateCcw className="size-3" />
                重试
              </button>
            </>
          ) : (
            <>
              <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-300" />
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
