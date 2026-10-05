import type { QuizRuntimeState } from '@/modules/quiz/public'

export interface FreestyleLiveRatingSettle {
  cardId: string
  rating: number
  passed: boolean
  restudy: boolean
  retryAfterCards: number
}

export interface FreestyleLiveRating {
  planVersion: number
  currentCardId: string | null
  selectedRating: number
  passed: boolean
  settled: FreestyleLiveRatingSettle[]
}

export interface FreestyleLiveViewport {
  currentCardId: string | null
  visualIndex: number
  viewingCompleteSlot: boolean
  roundId: string
  planVersion: number
}

export interface FreestyleLiveView {
  palaceId: number | null
  currentCardId: string | null
  currentIndex: number
  queueCardIds: string[]
  questionState: { questionId: number; state: QuizRuntimeState } | null
  revealMap: Record<string, string> | null
  roundComplete: boolean
  rating: FreestyleLiveRating | null
  visualIndex: number
  viewingCompleteSlot: boolean
  roundId: string
  planVersion: number
}

export function encodeFreestyleLiveView(view: FreestyleLiveView): FreestyleLiveView {
  return view
}

export function decodeFreestyleLiveView(raw: unknown): FreestyleLiveView | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const currentCardId = typeof record.currentCardId === 'string' ? record.currentCardId : null
  const currentIndex = typeof record.currentIndex === 'number' && Number.isFinite(record.currentIndex)
    ? record.currentIndex
    : 0
  const queueCardIds = Array.isArray(record.queueCardIds)
    ? record.queueCardIds.filter((id): id is string => typeof id === 'string')
    : []
  const questionRaw = record.questionState && typeof record.questionState === 'object'
    ? record.questionState as Record<string, unknown>
    : null
  const revealRaw = record.revealMap && typeof record.revealMap === 'object' && !Array.isArray(record.revealMap)
    ? record.revealMap as Record<string, unknown>
    : null
  return {
    palaceId: typeof record.palaceId === 'number' ? record.palaceId : null,
    currentCardId,
    currentIndex,
    queueCardIds,
    visualIndex: typeof record.visualIndex === 'number' && Number.isFinite(record.visualIndex)
      ? record.visualIndex
      : currentIndex,
    viewingCompleteSlot: record.viewingCompleteSlot === true,
    roundId: typeof record.roundId === 'string' ? record.roundId : '',
    planVersion: typeof record.planVersion === 'number' && Number.isFinite(record.planVersion)
      ? record.planVersion
      : 0,
    questionState: questionRaw && typeof questionRaw.questionId === 'number'
      ? {
          questionId: questionRaw.questionId,
          state: (questionRaw.state && typeof questionRaw.state === 'object'
            ? questionRaw.state
            : {}) as QuizRuntimeState,
        }
      : null,
    revealMap: revealRaw
      ? Object.fromEntries(
          Object.entries(revealRaw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        )
      : null,
    roundComplete: record.roundComplete === true,
    rating: decodeFreestyleLiveRating(record.rating),
  }
}

function decodeFreestyleLiveRatingSettle(raw: unknown): FreestyleLiveRatingSettle | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const cardId = typeof record.cardId === 'string' ? record.cardId : ''
  const rating = typeof record.rating === 'number' && Number.isInteger(record.rating) ? record.rating : 0
  if (!cardId || rating < 1 || rating > 4) return null
  return {
    cardId,
    rating,
    passed: record.passed === true,
    restudy: record.restudy === true,
    retryAfterCards: typeof record.retryAfterCards === 'number' && Number.isFinite(record.retryAfterCards)
      ? Math.max(0, record.retryAfterCards)
      : 0,
  }
}

export function decodeFreestyleLiveRating(raw: unknown): FreestyleLiveRating | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const selectedRating = typeof record.selectedRating === 'number' && Number.isInteger(record.selectedRating)
    ? record.selectedRating
    : 0
  if (selectedRating < 1 || selectedRating > 4) return null
  const settled = Array.isArray(record.settled)
    ? record.settled.flatMap((item) => {
        const decoded = decodeFreestyleLiveRatingSettle(item)
        return decoded ? [decoded] : []
      })
    : []
  return {
    planVersion: typeof record.planVersion === 'number' && Number.isFinite(record.planVersion)
      ? record.planVersion
      : 0,
    currentCardId: typeof record.currentCardId === 'string' ? record.currentCardId : null,
    selectedRating,
    passed: record.passed === true,
    settled,
  }
}

/** True when the remote rating is newer and should replace the local one.

Equal versions with a different payload are an unresolved race. They do not
replace either side, so two devices cannot flap the same score.
*/
export function isWeakerLiveRating(
  local: FreestyleLiveRating | null | undefined,
  remote: FreestyleLiveRating | null | undefined,
) {
  if (!remote?.selectedRating) return false
  if (!local?.selectedRating) return true
  if (remote.planVersion !== local.planVersion) return remote.planVersion > local.planVersion
  return remote.settled.length > local.settled.length
}

/**
 * True only when the remote rating is definitely newer. Equal-version payload
 * differences are an unresolved last-writer race, so they must not suppress a
 * local publish forever.
 */
export function isStrictlyWeakerLiveRating(
  local: FreestyleLiveRating | null | undefined,
  remote: FreestyleLiveRating | null | undefined,
) {
  if (!remote?.selectedRating) return false
  if (!local?.selectedRating) return true
  return remote.planVersion > local.planVersion
}

/** A rating can only be adopted after every settled card exists in the queue. */
export function isApplicableLiveRating(
  rating: FreestyleLiveRating,
  queueCardIds: string[],
) {
  const available = new Set(queueCardIds)
  if (rating.currentCardId && !available.has(rating.currentCardId)) return false
  return rating.settled.every((settle) => available.has(settle.cardId))
}

export function serializeFreestyleLiveView(view: FreestyleLiveView) {
  return JSON.stringify(view)
}
