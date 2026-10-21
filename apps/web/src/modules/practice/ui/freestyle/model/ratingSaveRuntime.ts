import {
  closeUnitReviewEncounterApi,
  rateReviewUnitApi,
  undoReviewUnitRatingApi,
  type FreestyleUnitEncounterState,
} from '@/modules/practice/public'
import {
  clearFreestyleRatingIntentApi,
  listFreestyleRatingIntentsApi,
  putFreestyleRatingIntentApi,
  rateFreestyleRoundUnitApi,
  type FreestyleRatingIntentItem,
} from '@/modules/practice/ui/freestyle/api'
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
  type HydratedRatingIntent,
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
    persistIntent: (roundId, cardId, intent) => {
      if (!roundId) return Promise.resolve(null)
      rememberLocalIntent(roundId, cardId, { ...intent, card_id: cardId, confirmed: false })
      return putFreestyleRatingIntentApi(roundId, cardId, intent).then((result) => {
        rememberLocalIntent(roundId, cardId, { ...intent, card_id: cardId, confirmed: true })
        return result
      })
    },
    clearIntent: (roundId, cardId, operationId) => {
      if (!roundId) return Promise.resolve(null)
      forgetLocalIntent(roundId, cardId, operationId)
      return clearFreestyleRatingIntentApi(roundId, cardId, operationId)
    },
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
 * A 未保存 grade is written to this browser too, so a reload with the server
 * unreachable still shows it and can resend it. Keyed round -> card.
 */
const LOCAL_INTENTS_KEY = 'memory-anki:freestyle-rating-intents:v1'

type LocalRatingIntent = HydratedRatingIntent & { confirmed: boolean }
type LocalRatingIntentMap = Record<string, Record<string, LocalRatingIntent>>

function readLocalIntents(): LocalRatingIntentMap {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(LOCAL_INTENTS_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? (parsed as LocalRatingIntentMap) : {}
  } catch {
    return {}
  }
}

function writeLocalIntents(map: LocalRatingIntentMap) {
  try {
    window.localStorage.setItem(LOCAL_INTENTS_KEY, JSON.stringify(map))
  } catch {
    // Storage full or disabled: the server copy (if it landed) still holds the intent.
  }
}

function rememberLocalIntent(roundId: string, cardId: string, intent: HydratedRatingIntent & { confirmed: boolean }) {
  const map = readLocalIntents()
  map[roundId] = { ...(map[roundId] ?? {}), [cardId]: {
    card_id: cardId,
    operation_id: intent.operation_id,
    rating: intent.rating,
    failure: intent.failure,
    payload: intent.payload,
    confirmed: intent.confirmed,
  } }
  writeLocalIntents(map)
}

function forgetLocalIntent(roundId: string, cardId: string, operationId: string) {
  const map = readLocalIntents()
  const current = map[roundId]?.[cardId]
  if (!current || current.operation_id !== operationId) return
  delete map[roundId][cardId]
  if (Object.keys(map[roundId]).length === 0) delete map[roundId]
  writeLocalIntents(map)
}

function localIntentsOf(roundId: string): LocalRatingIntent[] {
  return Object.values(readLocalIntents()[roundId] ?? {})
}

/**
 * Pull the round's 未保存 grades from the server, upload any this browser holds that
 * the server never received, and show them in the store (retryable with their original
 * operation ids). If the server cannot be reached, the local mirror is shown instead.
 */
export async function syncRatingIntents(
  roundId: string,
  prepareFor: (cardId: string) => (() => Promise<RatingTarget>) | null,
) {
  if (!roundId) return
  const store = freestyleRatingSaves()
  let listed: FreestyleRatingIntentItem[]
  try {
    listed = (await listFreestyleRatingIntentsApi(roundId)).items
  } catch {
    store.hydrateIntents(roundId, localIntentsOf(roundId), prepareFor)
    return
  }
  const listedCards = new Set(listed.map((item) => item.card_id))
  const merged: HydratedRatingIntent[] = listed.map((item) => ({ ...item, confirmed: true }))
  for (const local of localIntentsOf(roundId)) {
    if (listedCards.has(local.card_id)) continue
    if (local.confirmed) {
      // The server had it and no longer does: the save landed or was cleared elsewhere.
      forgetLocalIntent(roundId, local.card_id, local.operation_id)
      continue
    }
    try {
      await putFreestyleRatingIntentApi(roundId, local.card_id, {
        operation_id: local.operation_id,
        rating: local.rating,
        failure: local.failure,
        payload: local.payload,
      })
      rememberLocalIntent(roundId, local.card_id, { ...local, confirmed: true })
      merged.push({ ...local, confirmed: true })
    } catch {
      merged.push(local)
    }
  }
  store.hydrateIntents(roundId, merged, prepareFor)
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
