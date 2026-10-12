import type { ComponentProps } from 'react'
import type { useImmersiveQueue } from '@/modules/practice/ui/freestyle/hooks/useImmersiveQueue'
import { FreestyleHistoryDialog } from '@/modules/practice/ui/freestyle/components/FreestyleHistoryDialog'
import { FreestyleRoundConfigDialog } from '@/modules/practice/ui/freestyle/components/FreestyleRoundConfigDialog'
import { FreestyleScopeQuizDialog } from '@/modules/practice/ui/freestyle/components/FreestyleDialogsHost'
import { FreestyleRoundSheet } from '@/modules/practice/ui/freestyle/components/FreestyleRoundSheet'
import { overlayRoundReviewPalaceIds } from '@/modules/practice/ui/freestyle/model/overlayQuizRange'
import { readFreestyleFeedConfig } from '@/modules/practice/public'
import type { FreestyleWorkspaceId, PalaceReviewWorkspaceId } from '@/modules/practice/public'

type SheetProps = ComponentProps<typeof FreestyleRoundSheet>
type ConfigProps = ComponentProps<typeof FreestyleRoundConfigDialog>
type ScopeQuizProps = ComponentProps<typeof FreestyleScopeQuizDialog>
type HistoryProps = ComponentProps<typeof FreestyleHistoryDialog>
type ImmersiveQueue = ReturnType<typeof useImmersiveQueue>

export function FreestylePageDialogs({
  planOpen,
  onPlanOpenChange,
  cards,
  currentIndex,
  queueState,
  roundPlan,
  loading,
  onJumpPlanCard,
  onExcludePlanCards,
  onRestorePlanCards,
  onCompressCompleted,
  onReorderPlan,
  onRateCard,
  onRemoveCard,
  onOpenConfigFromPlan,
  configOpen,
  onConfigOpenChange,
  config,
  configIntent,
  onSaveConfig,
  reviewPalaceId,
  scopeQuizOpen,
  onScopeQuizOpenChange,
  planVersion,
  slot,
  onSetConfigAndPersist,
  onRoundSync,
  historyOpen,
  onHistoryOpenChange,
  currentCard,
}: {
  planOpen: boolean
  onPlanOpenChange: SheetProps['onOpenChange']
  cards: SheetProps['cards']
  currentIndex: number
  queueState: SheetProps['queueState']
  roundPlan: SheetProps['roundPlan']
  loading: boolean
  onJumpPlanCard: SheetProps['onJump']
  onExcludePlanCards: SheetProps['onExclude']
  onRestorePlanCards: SheetProps['onRestore']
  onCompressCompleted: SheetProps['onCompressCompleted']
  onReorderPlan: SheetProps['onReorder']
  onRateCard: SheetProps['onRateCard']
  onRemoveCard: SheetProps['onRemoveCard']
  onOpenConfigFromPlan: SheetProps['onOpenConfig']
  configOpen: boolean
  onConfigOpenChange: ConfigProps['onOpenChange']
  config: ConfigProps['config']
  configIntent: ConfigProps['mode']
  onSaveConfig: ConfigProps['onSaveConfig']
  reviewPalaceId: number | null
  scopeQuizOpen: boolean
  onScopeQuizOpenChange: ScopeQuizProps['onOpenChange']
  planVersion: ScopeQuizProps['planVersion']
  slot: FreestyleWorkspaceId | PalaceReviewWorkspaceId
  onSetConfigAndPersist: ImmersiveQueue['setConfigAndPersist']
  onRoundSync: ScopeQuizProps['onRoundSync']
  historyOpen: boolean
  onHistoryOpenChange: HistoryProps['onOpenChange']
  currentCard: HistoryProps['currentCard']
}) {
  return (
    <>
      <FreestyleRoundSheet
        open={planOpen}
        cards={cards}
        currentIndex={currentIndex}
        queueState={queueState}
        roundPlan={roundPlan}
        onOpenChange={onPlanOpenChange}
        onJump={onJumpPlanCard}
        onExclude={onExcludePlanCards}
        onRestore={onRestorePlanCards}
        onCompressCompleted={onCompressCompleted}
        onReorder={onReorderPlan}
        onRateCard={onRateCard}
        onRemoveCard={onRemoveCard}
        onOpenConfig={onOpenConfigFromPlan}
        loading={loading}
      />
      <FreestyleRoundConfigDialog
        open={configOpen}
        config={config}
        mode={configIntent}
        onOpenChange={onConfigOpenChange}
        onSaveConfig={onSaveConfig}
        scopeLocked={reviewPalaceId != null}
      />
      <FreestyleScopeQuizDialog
        open={scopeQuizOpen}
        onOpenChange={onScopeQuizOpenChange}
        roundId={queueState.roundId}
        planVersion={planVersion}
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
