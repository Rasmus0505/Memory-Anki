import {
  closeUnitReviewEncounterApi,
  rateReviewUnitApi,
  undoReviewUnitRatingApi,
  type FreestyleUnitEncounterState,
} from '@/modules/practice/public'
import { rateFreestyleRoundUnitApi } from '@/modules/practice/ui/freestyle/api'
import type { FreestyleReviewUnitCard } from '@/shared/api/contracts'
import {
  findSuccessorUnit,
  isStaleUnitError,
} from '@/modules/practice/ui/freestyle/model/freestyleStaleRecovery'
import {
  loadSessionWithTimeout,
  operationId,
} from '@/modules/practice/ui/freestyle/model/freestyleUnitReviewSession'
import {
  RATING_SAVE_TIMEOUT_MS,
  RatingSaveStore,
  type RatingTarget,
} from '@/modules/practice/ui/freestyle/model/ratingSaveStore'

/**
 * The one rating outbox of this window. It outlives cards, the immersive page
 * and route changes, so a save that is on the wire still completes and its
 * result is waiting when the learner comes back.
 */
let store: RatingSaveStore | null = null

function createStore() {
  return new RatingSaveStore({
    post: async (roundId, payload) => {
      if (roundId) return rateFreestyleRoundUnitApi(roundId, payload)
      // No round yet: the plain unit write still records the score.
      const item = await rateReviewUnitApi(
        payload.study_session_id,
        { id: payload.unit_id, revision: payload.unit_revision },
        payload.encounter_id,
        payload.rating as 1 | 2 | 3 | 4,
        payload.operation_id,
      )
      return { item, round: null }
    },
    undo: (id, roundId) => undoReviewUnitRatingApi(id, roundId || undefined),
    close: (target, job) => closeUnitReviewEncounterApi(
      target.sessionId,
      target.unitId,
      target.encounterId,
      operationId(),
      job.roundId || undefined,
    ),
    isStaleError: isStaleUnitError,
    newOperationId: operationId,
    setTimer: (callback, ms) => window.setTimeout(callback, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
    timeoutMs: RATING_SAVE_TIMEOUT_MS,
  })
}

export function freestyleRatingSaves(): RatingSaveStore {
  if (!store) store = createStore()
  return store
}

export function resetFreestyleRatingSavesForTests() {
  store = null
}

/**
 * Identity for rating a card that has no open glance on screen: open one through
 * the same unit-session start the card uses (`POST /review/units/{id}/sessions`).
 */
export async function prepareRatingTarget(
  card: FreestyleReviewUnitCard,
  encounter: FreestyleUnitEncounterState,
  roundId: string,
): Promise<RatingTarget> {
  const session = await loadSessionWithTimeout(card, encounter, roundId)
  const unit = session.units.find((item) => item.id === card.unit_id)
    ?? findSuccessorUnit(session.units, card.unit_id, card.anchor_uid)
  if (!unit?.encounter) throw new Error('review unit not found')
  return {
    encounterId: unit.encounter.id,
    unitId: unit.id,
    sessionId: session.id,
    unitRevision: unit.revision,
  }
}
