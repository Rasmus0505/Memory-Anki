import { isReviewHintId, type FreestyleCard } from '@/shared/api/contracts'
import type { FreestyleRoundPlanState } from './roundPlan'
import type { FreestyleUnitEncounterState } from './queueState'

/**
 * Single source of truth for "has this occurrence been scored this round?".
 *
 * Occurrence-local only: a 重练 id never inherits the source card's score.
 * Progress-rail fill and the 完成 seek target must both read this module —
 * do not reassemble scored/handled/passed booleans at call sites.
 */
export type UnitProgressInput = {
  cards: ReadonlyArray<FreestyleCard>
  completedIds: Iterable<string>
  encounters: Record<string, FreestyleUnitEncounterState>
  roundPlan: FreestyleRoundPlanState | null
  /** Still in the feed, but already 移除本队列. Not outstanding work. */
  hiddenIds?: Iterable<string>
}

function asRating(value: unknown): 1 | 2 | 3 | 4 | null {
  const rating = Math.round(Number(value))
  return rating === 1 || rating === 2 || rating === 3 || rating === 4 ? rating : null
}

function idOf(raw: string | null | undefined): string {
  return String(raw || '').trim()
}

/**
 * This occurrence's this-round score. Never falls back to another id's
 * `lastRating` (that is how an unscored 重练 looked already-rated).
 */
export function occurrenceScore(
  cardId: string,
  input: Pick<UnitProgressInput, 'completedIds' | 'encounters' | 'roundPlan'>,
): 1 | 2 | 3 | 4 | null {
  const id = idOf(cardId)
  if (!id) return null
  const live = asRating(input.encounters[id]?.selectedRating)
  if (live != null) return live
  return asRating(input.roundPlan?.cardsById[id]?.lastRating)
}

export function isOccurrenceScored(
  cardId: string,
  input: Pick<UnitProgressInput, 'completedIds' | 'encounters' | 'roundPlan'>,
): boolean {
  const id = idOf(cardId)
  // 移除本队列 is handled, not a 1-4 pass. Callers that need a grade still use occurrenceScore.
  if (id && input.roundPlan?.cardsById[id]?.status === 'excluded') return true
  // Shared completion / quiz acknowledgement is handled without inventing a grade.
  if (id && new Set(Array.from(input.completedIds, idOf)).has(id)) return true
  return occurrenceScore(cardId, input) != null
}

export function isOccurrencePassed(
  cardId: string,
  input: Pick<UnitProgressInput, 'completedIds' | 'encounters' | 'roundPlan'>,
): boolean {
  const id = idOf(cardId)
  const rating = occurrenceScore(cardId, input)
  if (rating != null) return rating >= 3
  return Boolean(id && new Set(Array.from(input.completedIds, idOf)).has(id))
}

/** Ids of cards that already have a this-round score (weak and pass alike). */
export function scoredOccurrenceIds(input: UnitProgressInput): string[] {
  const ids: string[] = []
  for (const card of input.cards) {
    const id = idOf(card.id)
    if (id && isOccurrenceScored(id, input)) ids.push(id)
  }
  return ids
}

/**
 * `review_unit:UNIT:rN` → UNIT. Inlined so this module does not value-import
 * queueState (that module already imports occurrence scoring).
 */
function sourceUnitKeyFromId(cardId: string): string {
  const text = idOf(cardId)
  if (!text.startsWith('review_unit:')) return ''
  const rest = text.slice('review_unit:'.length)
  const marker = rest.lastIndexOf(':r')
  if (marker <= 0) return ''
  const revision = rest.slice(marker + 2)
  return /^\d+$/.test(revision) ? rest.slice(0, marker) : ''
}

function cardUnitKey(card: FreestyleCard): string {
  if ('unit_id' in card) return idOf(card.unit_id)
  return ''
}

function isRetryCard(card: FreestyleCard): boolean {
  if (card.occurrence_kind === 'retry') return true
  const source = 'source_card_id' in card ? idOf(card.source_card_id) : ''
  return Boolean(source && source !== idOf(card.id))
}

/**
 * A later revision of a unit already 移除队列. The removal tick stays on the
 * old id; this id must not look unscored. Retries and already-scored cards
 * are not shadows — callers still score those on their own id.
 */
export function isShadowOfQueueRemoval(
  cardId: string,
  plan: FreestyleRoundPlanState | null,
  unitId = '',
): boolean {
  const id = idOf(cardId)
  if (!id || !plan || id.startsWith('retry:')) return false
  const entry = plan.cardsById[id]
  if (entry?.status === 'excluded' || entry?.occurrenceKind === 'retry') return false
  if (entry?.status === 'completed' || entry?.status === 'retry' || entry?.lastRating != null) return false
  const unit = sourceUnitKeyFromId(id) || idOf(unitId)
  if (!unit) return false
  return Object.values(plan.cardsById).some((item) => {
    if (item.status !== 'excluded' || item.occurrenceKind === 'retry' || item.cardId === id) return false
    const excludedUnit = sourceUnitKeyFromId(item.cardId) || sourceUnitKeyFromId(item.sourceCardId)
    return Boolean(excludedUnit && excludedUnit === unit)
  })
}

function isUnscoredRemovalShadow(card: FreestyleCard, input: UnitProgressInput): boolean {
  if (isRetryCard(card) || isOccurrenceScored(card.id, input)) return false
  return isShadowOfQueueRemoval(card.id, input.roundPlan, cardUnitKey(card))
}

function hiddenIdSet(ids: Iterable<string> | undefined): Set<string> {
  return new Set(Array.from(ids ?? [], (item) => idOf(item)).filter(Boolean))
}

/** Still needs a this-round score. 移除本队列, its rebound, and the yellow hint do not. */
function isOutstandingUnscored(
  card: FreestyleCard,
  input: UnitProgressInput,
  hidden: Set<string>,
): boolean {
  const id = idOf(card.id)
  if (!id || hidden.has(id)) return false
  if (isReviewHintId(id)) return false
  if (input.roundPlan?.cardsById[id]?.status === 'excluded') return false
  if (isUnscoredRemovalShadow(card, input)) return false
  return !isOccurrenceScored(id, input)
}

/** Ids of cards that still need a score this round (excluded stay out). */
export function unscoredOccurrenceIds(input: UnitProgressInput): string[] {
  const hidden = hiddenIdSet(input.hiddenIds)
  const ids: string[] = []
  for (const card of input.cards) {
    const id = idOf(card.id)
    if (id && isOutstandingUnscored(card, input, hidden)) ids.push(id)
  }
  return ids
}

/** Queue indexes of cards that still need a score. Same exclusions as the id list. */
export function unscoredOccurrenceIndices(input: UnitProgressInput): number[] {
  const hidden = hiddenIdSet(input.hiddenIds)
  const indices: number[] = []
  input.cards.forEach((card, index) => {
    if (isOutstandingUnscored(card, input, hidden)) indices.push(index)
  })
  return indices
}

/**
 * 完成 while the round is open: queue-order first unscored card.
 * "谁最早看谁" — one rule, no family / unhandled multi-level priority.
 * A card removed from this queue is not a target, even if it is still in the feed.
 */
export function findEarliestUnscoredIndex(input: UnitProgressInput): number | null {
  return unscoredOccurrenceIndices(input)[0] ?? null
}

/**
 * Unit-level "has passed" ids: the occurrence itself plus its source when a
 * 重练 passes. Palace gates and family completion use this fold.
 */
export function passedOccurrenceIds(input: UnitProgressInput): string[] {
  const ids = new Set<string>()
  for (const card of input.cards) {
    const id = idOf(card.id)
    if (!id || isReviewHintId(id)) continue
    if (!isOccurrencePassed(id, input)) continue
    ids.add(id)
    const sourceId = idOf((card as { source_card_id?: string }).source_card_id) || id
    if (sourceId) ids.add(sourceId)
  }
  return [...ids]
}

/**
 * Unit-family "done": every source family has at least one pass
 * (occurrence pass folds onto its source). Weak scores alone never close.
 */
export function areAllOccurrencesPassed(input: UnitProgressInput): boolean {
  if (input.cards.length === 0) return false
  const passed = new Set(passedOccurrenceIds(input))
  const families = new Set<string>()
  for (const card of input.cards) {
    const id = idOf(card.id)
    if (!id) continue
    if (isReviewHintId(id)) continue
    if (input.roundPlan?.cardsById[id]?.status === 'excluded') continue
    if (!isOccurrencePassed(id, input) && isUnscoredRemovalShadow(card, input)) continue
    const sourceId = idOf((card as { source_card_id?: string }).source_card_id) || id
    families.add(sourceId)
  }
  if (families.size === 0) return false
  return [...families].every((sourceId) => passed.has(sourceId))
}
