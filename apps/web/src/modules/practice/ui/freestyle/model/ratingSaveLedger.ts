import type { FreestyleUnitEncounterState, UnitRating } from '@/modules/practice/public'
import type { FreestyleRoundStatePayload } from '@/shared/api/contracts'
import {
  ratingPassed,
  type RatingSaveEvent,
} from '@/modules/practice/ui/freestyle/model/ratingSaveStore'

/**
 * Applies rating-outbox events to the round ledger (queue encounters, round
 * plan, completion). Framework-free; the page wires the handlers. This is the
 * only place an acknowledged rating changes progress, so it works the same
 * whether the card is on screen, scrolled away, or never mounted (本轮安排).
 */
export interface RatingLedgerHandlers {
  /** Current round. Events of any other round only touch the outbox entry. */
  roundId: string
  previousEncounter: (cardId: string) => FreestyleUnitEncounterState | undefined
  adoptRound: (round: FreestyleRoundStatePayload) => void
  encounterChange: (cardId: string, encounter: FreestyleUnitEncounterState) => void
  branchComplete: (
    cardId: string,
    options: { restudy?: boolean; cleared?: boolean; rating?: number; retryAfterCards?: number },
  ) => void
  ratingSettled?: (
    cardId: string,
    passed: boolean,
    rating: UnitRating,
    meta: { occurrenceId?: string; encounterId?: string; planVersion?: number },
  ) => void
  saveFailed?: (event: Extract<RatingSaveEvent, { type: 'failed' | 'undoFailed' }>) => void
  staleDrop?: (cardId: string, error: unknown) => void
}

function asRating(value: unknown): UnitRating | null {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : null
}

/** Queue encounter after an acknowledged rating. A replay (`item: null`) is rebuilt from the request. */
export function ackedEncounterState(
  event: Extract<RatingSaveEvent, { type: 'acked' }>,
  previous: FreestyleUnitEncounterState | undefined,
): FreestyleUnitEncounterState {
  const { item, target, job } = event
  const rating = asRating(item?.rating) ?? job.rating
  const encounter = item?.encounter
  return {
    // The glance the request named. A retry occurrence keeps its own encounter id.
    encounterId: target.encounterId,
    roundId: encounter?.round_id || previous?.roundId || job.roundId,
    unitRevision: item?.unit?.revision ?? target.unitRevision,
    status: encounter && encounter.id === target.encounterId ? encounter.status : 'open',
    sessionId: item?.study_session_id || target.sessionId || previous?.sessionId || null,
    selectedRating: rating,
    passed: item?.passed ?? ratingPassed(rating),
    retryAfterCards: item?.retry_after_cards ?? previous?.retryAfterCards ?? 0,
  }
}

export function applyRatingSaveEvent(event: RatingSaveEvent, handlers: RatingLedgerHandlers) {
  if (!handlers.roundId || event.roundId !== handlers.roundId) return
  switch (event.type) {
    case 'round':
      handlers.adoptRound(event.round)
      return
    case 'acked': {
      if (event.round) handlers.adoptRound(event.round)
      const previous = handlers.previousEncounter(event.cardId)
      const next = ackedEncounterState(event, previous)
      handlers.encounterChange(event.cardId, next)
      const changed = previous?.selectedRating !== next.selectedRating
        || previous?.passed !== next.passed
        || previous?.retryAfterCards !== next.retryAfterCards
      if (changed) {
        handlers.branchComplete(event.cardId, {
          restudy: next.passed !== true,
          rating: next.selectedRating ?? undefined,
          retryAfterCards: event.item ? next.retryAfterCards : undefined,
        })
      }
      const settled = asRating(next.selectedRating)
      if (event.current && settled != null) {
        handlers.ratingSettled?.(event.cardId, next.passed === true, settled, {
          occurrenceId: event.job.occurrenceId || event.cardId,
          encounterId: event.target.encounterId,
          planVersion: Number(event.round?.plan_version ?? event.round?.version ?? 0) || undefined,
        })
      }
      return
    }
    case 'undone': {
      const previous = handlers.previousEncounter(event.cardId)
      const encounter = event.result.encounter
      const rating = asRating(encounter.selected_rating)
      handlers.encounterChange(event.cardId, {
        encounterId: encounter.id,
        roundId: encounter.round_id || previous?.roundId || event.roundId,
        unitRevision: event.result.unit?.revision ?? previous?.unitRevision ?? 0,
        status: encounter.status,
        sessionId: previous?.sessionId ?? null,
        selectedRating: rating,
        passed: encounter.passed,
        retryAfterCards: encounter.retry_after_cards,
      })
      handlers.branchComplete(
        event.cardId,
        rating == null
          ? { cleared: true }
          : { restudy: !encounter.passed, rating, retryAfterCards: encounter.retry_after_cards },
      )
      return
    }
    case 'failed':
      if (!event.current) return
      if (event.failure === 'stale') handlers.staleDrop?.(event.cardId, event.error)
      handlers.saveFailed?.(event)
      return
    case 'undoFailed':
      handlers.saveFailed?.(event)
  }
}
