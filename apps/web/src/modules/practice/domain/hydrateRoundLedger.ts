import type { FreestyleCard, FreestyleFeedConfig, FreestyleRoundPlanPayload } from '@/shared/api/contracts'

import {
  createRoundPlan,
  excludeRoundPlanCards,
  mergeRetainedHiddenIds,
  syncCompletedIdsToRoundPlan,
  updateRoundPlanCard,
  type FreestyleRoundMeta,
  type FreestyleRoundPlanCard,
  type FreestyleRoundPlanState,
} from './roundPlan'
import { compressRoundPlanCards } from './roundPlanCompress'
import type { FreestyleUnitEncounterState } from './queueState'
import {
  applyServerCohorts,
  applyServerRatingsToRoundPlan,
  mergeServerPlanIntoLocalEncounters,
  retainLocalRoundLedger,
  type RetainedRoundLedger,
} from './serverRoundPlan'

export type HydratedRoundLedger = RetainedRoundLedger & { hiddenIds: string[] }

export type HydrationLedgerSnapshot = {
  plan: FreestyleRoundPlanState | null
  completedIds: readonly string[]
  hiddenIds: readonly string[]
  encounters: Record<string, FreestyleUnitEncounterState>
}

function planKeptCount(plan: FreestyleRoundPlanState | null): number {
  if (!plan) return 0
  let count = 0
  for (const card of Object.values(plan.cardsById)) {
    if (
      card.status === 'excluded'
      || card.status === 'completed'
      || card.status === 'retry'
      || card.lastRating != null
    ) count += 1
  }
  return count
}

function stampCapturedExclusion(
  plan: FreestyleRoundPlanState,
  card: FreestyleRoundPlanCard,
): FreestyleRoundPlanState {
  if (plan.cardsById[card.cardId]?.status === 'excluded') return plan
  if (plan.cardsById[card.cardId]) {
    return updateRoundPlanCard(plan, card.cardId, { status: 'excluded' })
  }
  const orderIds = plan.orderIds.includes(card.cardId)
    ? plan.orderIds
    : [...plan.orderIds, card.cardId]
  return {
    ...plan,
    orderIds,
    cardsById: {
      ...plan.cardsById,
      [card.cardId]: { ...card, status: 'excluded' },
    },
  }
}

/**
 * Pick the ledger a silent rebuild must hydrate from.
 * A render can copy an older React snapshot back over the ref while the queue
 * request is in flight, and a mismatched round id can publish an all-pending
 * plan. Either one drops a just-confirmed 移除队列 and this-round scores.
 * An in-flight restore (`releasedIds`) stays released.
 */
export function coalesceHydrationLedger(
  captured: HydrationLedgerSnapshot,
  live: HydrationLedgerSnapshot,
  releasedIds: readonly string[] = [],
): HydrationLedgerSnapshot {
  const released = new Set(releasedIds.map((id) => String(id || '').trim()).filter(Boolean))
  const capturedKept = planKeptCount(captured.plan)
  const liveKept = planKeptCount(live.plan)
  const roundChanged = Boolean(
    captured.plan && live.plan && live.plan.roundId !== captured.plan.roundId,
  )
  const liveWiped = capturedKept > 0 && liveKept === 0 && (!live.plan || roundChanged)
  const base: HydrationLedgerSnapshot = liveWiped
    ? {
        plan: captured.plan,
        completedIds: [...captured.completedIds],
        hiddenIds: [...captured.hiddenIds],
        encounters: captured.encounters,
      }
    : {
        plan: live.plan,
        completedIds: [...live.completedIds],
        hiddenIds: [...live.hiddenIds],
        encounters: live.encounters,
      }
  if (!captured.plan || !base.plan) return base
  let plan = base.plan
  const hidden = [...base.hiddenIds]
  for (const card of Object.values(captured.plan.cardsById)) {
    if (card.status !== 'excluded' || released.has(card.cardId)) continue
    plan = stampCapturedExclusion(plan, card)
    if (!hidden.includes(card.cardId)) hidden.push(card.cardId)
  }
  return { ...base, plan, hiddenIds: hidden }
}

function calendarDay(value: string | null | undefined): string {
  const text = String(value || '').trim()
  return text.length >= 10 && text[4] === '-' && text[7] === '-' ? text.slice(0, 10) : ''
}

/**
 * A new calendar day can put a finished card back into today's queue.
 * Yesterday's local score must not be merged back over that reopen.
 * Same-day hydration still keeps a score the server snapshot has not received.
 */
function dropReopenedLocalFacts(
  localPlan: FreestyleRoundPlanState | null,
  localCompletedIds: readonly string[],
  localEncounters: Record<string, FreestyleUnitEncounterState>,
  serverPlan: FreestyleRoundPlanPayload | null | undefined,
): {
  localPlan: FreestyleRoundPlanState | null
  localCompletedIds: readonly string[]
  localEncounters: Record<string, FreestyleUnitEncounterState>
  reopenedIds: ReadonlySet<string>
} {
  const localDay = calendarDay(localPlan?.today)
  const serverDay = calendarDay(serverPlan?.today)
  const empty = new Set<string>()
  if (!localPlan || !localDay || !serverDay || localDay >= serverDay) {
    return { localPlan, localCompletedIds, localEncounters, reopenedIds: empty }
  }
  const stillHeld = new Set(
    [
      ...(serverPlan?.completed_ids || []),
      ...(serverPlan?.compressed_ids || []),
      ...(serverPlan?.excluded_ids || []),
    ].map((id) => String(id || '').trim()).filter(Boolean),
  )
  const reopened = new Set<string>()
  for (const raw of localPlan.compressedIds ?? []) {
    const cardId = String(raw || '').trim()
    if (cardId && !stillHeld.has(cardId)) reopened.add(cardId)
  }
  for (const card of Object.values(localPlan.cardsById)) {
    if (card.status === 'excluded' || stillHeld.has(card.cardId)) continue
    if (card.status === 'completed' || card.status === 'retry' || card.lastRating != null) {
      reopened.add(card.cardId)
    }
  }
  for (const raw of localCompletedIds) {
    const cardId = String(raw || '').trim()
    if (cardId && !stillHeld.has(cardId)) reopened.add(cardId)
  }
  if (reopened.size === 0) {
    return { localPlan, localCompletedIds, localEncounters, reopenedIds: empty }
  }
  const cardsById = { ...localPlan.cardsById }
  for (const id of reopened) {
    const card = cardsById[id]
    if (!card || card.status === 'excluded') continue
    cardsById[id] = { ...card, status: 'pending', lastRating: null }
  }
  const nextEncounters = { ...localEncounters }
  for (const id of reopened) delete nextEncounters[id]
  return {
    localPlan: {
      ...localPlan,
      today: serverDay,
      cardsById,
      compressedIds: (localPlan.compressedIds ?? []).filter((id) => !reopened.has(id)),
    },
    localCompletedIds: localCompletedIds.filter((id) => !reopened.has(String(id || '').trim())),
    localEncounters: nextEncounters,
    reopenedIds: reopened,
  }
}

function restoredIdsReleasedByServer(
  server: FreestyleRoundPlanPayload | null | undefined,
  blocked: ReadonlySet<string>,
): string[] {
  const held = new Set(
    [
      ...(server?.completed_ids || []),
      ...(server?.compressed_ids || []),
      ...(server?.excluded_ids || []),
    ].map((id) => String(id || '').trim()).filter(Boolean),
  )
  const seen = new Set<string>()
  const ids: string[] = []
  for (const raw of server?.restored_ids ?? []) {
    const id = String(raw || '').trim()
    if (!id || seen.has(id) || held.has(id) || blocked.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function dropMarkedLocalFacts(
  localPlan: FreestyleRoundPlanState | null,
  localCompletedIds: readonly string[],
  localEncounters: Record<string, FreestyleUnitEncounterState>,
  marked: ReadonlySet<string>,
): {
  localPlan: FreestyleRoundPlanState | null
  localCompletedIds: readonly string[]
  localEncounters: Record<string, FreestyleUnitEncounterState>
} {
  const completed = localCompletedIds.filter((id) => !marked.has(String(id || '').trim()))
  if (!localPlan || marked.size === 0) {
    return { localPlan, localCompletedIds: completed, localEncounters }
  }
  const cardsById = { ...localPlan.cardsById }
  for (const id of marked) {
    const card = cardsById[id]
    if (!card) continue
    cardsById[id] = { ...card, status: 'pending', lastRating: null }
  }
  const nextEncounters = { ...localEncounters }
  for (const id of marked) delete nextEncounters[id]
  return {
    localPlan: {
      ...localPlan,
      cardsById,
      compressedIds: (localPlan.compressedIds ?? []).filter((id) => !marked.has(id)),
    },
    localCompletedIds: completed,
    localEncounters: nextEncounters,
  }
}

function applyServerExcludedIds(
  plan: FreestyleRoundPlanState,
  server: FreestyleRoundPlanPayload | null | undefined,
): FreestyleRoundPlanState {
  const ids = (server?.excluded_ids || []).map((id) => String(id || '').trim()).filter(Boolean)
  if (!ids.length) return plan
  let next = plan
  for (const id of ids) {
    if (next.cardsById[id]) {
      if (next.cardsById[id].status !== 'excluded') {
        next = updateRoundPlanCard(next, id, { status: 'excluded' })
      }
      continue
    }
    const original = (server?.original_cards || []).find((item) => String(item.card_id || '') === id)
    const presented = (server?.presented_ids || []).map((item) => String(item || ''))
    const at = presented.indexOf(id)
    const entry: FreestyleRoundPlanCard = {
      cardId: id,
      sourceCardId: id,
      occurrenceKind: 'source',
      retryAttempt: 0,
      palaceId: original?.palace_id ?? null,
      palaceTitle: original?.palace_title || '',
      label: original?.label || id,
      kind: original?.kind || 'mindmap_branch',
      status: 'excluded',
      lastRating: null,
      retryAfterCards: 0,
      attemptCount: 0,
      updatedAt: 0,
      ...(original?.entered_on ? { enteredOn: original.entered_on } : {}),
    }
    const orderIds = [...next.orderIds]
    if (!orderIds.includes(id)) {
      orderIds.splice(at < 0 ? orderIds.length : Math.min(at, orderIds.length), 0, id)
    }
    next = { ...next, orderIds, cardsById: { ...next.cardsById, [id]: entry } }
  }
  return next
}

/**
 * Hydrate a server round onto the local ledger.
 * `localPlan` must be the ledger from after the network await — never a draft
 * `createRoundPlan` that was persisted because the round id changed. That draft
 * is all-pending and retain would treat the real scores as cancelled.
 */
export function commitHydratedRoundLedger(input: {
  localPlan: FreestyleRoundPlanState | null
  localCompletedIds: readonly string[]
  localHiddenIds: readonly string[]
  localEncounters: Record<string, FreestyleUnitEncounterState>
  releasedIds?: readonly string[]
  adoptedRoundId: string
  cards: FreestyleCard[]
  config: FreestyleFeedConfig
  meta?: Partial<FreestyleRoundMeta>
  serverPlan: FreestyleRoundPlanPayload | null | undefined
  /** Ids the learner just confirmed 移除队列. Survive a wiped or stale ledger. */
  forceExcludedIds?: readonly string[]
  /** Ids just compressed out of the working set. Survive a silent rebuild. */
  forceCompressedIds?: readonly string[]
  /**
   * Replace the local ledger with the server plan. 同步进度 uses this so a
   * phone draft cannot keep scores the computer's round does not have.
   */
  adoptServerLedger?: boolean
}): HydratedRoundLedger {
  const adopt = input.adoptServerLedger === true
  const releasedIncoming = (input.releasedIds ?? [])
    .map((id) => String(id || '').trim())
    .filter(Boolean)
  const forceExcludedIds = (input.forceExcludedIds ?? [])
    .map((id) => String(id || '').trim())
    .filter((id) => id && !releasedIncoming.includes(id))
  const forceCompressedIds = (input.forceCompressedIds ?? [])
    .map((id) => String(id || '').trim())
    .filter(Boolean)
  const restoredIds = restoredIdsReleasedByServer(
    input.serverPlan,
    new Set([...forceExcludedIds, ...forceCompressedIds]),
  )
  const restored = new Set(restoredIds)
  const stripped = dropReopenedLocalFacts(
    adopt ? null : input.localPlan,
    adopt ? [] : input.localCompletedIds,
    adopt ? {} : input.localEncounters,
    input.serverPlan,
  )
  const marked = dropMarkedLocalFacts(
    stripped.localPlan,
    stripped.localCompletedIds,
    stripped.localEncounters,
    restored,
  )
  const localPlan = marked.localPlan
  const localCompletedIds = marked.localCompletedIds
  const localHiddenIds = (adopt ? [] : input.localHiddenIds)
    .map((id) => String(id || '').trim())
    .filter((id) => id && !restored.has(id))
  const localEncounters = marked.localEncounters
  const serverPlan = input.serverPlan
  const serverCompleted = (Array.isArray(serverPlan?.completed_ids)
    ? serverPlan.completed_ids.map(String)
    : (adopt ? [] : [...localCompletedIds])
  ).filter((id) => !restored.has(String(id || '').trim()))
  const serverExcluded = Array.isArray(serverPlan?.excluded_ids)
    ? serverPlan.excluded_ids.map(String)
    : []
  const hydratedPlan = applyServerExcludedIds(
    applyServerRatingsToRoundPlan(
      applyServerCohorts(
        syncCompletedIdsToRoundPlan(
          createRoundPlan(
            input.adoptedRoundId,
            input.cards,
            input.config,
            input.meta,
            localPlan,
          ),
          serverCompleted,
        ),
        serverPlan,
      ),
      serverPlan,
    ),
    serverPlan,
  )
  const retained = retainLocalRoundLedger({
    localPlan,
    localCompletedIds,
    localEncounters,
    hydratedPlan,
    hydratedCompletedIds: serverCompleted,
    hydratedEncounters: mergeServerPlanIntoLocalEncounters(
      localEncounters,
      serverPlan,
      input.adoptedRoundId,
    ),
  })
  const releasedIds = [...releasedIncoming, ...restoredIds]
  const planForForce = retained.plan
    ?? (forceExcludedIds.length
      ? createRoundPlan(input.adoptedRoundId, input.cards, input.config, input.meta, null)
      : null)
  const forced = excludeRoundPlanCards(planForForce, forceExcludedIds, input.cards) ?? planForForce
  const serverCompressed = Array.isArray(serverPlan?.compressed_ids)
    ? serverPlan.compressed_ids.map(String)
    : []
  const compressedIds = [...new Set([
    ...(forced?.compressedIds ?? []),
    ...serverCompressed,
    ...forceCompressedIds.filter((id) => !stripped.reopenedIds.has(id) && !restored.has(id)),
  ])]
  const compressed = compressRoundPlanCards(forced, compressedIds) ?? forced
  return {
    ...retained,
    plan: compressed,
    hiddenIds: mergeRetainedHiddenIds(
      localHiddenIds,
      compressed,
      serverExcluded,
      releasedIds,
    ),
  }
}
