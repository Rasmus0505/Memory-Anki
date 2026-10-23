import { type ComponentProps, type CSSProperties } from 'react'
import { FreestyleRatingReaction } from '@/modules/practice/ui/freestyle/components/FreestyleRatingReaction'
import { FreestyleUnitReviewCardView } from '@/modules/practice/ui/freestyle/components/FreestyleUnitReviewCardView'
import { FreestyleQuizCardView } from '@/modules/practice/ui/freestyle/components/FreestyleQuizCardView'
import { FreestyleReviewHintCardView } from '@/modules/practice/ui/freestyle/components/FreestyleReviewHintCardView'
import { FreestyleRetryCornerBadge } from '@/modules/practice/ui/freestyle/FreestyleRetryCornerBadge'
import { StaleUnitReviewCard } from '@/modules/practice/ui/freestyle/StaleUnitReviewCard'
import { examStarsOf } from '@/modules/practice/ui/freestyle/freestylePageHelpers'
import { cardAmbientHsl } from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import { isMindMapBranchCard, isQuizCard } from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import { RESTUDY_MAX_INTERVENING } from '@/modules/practice/public'
import { isReviewHintCard, type FreestyleCard, type FreestyleQuizCard } from '@/shared/api/contracts'
import { ExamStarBadge } from '@/modules/exam/public'

type UnitProps = ComponentProps<typeof FreestyleUnitReviewCardView>
type QuizProps = ComponentProps<typeof FreestyleQuizCardView>

export function FreestyleFeedCard({
  card,
  index,
  currentIndex,
  visualIndex,
  isActive,
  settlementVisible,
  readOnlyHistoryCardId,
  freestyleFullscreen,
  flipMode,
  mindmapZoom,
  roundId,
  planVersion,
  encounter,
  planEntry,
  completed,
  questionState,
  answeredBefore,
  liveRevealMap,
  onFlipModeChange,
  onMindmapZoomChange,
  onToggleFullscreen,
  onEnsureEncounter,
  onEncounterChange,
  onStaleDrop,
  onRemoveFromQueue,
  onRemovePermanently,
  onRebuildRound,
  onRevisionAdopted,
  onSaveFailed,
  onEditingChange,
  onUnitsReconciled,
  onLiveRevealMapChange,
  onOpenScopeQuiz,
  onQuestionStateChange,
  onChoiceResolve,
  onShortAnswerSubmit,
  onNavigateToIndex,
}: {
  card: FreestyleCard
  index: number
  currentIndex: number
  visualIndex: number
  isActive: boolean
  settlementVisible: boolean
  readOnlyHistoryCardId: string | null
  freestyleFullscreen: boolean
  flipMode: UnitProps['freestyleFlipMode']
  mindmapZoom: UnitProps['preferredZoom']
  roundId: string
  planVersion: UnitProps['planVersion']
  encounter: UnitProps['encounter']
  planEntry: { status?: string; retryAfterCards?: number; lastRating?: UnitProps['lastRating'] } | undefined
  completed: boolean
  questionState: QuizProps['state']
  answeredBefore: boolean
  liveRevealMap: UnitProps['liveRevealMap']
  onFlipModeChange: UnitProps['onFreestyleFlipModeChange']
  onMindmapZoomChange: UnitProps['onUserZoomChange']
  onToggleFullscreen: UnitProps['onToggleFullscreen']
  onEnsureEncounter: UnitProps['onEnsureEncounter']
  onEncounterChange: UnitProps['onEncounterChange']
  onStaleDrop: UnitProps['onStaleDrop']
  onRemoveFromQueue: UnitProps['onRemoveFromQueue']
  onRemovePermanently: UnitProps['onRemovePermanently']
  onRebuildRound: UnitProps['onRebuildRound']
  onRevisionAdopted: UnitProps['onRevisionAdopted']
  onSaveFailed: UnitProps['onSaveFailed']
  onEditingChange: UnitProps['onEditingChange']
  onUnitsReconciled: UnitProps['onUnitsReconciled']
  onLiveRevealMapChange: UnitProps['onLiveRevealMapChange']
  onOpenScopeQuiz: UnitProps['onOpenScopeQuiz']
  onQuestionStateChange: (questionId: number, updater: Parameters<QuizProps['onStateChange']>[0]) => void
  onChoiceResolve: (card: FreestyleQuizCard, optionId: string | string[], isCorrect: boolean) => void
  onShortAnswerSubmit: (card: FreestyleQuizCard) => void
  onNavigateToIndex: (index: number) => void
}) {
  const active = isActive && index === currentIndex && index === visualIndex && !settlementVisible
  return (
    <div
      className="fs-page relative box-border flex h-full min-h-0 shrink-0 flex-col snap-start snap-always p-0"
      style={{ '--fs-ambient': cardAmbientHsl(card) } as CSSProperties}
    >
      {/* Depth stack layer (styles/freestyle.css): scroll-driven rise-in and
          recede. Keeps the 6px progress rail band on the dark shell for PWA. */}
      <div className="fs-depth flex min-h-0 flex-1 flex-col pt-[calc(env(safe-area-inset-top,0px)+4.75rem)]">
      <FreestyleRatingReaction active={active}>
        <div
          className="relative flex min-h-0 flex-1 flex-col"
          data-exam-stars={examStarsOf(card) ?? undefined}
        >
          {examStarsOf(card) ? (
            <span className="exam-feed-corner" aria-hidden={examStarsOf(card) === 1}>
              <ExamStarBadge stars={examStarsOf(card) ?? 1} />
            </span>
          ) : null}
          {isMindMapBranchCard(card) ? (
              card.unit_id && card.unit_revision != null ? (
                <FreestyleUnitReviewCardView
                  card={card}
                  active={active}
                  nearViewport={isActive && Math.abs(index - visualIndex) <= 1}
                  readOnly={readOnlyHistoryCardId === card.id}
                  roundId={roundId}
                  planVersion={planVersion}
                  encounter={encounter}
                  lastRating={planEntry?.lastRating ?? null}
                  retryAfterCards={RESTUDY_MAX_INTERVENING}
                  fullscreen={freestyleFullscreen && index === currentIndex}
                  onToggleFullscreen={onToggleFullscreen}
                  freestyleFlipMode={flipMode}
                  onFreestyleFlipModeChange={onFlipModeChange}
                  autoAdvance={false}
                  preferredZoom={mindmapZoom}
                  onUserZoomChange={onMindmapZoomChange}
                  blockedHint={null}
                  onEnsureEncounter={onEnsureEncounter}
                  onEncounterChange={onEncounterChange}
                  onStaleDrop={onStaleDrop}
                  onRemoveFromQueue={onRemoveFromQueue}
                  onRemovePermanently={onRemovePermanently}
                  onRebuildRound={onRebuildRound}
                  onRevisionAdopted={onRevisionAdopted}
                  onSaveFailed={onSaveFailed}
                  onEditingChange={index === currentIndex ? onEditingChange : undefined}
                  onUnitsReconciled={onUnitsReconciled}
                  liveRevealMap={index === currentIndex ? liveRevealMap : null}
                  onLiveRevealMapChange={onLiveRevealMapChange}
                  onOpenScopeQuiz={onOpenScopeQuiz}
                />
              ) : (
                <StaleUnitReviewCard
                  cardId={card.id}
                  onStaleDrop={onStaleDrop}
                />
              )
          ) : isQuizCard(card) ? (
            <FreestyleQuizCardView
              card={card}
              active={active}
              state={questionState}
              answeredBefore={answeredBefore}
              onStateChange={(updater) => onQuestionStateChange(card.question.id, updater)}
              onChoiceResolve={(optionId, isCorrect) => onChoiceResolve(card, optionId, isCorrect)}
              onShortAnswerSubmit={() => {
                onShortAnswerSubmit(card)
              }}
              onRequestNext={() => {
                onNavigateToIndex(index + 1)
              }}
            />
          ) : isReviewHintCard(card) ? (
            <FreestyleReviewHintCardView
              card={card}
              active={active}
              onAdvance={() => {
                onNavigateToIndex(index + 1)
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-stage-muted">
              暂不支持的卡片类型
            </div>
          )}
        </div>
      </FreestyleRatingReaction>
      <FreestyleRetryCornerBadge
        card={card}
        retryAfterCards={planEntry?.status === 'retry' ? planEntry.retryAfterCards : undefined}
        completed={completed}
      />
      </div>
    </div>
  )
}
