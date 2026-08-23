import {
  cardPalaceId,
  sourceCardId,
  type FreestyleUnitEncounterState,
} from '@/modules/practice/public'
import type { FreestyleCard, FreestyleReviewUnitCard } from '@/shared/api/contracts'

export interface PalaceRatingSettleCard {
  cardId: string
  unitId: string
}

export interface PalaceRatingTarget {
  palaceId: number
  /** Units that will actually receive this palace rate, including the current card. */
  dueCount: number
  excludeUnitIds: string[]
  /** In-round units the server must include even when they are fill / not due. */
  includeUnitIds: string[]
  settleCards: PalaceRatingSettleCard[]
}

function isReviewUnitCard(card: FreestyleCard): card is FreestyleReviewUnitCard {
  return card.type === 'mindmap_branch' && Boolean(card.unit_id)
}

function isRatedThisRound(
  card: FreestyleReviewUnitCard,
  completed: ReadonlySet<string>,
  encounters: Record<string, FreestyleUnitEncounterState>,
) {
  const sourceId = sourceCardId(card)
  if (completed.has(card.id) || completed.has(sourceId)) return true
  if (encounters[card.id]?.selectedRating != null) return true
  if (encounters[sourceId]?.selectedRating != null) return true
  return false
}

/**
 * Decide which units a palace-scope rate should touch.
 *
 * Server still owns the due set. This only tells the client which in-round
 * cards to settle and which already-rated unit ids to exclude.
 */
export function buildPalaceRatingTarget(input: {
  current: FreestyleReviewUnitCard
  cards: readonly FreestyleCard[]
  leftoverDue: number
  completedIds?: Iterable<string>
  encountersByCardId?: Record<string, FreestyleUnitEncounterState>
}): PalaceRatingTarget {
  const palaceId = cardPalaceId(input.current) ?? input.current.palace_id
  const completed = new Set(Array.from(input.completedIds ?? [], String))
  const encounters = input.encountersByCardId ?? {}
  const palaceCards = input.cards.filter(
    (card): card is FreestyleReviewUnitCard =>
      isReviewUnitCard(card) && cardPalaceId(card) === palaceId,
  )

  const excludeUnitIds = new Set<string>()
  for (const card of palaceCards) {
    if (card.unit_id === input.current.unit_id) continue
    if (isRatedThisRound(card, completed, encounters)) {
      excludeUnitIds.add(card.unit_id)
    }
  }

  const settleByUnit = new Map<string, PalaceRatingSettleCard>()
  settleByUnit.set(input.current.unit_id, {
    cardId: input.current.id,
    unitId: input.current.unit_id,
  })

  for (const card of palaceCards) {
    if (card.unit_id === input.current.unit_id) continue
    if (excludeUnitIds.has(card.unit_id)) continue
    if (!settleByUnit.has(card.unit_id)) {
      settleByUnit.set(card.unit_id, { cardId: card.id, unitId: card.unit_id })
    }
  }

  const leftoverDue = Math.max(0, Math.round(Number(input.leftoverDue) || 0))
  const settleCards = [...settleByUnit.values()]
  return {
    palaceId,
    dueCount: settleCards.length + leftoverDue,
    excludeUnitIds: [...excludeUnitIds],
    includeUnitIds: settleCards.map((item) => item.unitId),
    settleCards,
  }
}

export function palaceRatingPreviewLabel(dueCount: number, kind: 'pass' | 'fail' | 'locked') {
  const count = Math.max(1, Math.round(dueCount) || 1)
  if (kind === 'locked') return `${count}小节不改期`
  if (kind === 'fail') return `${count}小节重练`
  return `${count}小节`
}

export function palaceRatingEffectLine(label: string, dueCount: number) {
  const count = Math.max(1, Math.round(dueCount) || 1)
  return `已选${label} · 今日 ${count} 个到期小节，各自按阶梯改期`
}
