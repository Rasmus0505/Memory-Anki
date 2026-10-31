import type { ComponentProps, RefObject, UIEventHandler } from 'react'
import type { useImmersiveQueue } from '@/modules/practice/ui/freestyle/hooks/useImmersiveQueue'
import { FreestyleEmptyState, FreestyleFeedErrorState, FreestyleLoadingState } from '@/modules/practice/ui/freestyle/components/FreestyleFeedStates'
import { FreestyleFeedCard } from '@/modules/practice/ui/freestyle/FreestyleFeedCard'
import { FreestyleClosingSlot } from '@/modules/practice/ui/freestyle/FreestyleClosingSlot'
import { FreestyleWaitingState } from '@/modules/practice/ui/freestyle/components/FreestyleWaitingState'
import type { FreestyleSettlementMeta } from '@/modules/practice/ui/freestyle/components/FreestyleRoundSettlement'
import { overlayRoundReviewPalaceIds } from '@/modules/practice/ui/freestyle/model/overlayQuizRange'
import { isOccurrenceScored } from '@/modules/practice/domain/unitProgressState'
import {
  freestyleFeedCardKey,
  isQuizCard,
} from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import type { FreestyleCard } from '@/shared/api/contracts'
import { toast } from '@/shared/feedback/toast'

type Queue = ReturnType<typeof useImmersiveQueue>
type FeedProps = ComponentProps<typeof FreestyleFeedCard>
type ClosingProps = ComponentProps<typeof FreestyleClosingSlot>

export function FreestyleCardArea({
  scrollRef,
  onScroll,
  cards,
  currentIndex,
  visualIndex,
  mounted,
  isActive,
  settlementVisible,
  roundComplete,
  waiting,
  loading,
  error,
  config,
  onRefreshQueue,
  onOpenConfig,
  readOnlyHistoryCardId,
  freestyleFullscreen,
  flipMode,
  mindmapZoom,
  queueState,
  roundPlan,
  planVersion,
  wrongUnitIds,
  answeredQuestionIds,
  questionStates,
  onToggleFullscreen,
  onFlipModeChange,
  onMindmapZoomChange,
  onEnsureEncounter,
  onEncounterChange,
  onStaleDrop,
  onRemoveFromQueue,
  onRemovePermanently,
  onRebuildRound,
  onRevisionAdopted,
  onCardSaveFailed,
  onEditingChange,
  onReconcileUnits,
  onOpenScopeQuiz,
  onBedtimeRate,
  onQuestionStateChange,
  onChoiceResolve,
  onShortAnswerSubmit,
  onQuestionUpdated,
  onAnswerReset,
  onShown,
  getDurationMs,
  onNavigateToIndex,
  roundCompletion,
  dueTomorrowCount,
  settlementMeta,
  onClearQuizProgress,
  onSettle,
  onCancelSettlement,
  canCancelSettlement,
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  onScroll: UIEventHandler<HTMLDivElement>
  cards: FreestyleCard[]
  currentIndex: number
  visualIndex: number
  mounted: ReadonlySet<number>
  isActive: boolean
  settlementVisible: boolean
  roundComplete: boolean
  waiting?: { count: number; next_ready_at: string | null } | null
  loading: boolean
  error: string | null | undefined
  config: Queue['config']
  onRefreshQueue: () => void
  onOpenConfig: () => void
  readOnlyHistoryCardId: string | null
  freestyleFullscreen: boolean
  flipMode: FeedProps['flipMode']
  mindmapZoom: FeedProps['mindmapZoom']
  queueState: Queue['queueState']
  roundPlan: Queue['roundPlan']
  planVersion: Queue['planVersion']
  wrongUnitIds: readonly string[]
  answeredQuestionIds: ReadonlySet<number>
  questionStates: Record<number, FeedProps['questionState']>
  onToggleFullscreen: FeedProps['onToggleFullscreen']
  onFlipModeChange: FeedProps['onFlipModeChange']
  onMindmapZoomChange: FeedProps['onMindmapZoomChange']
  onEnsureEncounter: FeedProps['onEnsureEncounter']
  onEncounterChange: FeedProps['onEncounterChange']
  onStaleDrop: FeedProps['onStaleDrop']
  onRemoveFromQueue: FeedProps['onRemoveFromQueue']
  onRemovePermanently: FeedProps['onRemovePermanently']
  onRebuildRound: FeedProps['onRebuildRound']
  onRevisionAdopted: FeedProps['onRevisionAdopted']
  onCardSaveFailed: (message: string, cardId: string) => void
  onEditingChange: FeedProps['onEditingChange']
  onReconcileUnits: (cardId: string) => void
  onOpenScopeQuiz: FeedProps['onOpenScopeQuiz']
  onBedtimeRate: FeedProps['onBedtimeRate']
  onQuestionStateChange: FeedProps['onQuestionStateChange']
  onChoiceResolve: FeedProps['onChoiceResolve']
  onShortAnswerSubmit: FeedProps['onShortAnswerSubmit']
  onQuestionUpdated?: FeedProps['onQuestionUpdated']
  onAnswerReset?: FeedProps['onAnswerReset']
  onShown?: FeedProps['onShown']
  getDurationMs?: FeedProps['getDurationMs']
  onNavigateToIndex: FeedProps['onNavigateToIndex']
  roundCompletion: ClosingProps['completion']
  dueTomorrowCount: number | null
  settlementMeta: FreestyleSettlementMeta
  onClearQuizProgress: ClosingProps['onClearQuizProgress']
  onSettle: ClosingProps['onSettle']
  onCancelSettlement: () => void
  /** False once a settled round has no card left to return to. */
  canCancelSettlement: boolean
}) {
  const completedIds = queueState.completedIds
  const quizPalaceCount = overlayRoundReviewPalaceIds(roundPlan).length
  return (
    <div
      ref={scrollRef}
      data-page-history-scroll-key="freestyle-immersive"
      // overflow-anchor-none: reordering cards for「下个宫殿」must not let the
      // browser keep the old card glued to the viewport (looks like no jump).
      data-testid="freestyle-feed-scroller"
      className="min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto overflow-x-hidden overscroll-y-none [overflow-anchor:none] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      onScroll={onScroll}
    >
      {cards.length > 0 ? (
        cards.map((card, index) => {
          const planEntry = roundPlan?.cardsById[card.id]
          const rowKey = freestyleFeedCardKey(card)
          if (!mounted.has(index)) {
            return (
              <div
                key={rowKey}
                className="h-full min-h-0 shrink-0 snap-start snap-always"
                aria-hidden
              />
            )
          }
          const encounter = queueState.unitEncountersByCardId[card.id]
          return (
            <FreestyleFeedCard
              key={rowKey}
              card={card}
              index={index}
              currentIndex={currentIndex}
              visualIndex={visualIndex}
              isActive={isActive}
              settlementVisible={settlementVisible}
              readOnlyHistoryCardId={readOnlyHistoryCardId}
              freestyleFullscreen={freestyleFullscreen}
              flipMode={flipMode}
              mindmapZoom={mindmapZoom}
              roundId={queueState.roundId}
              planVersion={planVersion}
              encounter={encounter}
              planEntry={planEntry}
              completed={isOccurrenceScored(card.id, {
                completedIds,
                encounters: queueState.unitEncountersByCardId,
                roundPlan,
              })}
              questionState={isQuizCard(card) ? questionStates[card.question.id] : undefined}
              answeredBefore={isQuizCard(card) && answeredQuestionIds.has(card.question.id)}
              wrongThisRound={card.type === 'mindmap_branch' && !!card.unit_id && wrongUnitIds.includes(card.unit_id)}
              onFlipModeChange={onFlipModeChange}
              onMindmapZoomChange={onMindmapZoomChange}
              onToggleFullscreen={onToggleFullscreen}
              onEnsureEncounter={onEnsureEncounter}
              onEncounterChange={onEncounterChange}
              onStaleDrop={onStaleDrop}
              onRemoveFromQueue={onRemoveFromQueue}
              onRemovePermanently={onRemovePermanently}
              onRebuildRound={onRebuildRound}
              onRevisionAdopted={onRevisionAdopted}
              onSaveFailed={(message) => onCardSaveFailed(message, card.id)}
              onEditingChange={onEditingChange}
              onUnitsReconciled={() => onReconcileUnits(card.id)}
              onOpenScopeQuiz={onOpenScopeQuiz}
              onBedtimeRate={onBedtimeRate}
              onQuestionStateChange={onQuestionStateChange}
              onChoiceResolve={onChoiceResolve}
              onShortAnswerSubmit={onShortAnswerSubmit}
              onQuestionUpdated={onQuestionUpdated}
              onAnswerReset={onAnswerReset}
              onShown={onShown}
              getDurationMs={getDurationMs}
              onNavigateToIndex={onNavigateToIndex}
            />
          )
        })
      ) : loading ? (
        <FreestyleLoadingState />
      ) : error ? (
        <FreestyleFeedErrorState
          feedError={error}
          mode="free"
          config={config}
          onLoadFeed={async () => { onRefreshQueue() }}
          onCopyDiagnostics={async () => {
            await navigator.clipboard.writeText(error)
            toast.success('已复制诊断信息')
          }}
        />
      ) : waiting && waiting.count > 0 ? (
        <FreestyleWaitingState
          count={waiting.count}
          readyAt={waiting.next_ready_at}
          onRefresh={onRefreshQueue}
        />
      ) : roundComplete ? null : (
        <FreestyleEmptyState
          mode="free"
          onSwitchMode={() => undefined}
          onReshuffle={onOpenConfig}
          // Empty round: the useful surface is config, not an empty plan list.
          onOpenSettings={onOpenConfig}
          completedCount={queueState.completedIds.length}
          mutedCount={queueState.mutedPalaceIds.length}
          hiddenCount={queueState.hiddenIds.length}
        />
      )}
      {/* Closing slot, appended rather than replacing the feed so 回看 still works. */}
      {(!loading || cards.length > 0) && !error && roundComplete ? (
        <FreestyleClosingSlot
          roundId={queueState.roundId}
          completion={roundCompletion}
          quizPalaceCount={quizPalaceCount}
          dueTomorrowCount={dueTomorrowCount}
          settlementMeta={settlementMeta}
          pendingReviewCount={waiting?.count ?? 0}
          nextReviewAt={waiting?.next_ready_at ?? null}
          onClearQuizProgress={onClearQuizProgress}
          onSettle={onSettle}
          onCancelSettlement={onCancelSettlement}
          canCancelSettlement={canCancelSettlement}
        />
      ) : null}
    </div>
  )
}
