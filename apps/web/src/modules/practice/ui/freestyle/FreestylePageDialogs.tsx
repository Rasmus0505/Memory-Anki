import type { ComponentProps } from 'react'
import type { useImmersiveQueue } from '@/modules/practice/ui/freestyle/hooks/useImmersiveQueue'
import { FreestyleHistoryDialog } from '@/modules/practice/ui/freestyle/components/FreestyleHistoryDialog'
import { FreestyleRoundConfigDialog } from '@/modules/practice/ui/freestyle/components/FreestyleRoundConfigDialog'
import { FreestyleScopeQuizDialog } from '@/modules/practice/ui/freestyle/components/FreestyleDialogsHost'
import { overlayRoundReviewPalaceIds } from '@/modules/practice/ui/freestyle/model/overlayQuizRange'
import { readFreestyleFeedConfig } from '@/modules/practice/public'
import type { FreestyleWorkspaceId, PalaceReviewWorkspaceId } from '@/modules/practice/public'

type ConfigProps = ComponentProps<typeof FreestyleRoundConfigDialog>
type ScopeQuizProps = ComponentProps<typeof FreestyleScopeQuizDialog>
type HistoryProps = ComponentProps<typeof FreestyleHistoryDialog>
type ImmersiveQueue = ReturnType<typeof useImmersiveQueue>

export function FreestylePageDialogs({
  queueState,
  roundPlan,
  configOpen,
  onConfigOpenChange,
  config,
  configIntent,
  onSaveConfig,
  reviewPalaceId,
  settlementCount,
  onSettleCompleted,
  scopeQuizOpen,
  onScopeQuizOpenChange,
  planVersion,
  wrongUnitIds,
  slot,
  onSetConfigAndPersist,
  onRoundSync,
  historyOpen,
  onHistoryOpenChange,
  currentCard,
}: {
  queueState: Pick<ImmersiveQueue['queueState'], 'roundId'>
  roundPlan: ImmersiveQueue['roundPlan']
  configOpen: boolean
  onConfigOpenChange: ConfigProps['onOpenChange']
  config: ConfigProps['config']
  configIntent: ConfigProps['mode']
  onSaveConfig: ConfigProps['onSaveConfig']
  reviewPalaceId: number | null
  /** Cards already rated and ready to settle out of this round. */
  settlementCount: number
  onSettleCompleted: () => void
  scopeQuizOpen: boolean
  onScopeQuizOpenChange: ScopeQuizProps['onOpenChange']
  planVersion: ScopeQuizProps['planVersion']
  wrongUnitIds: readonly string[]
  slot: FreestyleWorkspaceId | PalaceReviewWorkspaceId
  onSetConfigAndPersist: ImmersiveQueue['setConfigAndPersist']
  onRoundSync: ScopeQuizProps['onRoundSync']
  historyOpen: boolean
  onHistoryOpenChange: HistoryProps['onOpenChange']
  currentCard: HistoryProps['currentCard']
}) {
  return (
    <>
      <FreestyleRoundConfigDialog
        open={configOpen}
        config={config}
        mode={configIntent}
        onOpenChange={onConfigOpenChange}
        onSaveConfig={onSaveConfig}
        scopeLocked={reviewPalaceId != null}
        settlementCount={settlementCount}
        onSettleCompleted={onSettleCompleted}
      />
      <FreestyleScopeQuizDialog
        open={scopeQuizOpen}
        onOpenChange={onScopeQuizOpenChange}
        roundId={queueState.roundId}
        planVersion={planVersion}
        wrongUnitIds={wrongUnitIds}
        storedConfig={readFreestyleFeedConfig(slot)}
        setupDone={Boolean(readFreestyleFeedConfig(slot).overlay_quiz_setup_done)}
        roundReviewPalaceCount={overlayRoundReviewPalaceIds(roundPlan).length}
        onConfirmSetup={({
          quizScope,
          overlayQuestionRange,
          overlayQuestionKinds,
          overlayTypeOrder,
          overlayTypePalaceNesting,
          overlayRatingInherit,
        }) => {
          onSetConfigAndPersist((current) => ({
            ...current,
            overlay_quiz_setup_done: true,
            quiz_scope: quizScope,
            overlay_question_range: overlayQuestionRange,
            overlay_question_kinds: overlayQuestionKinds,
            overlay_type_order: overlayTypeOrder,
            overlay_type_palace_nesting: overlayTypePalaceNesting,
            overlay_rating_inherit: overlayRatingInherit,
            streams: {
              ...current.streams,
              quiz: {
                ...current.streams.quiz,
                quiz_scope: quizScope,
                overlay_question_range: overlayQuestionRange,
              },
            },
          }))
        }}
        onRoundSync={onRoundSync}
      />
      <FreestyleHistoryDialog
        open={historyOpen}
        currentCard={currentCard}
        currentPalaceId={
          currentCard?.type === 'mindmap_branch'
            ? currentCard.palace_id
            : currentCard?.type === 'quiz_question'
              ? currentCard.palace_context?.id ?? null
              : currentCard?.palace_context?.id ?? null
        }
        mode="free"
        onOpenChange={onHistoryOpenChange}
      />
    </>
  )
}
