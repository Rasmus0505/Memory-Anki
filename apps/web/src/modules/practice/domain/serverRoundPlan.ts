import type { FreestyleCard, FreestyleRoundPlanPayload, FreestyleRoundStatePayload } from '@/shared/api/contracts'

import { cardUnitId, createRetryOccurrence, isRetryOccurrence, reviewUnitIdFromCardId, sourceCardId } from './queueState'

export function retryOccurrenceId(roundId: string, sourceId: string, attempt: number) {
  return `retry:${roundId}:${sourceId}:${attempt}`
}

export function cardsForServerPlan(
  cards: FreestyleCard[],
  plan: FreestyleRoundPlanPayload | null | undefined,
  roundId: string,
): FreestyleCard[] {
  if (!plan?.presented_ids?.length) return cards
  const byId = new Map(cards.map((card) => [card.id, card]))
  const sources = cards.filter((card) => !isRetryOccurrence(card))
  const bySource = new Map(sources.map((card) => [sourceCardId(card) || card.id, card]))
  const byUnit = new Map(
    sources.flatMap((card) => {
      const unitId = 'unit_id' in card ? String(card.unit_id || '') : ''
      return unitId ? [[unitId, card] as const] : []
    }),
  )
  const ordered: FreestyleCard[] = []
  const seen = new Set<string>()

  const push = (card: FreestyleCard | undefined) => {
    if (!card || seen.has(card.id)) return
    seen.add(card.id)
    ordered.push(card)
  }

  for (const id of plan.presented_ids) {
    const existing = byId.get(id)
    if (existing) {
      push(existing)
      continue
    }
    const original = (plan.original_cards || []).find((item) => item.card_id === id)
    const unitMatch = original?.unit_id ? byUnit.get(original.unit_id) : undefined
    if (unitMatch) {
      push(unitMatch)
      continue
    }
    const occurrence = (plan.occurrences || []).find((item) => item.occurrence_id === id)
    const sourceId = occurrence?.source_card_id || parseRetrySourceId(id)
    const source = (sourceId ? byId.get(sourceId) || bySource.get(sourceId) : undefined)
      || (occurrence?.source_unit_id ? byUnit.get(occurrence.source_unit_id) : undefined)
    if (!source) continue
    const attempt = occurrence?.retry_attempt || parseRetryAttempt(id)
    push(createRetryOccurrence(source, roundId, attempt, 3))
  }

  for (const card of cards) push(card)
  return ordered
}

function finishedUnitIds(
  completed: Set<string>,
  cards: FreestyleCard[],
): Set<string> {
  const units = new Set<string>()
  completed.forEach((id) => {
    const unitId = reviewUnitIdFromCardId(id)
    if (unitId) units.add(unitId)
    const card = cards.find((item) => item.id === id)
    const cardUnit = cardUnitId(card)
    if (cardUnit) units.add(cardUnit)
  })
  return units
}

function isFinishedCard(
  id: string,
  card: FreestyleCard | undefined,
  completed: Set<string>,
  excluded: Set<string>,
  completedUnits: Set<string>,
) {
  if (completed.has(id) || excluded.has(id)) return true
  const unitId = cardUnitId(card) || reviewUnitIdFromCardId(id)
  return Boolean(unitId && completedUnits.has(unitId))
}

export function nextUnfinishedCardId(
  plan: FreestyleRoundPlanPayload | null | undefined,
  cards: FreestyleCard[],
): string | null {
  if (!plan) return cards[0]?.id ?? null
  const completed = new Set((plan.completed_ids || []).map(String))
  const excluded = new Set((plan.excluded_ids || []).map(String))
  const completedUnits = finishedUnitIds(completed, cards)
  const current = String(plan.current_card_id || '').trim()
  const currentCard = cards.find((card) => card.id === current)
    || cards.find((card) => cardUnitId(card) && cardUnitId(card) === reviewUnitIdFromCardId(current))
  if (current && !isFinishedCard(current, currentCard, completed, excluded, completedUnits)) {
    if (currentCard) return currentCard.id
  }
  for (const id of plan.presented_ids || []) {
    if (!id) continue
    const card = cards.find((item) => item.id === id)
      || cards.find((item) => cardUnitId(item) && cardUnitId(item) === reviewUnitIdFromCardId(id))
    if (!card || isFinishedCard(id, card, completed, excluded, completedUnits)) continue
    return card.id
  }
  return cards.find((card) => !isFinishedCard(card.id, card, completed, excluded, completedUnits))?.id ?? null
}

export function serverPlanVersion(round: FreestyleRoundStatePayload | null | undefined) {
  if (!round) return 0
  const version = Number(round.plan_version ?? round.version)
  return Number.isInteger(version) && version > 0 ? version : 0
}

function parseRetrySourceId(occurrenceId: string) {
  const parts = String(occurrenceId || '').split(':')
  if (parts[0] !== 'retry' || parts.length < 4) return ''
  return parts.slice(2, -1).join(':')
}

function parseRetryAttempt(occurrenceId: string) {
  const parts = String(occurrenceId || '').split(':')
  const attempt = Number(parts[parts.length - 1])
  return Number.isInteger(attempt) && attempt > 0 ? attempt : 1
}
