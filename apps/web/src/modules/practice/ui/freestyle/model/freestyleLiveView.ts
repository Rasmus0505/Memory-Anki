import type { QuizRuntimeState } from '@/modules/quiz/public'

export interface FreestyleAnkiFlipLiveState {
  cardId: string
  flipped: boolean
  revealedBacks: string[]
  focusUid: string | null
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
  }
}

export function serializeFreestyleLiveView(view: FreestyleLiveView) {
  return JSON.stringify(view)
}
