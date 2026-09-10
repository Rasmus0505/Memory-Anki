import type { QuizRuntimeState } from '@/modules/quiz/public'

export interface FreestyleAnkiFlipLiveState {
  cardId: string
  flipped: boolean
  revealedBacks: string[]
  focusUid: string | null
}

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

export interface FreestyleLiveView {
  palaceId: number | null
  currentCardId: string | null
  currentIndex: number
  queueCardIds: string[]
  flip: FreestyleAnkiFlipLiveState | null
  questionState: { questionId: number; state: QuizRuntimeState } | null
  revealMap: Record<string, string> | null
  roundComplete: boolean
  rating: FreestyleLiveRating | null
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
  const flipRaw = record.flip && typeof record.flip === 'object' ? record.flip as Record<string, unknown> : null
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
    flip: flipRaw && typeof flipRaw.cardId === 'string'
      ? {
          cardId: flipRaw.cardId,
          flipped: flipRaw.flipped === true,
          revealedBacks: Array.isArray(flipRaw.revealedBacks)
            ? flipRaw.revealedBacks.filter((id): id is string => typeof id === 'string')
            : [],
          focusUid: typeof flipRaw.focusUid === 'string' ? flipRaw.focusUid : null,
        }
      : null,
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

export function isWeakerLiveRating(
  local: FreestyleLiveRating | null | undefined,
  remote: FreestyleLiveRating | null | undefined,
) {
  if (!remote?.selectedRating) return false
  if (!local?.selectedRating) return true
  if (remote.settled.length > 0 && local.settled.length === 0) return true
  return false
}

export function serializeFreestyleLiveView(view: FreestyleLiveView) {
  return JSON.stringify(view)
}
