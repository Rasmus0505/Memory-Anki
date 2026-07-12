import { assign, createMachine } from 'xstate'
import { canCompleteRound, clampTrainingIndex, type TrainingRoundCard } from '../../domain/trainingRound'

interface FreestyleTrainingContext {
  cards: TrainingRoundCard[]
  currentIndex: number
  resolvedQuestionIds: Set<number>
}

type FreestyleTrainingEvent =
  | { type: 'ROUND_SYNCED'; cards: TrainingRoundCard[]; currentIndex: number; resolvedQuestionIds: number[] }
  | { type: 'SCROLL_SETTLED'; currentIndex: number }
  | { type: 'ROUND_COMPLETE_REQUESTED' }
  | { type: 'ROUND_RESTARTED' }

const roundCanComplete = ({ context }: { context: FreestyleTrainingContext }) => canCompleteRound(context.cards, context)

export const freestyleTrainingMachine = createMachine({
  types: {} as { context: FreestyleTrainingContext; events: FreestyleTrainingEvent },
  id: 'freestyleTraining',
  context: { cards: [], currentIndex: 0, resolvedQuestionIds: new Set<number>() },
  initial: 'training',
  states: {
    training: {
      on: {
        ROUND_SYNCED: {
          actions: assign(({ event }) => {
            const progress = { currentIndex: event.currentIndex, resolvedQuestionIds: new Set(event.resolvedQuestionIds) }
            return {
              cards: event.cards,
              currentIndex: clampTrainingIndex(event.cards, progress),
              resolvedQuestionIds: progress.resolvedQuestionIds,
            }
          }),
        },
        SCROLL_SETTLED: {
          actions: assign(({ context, event }) => ({
            currentIndex: clampTrainingIndex(context.cards, {
              currentIndex: event.currentIndex,
              resolvedQuestionIds: context.resolvedQuestionIds,
            }),
          })),
        },
        ROUND_COMPLETE_REQUESTED: { guard: roundCanComplete, target: 'completed' },
      },
    },
    completed: {
      on: {
        ROUND_RESTARTED: { target: 'training', actions: assign({ currentIndex: 0 }) },
        ROUND_SYNCED: {
          target: 'training',
          actions: assign(({ event }) => ({
            cards: event.cards,
            currentIndex: event.currentIndex,
            resolvedQuestionIds: new Set(event.resolvedQuestionIds),
          })),
        },
      },
    },
  },
})
