export interface TrainingRoundCard {
  id: string
  quizQuestionId: number | null
}

export interface TrainingRoundProgress {
  currentIndex: number
  resolvedQuestionIds: ReadonlySet<number>
}

export function canCompleteRound(cards: readonly TrainingRoundCard[], progress: TrainingRoundProgress) {
  return cards.length > 0 && cards.every((card) => (
    card.quizQuestionId == null || progress.resolvedQuestionIds.has(card.quizQuestionId)
  ))
}

export function clampTrainingIndex(cards: readonly TrainingRoundCard[], progress: TrainingRoundProgress) {
  const maximum = canCompleteRound(cards, progress) ? cards.length : Math.max(0, cards.length - 1)
  return Math.min(Math.max(0, progress.currentIndex), maximum)
}
