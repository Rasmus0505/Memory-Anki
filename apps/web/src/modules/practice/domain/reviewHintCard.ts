import {
  FREESTYLE_REVIEW_HINT_ID,
  FREESTYLE_REVIEW_HINT_TEXT,
  isReviewHintId,
  type FreestyleCard,
  type FreestyleReviewHintCard,
} from '@/shared/api/contracts'

export function createReviewHintCard(): FreestyleReviewHintCard {
  return {
    id: FREESTYLE_REVIEW_HINT_ID,
    type: 'review_hint',
    content_type: 'review_hint',
    text: FREESTYLE_REVIEW_HINT_TEXT,
  }
}

export function stripReviewHintCards(cards: FreestyleCard[]): FreestyleCard[] {
  return cards.filter((card) => !isReviewHintId(card.id) && card.type !== 'review_hint')
}

/** First formal review unit card: a mindmap branch that carries unit identity. */
function firstFormalReviewIndex(cards: FreestyleCard[]): number {
  return cards.findIndex(
    (card) => card.type === 'mindmap_branch' && 'unit_id' in card && Boolean(card.unit_id),
  )
}

/**
 * Idempotent placement of the single yellow boundary hint: strip any existing
 * copy, then insert it immediately before the queue's first formal review unit
 * — only when that unit is not already at index 0. Kept out of builtCards and
 * every server round-plan write; only the presented feed contains it.
 */
export function insertReviewHintCards(cards: FreestyleCard[]): FreestyleCard[] {
  const stripped = stripReviewHintCards(cards)
  const index = firstFormalReviewIndex(stripped)
  if (index <= 0) return stripped
  return [...stripped.slice(0, index), createReviewHintCard(), ...stripped.slice(index)]
}
