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
  const completed = new Set(
    Array.from(input.completedIds, (item) => idOf(item)).filter(Boolean),
  )
  if (completed.has(id)) {
    // Quiz ack / compacted pass: treat as a this-round pass without a number.
    return 3
  }
  return asRating(input.roundPlan?.cardsById[id]?.lastRating)
}

export function isOccurrenceScored(
  cardId: string,
  input: Pick<UnitProgressInput, 'completedIds' | 'encounters' | 'roundPlan'>,
): boolean {
  return occurrenceScore(cardId, input) != null
}

export function isOccurrencePassed(
  cardId: string,
  input: Pick<UnitProgressInput, 'completedIds' | 'encounters' | 'roundPlan'>,
): boolean {
  const rating = occurrenceScore(cardId, input)
  return rating != null && rating >= 3
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

/** Ids of cards that still need a score this round (excluded stay out). */
export function unscoredOccurrenceIds(input: UnitProgressInput): string[] {
  const ids: string[] = []
  for (const card of input.cards) {
    const id = idOf(card.id)
    if (!id) continue
    // The yellow boundary hint is never scored; it is not outstanding work.
    if (isReviewHintId(id)) continue
    if (input.roundPlan?.cardsById[id]?.status === 'excluded') continue
    if (!isOccurrenceScored(id, input)) ids.push(id)
  }
  return ids
}

/**
 * 完成 while the round is open: queue-order first unscored card.
 * "谁最早看谁" — one rule, no family / unhandled multi-level priority.
 */
export function findEarliestUnscoredIndex(input: UnitProgressInput): number | null {
  const index = input.cards.findIndex((card) => {
    const id = idOf(card.id)
    if (!id) return false
    if (isReviewHintId(id)) return false
    if (input.roundPlan?.cardsById[id]?.status === 'excluded') return false
    return !isOccurrenceScored(id, input)
  })
  return index >= 0 ? index : null
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
    const sourceId = idOf((card as { source_card_id?: string }).source_card_id) || id
    families.add(sourceId)
  }
  if (families.size === 0) return false
  return [...families].every((sourceId) => passed.has(sourceId))
}
