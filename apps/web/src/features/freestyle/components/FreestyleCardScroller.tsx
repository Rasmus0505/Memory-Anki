import {
  type RefObject,
  type UIEventHandler,
  type MutableRefObject,
} from 'react'
import { FreestyleActionCardView } from '@/features/freestyle/components/FreestyleActionCardView'
import {
  FreestyleEmptyState,
  FreestyleFeedErrorState,
  FreestyleLoadingState,
} from '@/features/freestyle/components/FreestyleFeedStates'
import { FreestyleQuizCardView } from '@/features/freestyle/components/FreestyleQuizCardView'
import { FreestyleRoundSummaryCard } from '@/features/freestyle/components/FreestyleRoundSummaryCard'
import type { FreestyleConfig } from '@/features/freestyle/model/freestyle'
import { isActionCard, isQuizCard } from '@/features/freestyle/model/freestyle-cards'
import type {
  FreestyleMode,
  TodayTrainingConfig,
  TodayTrainingSummary,
} from '@/features/freestyle/model/today-training'
import type { QuizRuntimeState } from '@/entities/quiz'
import type { FreestyleCard, FreestyleQuizCard } from '@/shared/api/contracts'
import { cn } from '@/shared/lib/utils'

export function FreestyleCardScroller({
  scrollRef,
  cardRefs,
  feedLoading,
  feedError,
  mode,
  config,
  todayConfig,
  queue,
  canCompleteRound,
  progressQuestionStates,
  answeredQuestionIds,
  todaySummary,
  onScroll,
  onLoadFeed,
  onLoadTodayFeed,
  onCopyDiagnostics,
  onSwitchMode,
  onReshuffle,
  onOpenSettings,
  onOpenPalace,
  onQuestionStateChange,
  onChoiceResolve,
  onShortAnswerSubmit,
  onRequestShortAnswerFeedback,
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  cardRefs: MutableRefObject<Record<string, HTMLElement | null>>
  feedLoading: boolean
  feedError: string
  mode: FreestyleMode
  config: FreestyleConfig
  todayConfig: TodayTrainingConfig
  queue: FreestyleCard[]
  canCompleteRound: boolean
  progressQuestionStates: Record<number, QuizRuntimeState>
  answeredQuestionIds: Set<number>
  todaySummary: TodayTrainingSummary
  onScroll: UIEventHandler<HTMLDivElement>
  onLoadFeed: (config: FreestyleConfig) => Promise<void>
  onLoadTodayFeed: (config: TodayTrainingConfig) => Promise<void>
  onCopyDiagnostics: () => Promise<void>
  onSwitchMode: (mode: FreestyleMode) => void
  onReshuffle: () => void
  onOpenSettings: () => void
  onOpenPalace: () => void
  onQuestionStateChange: (
    questionId: number,
    updater: (current: QuizRuntimeState) => QuizRuntimeState,
  ) => void
  onChoiceResolve: (card: FreestyleQuizCard, optionId: string, isCorrect: boolean) => void
  onShortAnswerSubmit: (card: FreestyleQuizCard) => void
  onRequestShortAnswerFeedback: (card: FreestyleQuizCard) => void
}) {
  return (
    <div
      ref={scrollRef}
      data-page-history-scroll-key="freestyle-cards"
      className={cn(
        'snap-y snap-mandatory overflow-y-auto overflow-x-hidden overscroll-contain will-change-scroll',
        'h-[calc(100dvh-5.5rem-env(safe-area-inset-bottom,0px))] lg:h-[calc(100vh-88px)]',
      )}
      onScroll={onScroll}
    >
      {feedLoading ? (
        <FreestyleLoadingState />
      ) : feedError ? (
        <FreestyleFeedErrorState
          feedError={feedError}
          mode={mode}
          config={config}
          todayConfig={todayConfig}
          onLoadFeed={onLoadFeed}
          onLoadTodayFeed={onLoadTodayFeed}
          onCopyDiagnostics={onCopyDiagnostics}
        />
      ) : queue.length === 0 ? (
        <FreestyleEmptyState
          mode={mode}
          onSwitchMode={onSwitchMode}
          onReshuffle={onReshuffle}
          onOpenSettings={onOpenSettings}
        />
      ) : (
        <>
          {queue.map((card) => (
            <section
              key={card.id}
              ref={(node) => {
                cardRefs.current[card.id] = node
              }}
              className="freestyle-card-enter relative flex min-h-full w-full max-w-[100vw] snap-start [scroll-snap-stop:always] items-center justify-center overflow-hidden bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900"
            >
              {isQuizCard(card) ? (
                <FreestyleQuizCardView
                  card={card}
                  state={progressQuestionStates[card.question.id]}
                  answeredBefore={answeredQuestionIds.has(card.question.id)}
                  onStateChange={(updater) => onQuestionStateChange(card.question.id, updater)}
                  onChoiceResolve={(optionId, isCorrect) => onChoiceResolve(card, optionId, isCorrect)}
                  onShortAnswerSubmit={() => onShortAnswerSubmit(card)}
                  onRequestShortAnswerFeedback={() => onRequestShortAnswerFeedback(card)}
                />
              ) : isActionCard(card) ? (
                <FreestyleActionCardView card={card} onOpenPalace={onOpenPalace} />
              ) : null}
            </section>
          ))}
          {mode === 'today' && canCompleteRound ? (
            <section
              ref={(node) => {
                // Mutable ref registry used by the page-level scroll controller.
                // eslint-disable-next-line react-hooks/immutability
                cardRefs.current.__today_summary__ = node
              }}
              className="freestyle-card-enter relative flex min-h-full w-full max-w-[100vw] snap-start [scroll-snap-stop:always] items-center justify-center overflow-hidden bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900"
            >
              <FreestyleRoundSummaryCard
                summary={todaySummary}
                onNextRound={onReshuffle}
                onSwitchToFree={() => onSwitchMode('free')}
              />
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}
