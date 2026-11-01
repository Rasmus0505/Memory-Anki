import { useSyncExternalStore } from 'react'
import {
  readFreestyleOverlayWrongState,
  subscribeFreestyleOverlayWrongState,
} from './freestyleRoundWrongState'

function readWrongQuestionIds(): ReadonlySet<number> {
  return readFreestyleOverlayWrongState().wrongQuestionIds
}

/**
 * Read-only view of this round's wrong questions for other modules.
 *
 * `practice` owns the state; quiz and widgets only subscribe. Keeping the write
 * side private is what stops a second layer from clearing or replacing a round
 * the learner is still working in.
 */
export function useFreestyleRoundWrongQuestions(): ReadonlySet<number> {
  return useSyncExternalStore(
    subscribeFreestyleOverlayWrongState,
    readWrongQuestionIds,
    readWrongQuestionIds,
  )
}
