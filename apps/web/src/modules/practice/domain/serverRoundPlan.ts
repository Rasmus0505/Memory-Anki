import type {
  FreestyleCard,
  FreestyleRoundOriginalCard,
  FreestyleRoundPlanPayload,
  FreestyleRoundStatePayload,
} from '@/shared/api/contracts'

import { updateRoundPlanCard, type FreestyleRoundPlanState } from './roundPlan'
import {
  cardUnitId,
  createRetryOccurrence,
  isRetryOccurrence,
  reviewUnitIdFromCardId,
  sourceCardId,
  type FreestyleUnitEncounterState,
} from './queueState'

export function retryOccurrenceId(roundId: string, sourceId: string, attempt: number) {
  return `retry:${roundId}:${sourceId}:${attempt}`
}

/** Stamp leftover/today cohorts from the server plan onto the HUD round plan. */
export function applyServerCohorts(
  plan: FreestyleRoundPlanState,
  server: FreestyleRoundPlanPayload | null | undefined,
): FreestyleRoundPlanState {
  if (!server) return plan
  const sourceEntered = new Map(
    (server.original_cards || []).map((item) => [item.card_id, String(item.entered_on || '').trim()]),
  )
  const occEntered = new Map(
    (server.occurrences || []).map((item) => [
      item.occurrence_id,
      String(item.entered_on || '').trim() || sourceEntered.get(item.source_card_id) || '',
    ]),
  )
  const cardsById = { ...plan.cardsById }
  for (const id of Object.keys(cardsById)) {
    const item = cardsById[id]
    const entered = item.occurrenceKind === 'retry'
      ? (occEntered.get(id) || sourceEntered.get(item.sourceCardId) || '')
      : (sourceEntered.get(id) || sourceEntered.get(item.sourceCardId) || item.enteredOn || '')
    if (entered && entered !== item.enteredOn) {
      cardsById[id] = { ...item, enteredOn: entered }
    }
  }
  const today = String(server.today || '').trim()
  const presented = (server.presented_ids || []).filter((id) => Boolean(cardsById[id]))
  const extra = plan.orderIds.filter((id) => !presented.includes(id) && Boolean(cardsById[id]))
  return {
    ...plan,
    cardsById,
    today: today || plan.today,
    orderIds: presented.length ? [...presented, ...extra] : plan.orderIds,
  }
}

export function planCardCohort(
  cardId: string,
  plan: FreestyleRoundPlanState | null | undefined,
): string {
  if (!plan) return ''
  const item = plan.cardsById[cardId]
  if (item?.enteredOn) return item.enteredOn
  if (item?.sourceCardId && plan.cardsById[item.sourceCardId]?.enteredOn) {
    return plan.cardsById[item.sourceCardId].enteredOn || ''
  }
  return ''
}

/** Rebuild a review-unit card the live queue omitted because it is already done. */
export function cardFromOriginalSnapshot(
  item: FreestyleRoundOriginalCard | null | undefined,
): FreestyleCard | null {
  if (!item) return null
  const cardId = String(item.card_id || '').trim()
  const unitId = String(item.unit_id || '').trim()
  const palaceId = Number(item.palace_id)
  const kind = String(item.kind || '').trim()
  if (!cardId || !unitId) return null
  if (!Number.isInteger(palaceId) || palaceId <= 0) return null
  if (kind === 'quiz_question' || cardId.startsWith('quiz')) return null
  const label = String(item.label || '').trim()
  const revision = Math.max(1, Math.round(Number(item.unit_revision) || 1))
  return {
    id: cardId,
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: palaceId,
    palace_title: item.palace_title || '',
    anchor_uid: unitId,
    context_path: label ? [{ uid: unitId, text: label }] : [],
    node_uids: [],
    node_count: 0,
    unit_id: unitId,
    unit_revision: revision,
  }
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
  const originalById = new Map(
    (plan.original_cards || []).map((item) => [item.card_id, item] as const),
  )
  const ordered: FreestyleCard[] = []
  const seen = new Set<string>()
  const retrySources = new Set<string>()

  const push = (card: FreestyleCard | undefined) => {
    if (!card || seen.has(card.id)) return
    if (isRetryOccurrence(card)) {
      const source = sourceCardId(card) || card.id
      if (retrySources.has(source)) return
      retrySources.add(source)
    }
    seen.add(card.id)
    ordered.push(card)
  }

  for (const id of plan.presented_ids) {
    const existing = byId.get(id)
    if (existing) {
      push(existing)
      continue
    }
    const original = originalById.get(id)
    const unitMatch = original?.unit_id ? byUnit.get(original.unit_id) : undefined
    if (unitMatch) {
      push(unitMatch)
      continue
    }
    const reconstructed = cardFromOriginalSnapshot(original)
    if (reconstructed) {
      push(reconstructed)
      continue
    }
    const occurrence = (plan.occurrences || []).find((item) => item.occurrence_id === id)
    const sourceId = occurrence?.source_card_id || parseRetrySourceId(id)
    const source = (sourceId ? byId.get(sourceId) || bySource.get(sourceId) : undefined)
      || (occurrence?.source_unit_id ? byUnit.get(occurrence.source_unit_id) : undefined)
      || cardFromOriginalSnapshot(sourceId ? originalById.get(sourceId) : undefined)
    if (!source) continue
    const attempt = occurrence?.retry_attempt || parseRetryAttempt(id)
    push(createRetryOccurrence(source, roundId, attempt, 3, occurrence?.occurrence_id || id))
  }

  // A fully handled round must keep settlement reachable: do not grow the feed
  // with brand-new due tails until an explicit config confirm mints the next round.
  if (nextUnfinishedCardId(plan, ordered) == null && (plan.presented_ids || []).length > 0) {
    return ordered
  }

  // Confirmed retries already in presented_ids own the slot. A pending or
  // not-yet-echoed fail (last card: leave_card and the silent rebuild race)
  // must keep the optimistic copy, or 下一张 has no 重练 to open.
  const occurrenceStatusBySource = new Map<string, string>()
  const occurrenceRank = (status: string) => {
    if (status === 'inserted' || status === 'completed') return 3
    if (status === 'pending') return 2
    if (status === 'cancelled') return 1
    return 0
  }
  for (const item of plan.occurrences || []) {
    const source = String(item.source_card_id || '').trim()
    const status = String(item.status || '').trim()
    if (!source || !status) continue
    const previous = occurrenceStatusBySource.get(source) || ''
    if (occurrenceRank(status) < occurrenceRank(previous)) continue
    occurrenceStatusBySource.set(source, status)
  }
  for (const card of cards) {
    if (!isRetryOccurrence(card)) {
      push(card)
      continue
    }
    const source = sourceCardId(card) || ''
    if (!source || retrySources.has(source)) continue
    const status = occurrenceStatusBySource.get(source)
    // Missing: the rating has not echoed yet. Pending: leave_card has not
    // inserted it. Cancelled or already placed copies must not come back.
    if (status !== undefined && status !== 'pending') continue
    const localIndex = cards.indexOf(card)
    let predecessorId = ''
    for (let index = localIndex - 1; index >= 0; index -= 1) {
      const candidateId = cards[index]?.id
      if (candidateId && seen.has(candidateId)) {
        predecessorId = candidateId
        break
      }
    }
    push(card)
    if (ordered[ordered.length - 1]?.id !== card.id) continue
    let insertAt = ordered.length - 1
    if (predecessorId) {
      const predecessorIndex = ordered.findIndex((item) => item.id === predecessorId)
      if (predecessorIndex >= 0) insertAt = predecessorIndex + 1
    } else {
      const sourceIndex = ordered.findIndex((item) => item.id === source || sourceCardId(item) === source)
      if (sourceIndex >= 0) insertAt = sourceIndex + 1
    }
    if (insertAt >= ordered.length - 1) continue
    const placed = ordered.pop()
    if (placed) ordered.splice(insertAt, 0, placed)
  }
  return ordered
}

/** True when incoming cards include identities absent from the server plan. */
export function planHasNewDueWork(
  plan: FreestyleRoundPlanPayload | null | undefined,
  cards: FreestyleCard[],
): boolean {
  if (!plan || !cards.length) return false
  const known = new Set<string>()
  for (const item of plan.original_cards || []) {
    const cardId = String(item.card_id || '').trim()
    if (cardId) known.add(cardId)
    const unitId = String(item.unit_id || '').trim()
    if (unitId) known.add(`unit:${unitId}`)
  }
  for (const id of plan.presented_ids || []) {
    const cardId = String(id || '').trim()
    if (cardId) known.add(cardId)
  }
  return cards.some((card) => {
    if (isRetryOccurrence(card)) return false
    const cardId = String(card.id || '').trim()
    if (cardId && known.has(cardId)) return false
    const unitId = cardUnitId(card)
    if (unitId && known.has(`unit:${unitId}`)) return false
    return Boolean(cardId || unitId)
  })
}

/** Inserted or completed retries finish the source. Pending is not in the queue yet. */
const SETTLED_SOURCE_OCCURRENCE_STATUSES = new Set(['inserted', 'completed'])

/**
 * Plan-only unfinished id (mirrors backend `next_unfinished_id`).
 * Do not pass an empty live `cards` array into `nextUnfinishedCardId` for this
 * check — that helper needs feed rows and returns null too eagerly.
 */
export function nextUnfinishedPlanCardId(
  plan: FreestyleRoundPlanPayload | null | undefined,
): string | null {
  if (!plan) return null
  const completed = new Set((plan.completed_ids || []).map(String))
  const excluded = new Set((plan.excluded_ids || []).map(String))
  const occurrences = plan.occurrences || []
  const isUnfinished = (cardId: string) => {
    if (!cardId || completed.has(cardId) || excluded.has(cardId)) return false
    const occ = occurrences.find((item) => String(item.occurrence_id || '') === cardId)
    if (occ) return String(occ.status || '') === 'inserted'
    return !occurrences.some((item) => (
      String(item.source_card_id || '') === cardId
      && SETTLED_SOURCE_OCCURRENCE_STATUSES.has(String(item.status || ''))
    ))
  }
  const ordered = [...(plan.presented_ids || []).map(String).filter(Boolean)]
  for (const item of plan.original_cards || []) {
    const cardId = String(item.card_id || '').trim()
    if (cardId && !ordered.includes(cardId)) ordered.push(cardId)
  }
  const seen = new Set<string>()
  for (const id of ordered) {
    if (seen.has(id)) continue
    seen.add(id)
    if (isUnfinished(id)) return id
  }
  return null
}

/** True when every presented/original identity is completed or excluded. */
export function planIsFullyHandled(
  plan: FreestyleRoundPlanPayload | null | undefined,
): boolean {
  if (!plan) return false
  if (!(plan.presented_ids || []).length && !(plan.original_cards || []).length) return false
  return nextUnfinishedPlanCardId(plan) == null
}

/**
 * Cold-start / rebuild prefer order for the card under the viewport.
 * Non-silent refresh must keep the local draft cursor when it still exists in
 * the feed; otherwise a stale server unfinished id yanks the learner to card 1.
 */
export function resolveResumePreferCardId(args: {
  preferCardId?: string | null
  silent?: boolean
  draftCardId?: string | null
  serverCurrentId?: string | null
  userCardId?: string | null
  nextCards: FreestyleCard[]
}): string | null {
  const inFeed = (value: string | null | undefined) => {
    const id = String(value || '').trim()
    if (!id) return null
    return args.nextCards.some((card) => card.id === id) ? id : null
  }
  if (args.preferCardId != null && String(args.preferCardId).trim()) {
    return inFeed(args.preferCardId) ?? String(args.preferCardId).trim()
  }
  if (args.silent) {
    return inFeed(args.userCardId)
      ?? inFeed(args.serverCurrentId)
      ?? inFeed(args.draftCardId)
  }
  return inFeed(args.draftCardId)
    ?? inFeed(args.serverCurrentId)
    ?? inFeed(args.userCardId)
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
    || cards.find((card) => (
      !isRetryOccurrence(card)
      && Boolean(cardUnitId(card))
      && cardUnitId(card) === reviewUnitIdFromCardId(current)
    ))
  if (current && !isFinishedCard(current, currentCard, completed, excluded, completedUnits)) {
    if (currentCard) return currentCard.id
  }
  for (const id of plan.presented_ids || []) {
    if (!id) continue
    const card = cards.find((item) => item.id === id)
      || cards.find((item) => (
        !isRetryOccurrence(item)
        && Boolean(cardUnitId(item))
        && cardUnitId(item) === reviewUnitIdFromCardId(id)
      ))
    if (!card || isFinishedCard(id, card, completed, excluded, completedUnits)) continue
    return card.id
  }
  return cards.find((card) => !isFinishedCard(card.id, card, completed, excluded, completedUnits))?.id ?? null
}

export function serverPlanVersion(round: Partial<Pick<FreestyleRoundStatePayload, 'plan_version' | 'version'>> | null | undefined) {
  if (!round) return 0
  const version = Number(round.plan_version ?? round.version)
  return Number.isInteger(version) && version > 0 ? version : 0
}

function asUnitRating(value: unknown): 1 | 2 | 3 | 4 | null {
  const rating = Math.round(Number(value))
  return rating === 1 || rating === 2 || rating === 3 || rating === 4 ? rating : null
}

/**
 * Fill local draft ratings from the server plan after refresh.
 * Keeps any richer local selectedRating; only fills gaps so cards do not look unanswered.
 */
export function mergeServerPlanIntoLocalEncounters(
  encounters: Record<string, FreestyleUnitEncounterState>,
  plan: FreestyleRoundPlanPayload | null | undefined,
  roundId: string,
): Record<string, FreestyleUnitEncounterState> {
  if (!plan) return encounters
  const next: Record<string, FreestyleUnitEncounterState> = { ...encounters }
  const writeGap = (
    cardId: string,
    patch: {
      encounterId?: string
      unitRevision?: number
      selectedRating?: 1 | 2 | 3 | 4 | null
      passed?: boolean | null
    },
  ) => {
    const id = String(cardId || '').trim()
    if (!id) return
    const existing = next[id]
    if (existing?.selectedRating != null) return
    const selectedRating = patch.selectedRating ?? existing?.selectedRating ?? null
    const passed = patch.passed ?? existing?.passed ?? (
      selectedRating == null ? null : selectedRating >= 3
    )
    next[id] = {
      encounterId: patch.encounterId || existing?.encounterId || id,
      roundId: existing?.roundId || roundId,
      unitRevision: patch.unitRevision ?? existing?.unitRevision ?? 0,
      status: selectedRating != null || passed != null ? 'closed' : (existing?.status ?? 'pending'),
      sessionId: existing?.sessionId ?? null,
      selectedRating,
      passed,
      retryAfterCards: existing?.retryAfterCards ?? 0,
      effectiveSeconds: existing?.effectiveSeconds ?? null,
    }
  }

  for (const occ of plan.occurrences || []) {
    const rating = asUnitRating(occ.rating)
    if (rating == null) continue
    const targets = [occ.occurrence_id, occ.source_card_id]
    for (const target of targets) {
      writeGap(String(target || ''), {
        encounterId: String(occ.encounter_id || '').trim() || undefined,
        selectedRating: rating,
        passed: rating >= 3,
      })
    }
  }

  for (const [cardId, enc] of Object.entries(plan.encounters || {})) {
    const status = String(enc?.status || '').trim()
    if (status !== 'passed' && status !== 'failed') continue
    writeGap(cardId, {
      encounterId: String(enc.encounter_id || '').trim() || undefined,
      unitRevision: Number(enc.unit_revision) || undefined,
      selectedRating: status === 'passed' ? 3 : 1,
      passed: status === 'passed',
    })
  }

  for (const cardId of plan.completed_ids || []) {
    writeGap(String(cardId || ''), {
      selectedRating: 3,
      passed: true,
    })
  }
  return next
}

/** Stamp occurrence ratings onto the HUD round plan without wiping local values. */
export function applyServerRatingsToRoundPlan(
  plan: FreestyleRoundPlanState,
  server: FreestyleRoundPlanPayload | null | undefined,
): FreestyleRoundPlanState {
  if (!server) return plan
  let next = plan
  const ratings = new Map<string, 1 | 2 | 3 | 4>()
  for (const occ of server.occurrences || []) {
    const rating = asUnitRating(occ.rating)
    if (rating == null) continue
    const occId = String(occ.occurrence_id || '').trim()
    const sourceId = String(occ.source_card_id || '').trim()
    if (occId) ratings.set(occId, rating)
    if (sourceId && !ratings.has(sourceId)) ratings.set(sourceId, rating)
  }
  for (const [cardId, enc] of Object.entries(server.encounters || {})) {
    if (ratings.has(cardId)) continue
    const status = String(enc?.status || '').trim()
    if (status === 'passed') ratings.set(cardId, 3)
    if (status === 'failed') ratings.set(cardId, 1)
  }
  for (const cardId of server.completed_ids || []) {
    const id = String(cardId || '').trim()
    if (id && !ratings.has(id)) ratings.set(id, 3)
  }
  for (const [cardId, rating] of ratings) {
    const current = next.cardsById[cardId]
    if (!current || current.lastRating != null) continue
    next = updateRoundPlanCard(next, cardId, { lastRating: rating })
  }
  return next
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
