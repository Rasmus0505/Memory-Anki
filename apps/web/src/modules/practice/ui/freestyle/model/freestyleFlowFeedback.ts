import type { UnitRating } from '@/modules/practice/public'
import type { FeedbackEvent } from '@/shared/feedback/feedbackEvents'

/**
 * Freestyle feedback vocabulary, built on the feedback论 in Csikszentmihalyi's
 * 《心流》 rather than on reward mechanics.
 *
 * The book's claims that actually constrain this file:
 *
 * - Feedback must be immediate. A tennis player knows where the ball went at once;
 *   the delay is what breaks the merging of action and awareness. Freestyle used to
 *   answer a rate with silence, so every action needed an act of interpretation.
 * - The *form* of feedback is irrelevant as long as it is logically related to the
 *   goal you invested attention in. A surgeon reads "no bleeding". So we do not need
 *   score symbols — a tone that means "recorded" is complete feedback.
 * - Feedback must remove the question "how am I doing" *without being read*. Text is
 *   the wrong channel: reading is reflection, and reflection is an exit from flow.
 * - Flow includes the absence of worry about failure. So a weak rating must land as
 *   information, never as a loss signal. There is deliberately no streak to break.
 * - Attention is finite psychic energy. Feedback that takes focus costs more than it
 *   returns, so nothing here goes to screen center or interrupts.
 */

/** Where the confirmation is drawn. Never screen-center: that is focus, not periphery. */
export type FlowBreath = 'affirm' | 'note' | null

export interface FlowFeedbackSignal {
  /** Audio is the primary immediate channel — it costs no visual attention at all. */
  audioEvent: FeedbackEvent
  /** A single edge breath on the card the learner is already looking at. */
  breath: FlowBreath
}

/**
 * Reveal (flip) is the highest-frequency action in freestyle and was fully silent,
 * while formal review has played a tone per reveal all along. This is the single
 * biggest immediacy gap, and it is audio-only: the card visibly changing *is* the
 * visual feedback, so adding a glow would be a second signal for one event.
 */
export const FLOW_REVEAL_SIGNAL: FlowFeedbackSignal = {
  audioEvent: 'card_reveal',
  breath: null,
}

/**
 * Rating tones are chosen to mean "recorded", not "scored".
 *
 * `记得`/`轻松` use `field_commit` — the app's existing "committed" tone. `困难`/`忘记`
 * deliberately do NOT use `quiz_result_incorrect`: that is a miss sound, and a miss
 * sound here would manufacture exactly the failure-anxiety the book names as an exit.
 * They use `node_select`, a quiet neutral acknowledgement, because in spaced
 * repetition an honest `忘记` is a correct and useful move, not an error.
 */
export function flowRatingSignal(rating: UnitRating, passed: boolean): FlowFeedbackSignal {
  if (passed) {
    return { audioEvent: 'field_commit', breath: 'affirm' }
  }
  // rating is retained in the signature so a future per-rating tone split has a
  // seam, and so callers cannot pass a rating that silently does not matter.
  void rating
  return { audioEvent: 'node_select', breath: 'note' }
}

/**
 * Quiz cards already emit their own correct/incorrect feedback through the shared
 * quiz path, so freestyle must not double-signal them. Exported so the page can
 * state that exclusion explicitly rather than leaving it implicit.
 */
/**
 * Clearing a palace is a chapter beat, not a per-card score. `all_clear_ready`
 * is already the review-scene "this stretch is done" tone — distinct from
 * `field_commit` — and must be played locally. Do not route it through
 * `dispatchGlobalFeedback`: that lands mid-map and can fire confetti.
 */
export const FLOW_PALACE_CLEARED_SIGNAL: FlowFeedbackSignal = {
  audioEvent: 'all_clear_ready',
  breath: 'affirm',
}

export const FLOW_QUIZ_HANDLED_ELSEWHERE = true

export const FLOW_BREATH_CLASS: Record<Exclude<FlowBreath, null>, string> = {
  affirm: 'memory-anki-freestyle-breath-affirm',
  note: 'memory-anki-freestyle-breath-note',
}

/** Long enough to register in the periphery, short enough to never wait on it. */
export const FLOW_BREATH_MS = 520
