import type { UnitRating } from '@/modules/practice/public'
import type { FeedbackEvent } from '@/shared/feedback/feedbackEvents'

/**
 * Freestyle feedback vocabulary, built on Csikszentmihalyi's 《心流》 feedback rules
 * plus a light game layer.
 *
 * - Feedback must be immediate and must not need reading: tone, haptic and a short
 *   card gesture answer "recorded" before the learner thinks about it.
 * - Each grade has its own voice so the ear learns the scale, but a weak rating is
 *   information, never a loss signal: no miss sound, no shake of shame.
 * - Streaks are allowed and celebrated at milestones, but never punished: 忘记 just
 *   lets the combo fade quietly back to zero.
 * - Per-card feedback stays on the card and the rating bar. Screen-center
 *   celebration is reserved for round completion.
 */

/** Where the confirmation is drawn: on the card edge, never screen-center. */
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

/** Card gesture played on the rated card; the card springs back to rest afterwards. */
export type FlowRatingReaction = 'sink' | 'wobble' | 'lift' | 'fling'

export type FlowHaptic = 'soft-fail' | 'select' | 'success'

export interface FlowRatingSignal extends FlowFeedbackSignal {
  reaction: FlowRatingReaction
  haptic: FlowHaptic
  /** Whether this grade keeps the combo alive. */
  keepsCombo: boolean
}

/**
 * One voice per grade, rising with confidence. 忘记/困难 deliberately avoid
 * `quiz_result_incorrect`: in spaced repetition an honest 忘记 is a correct move.
 */
const FLOW_RATING_SIGNALS: Record<UnitRating, FlowRatingSignal> = {
  1: { audioEvent: 'node_select', breath: 'note', reaction: 'sink', haptic: 'soft-fail', keepsCombo: false },
  2: { audioEvent: 'text_commit', breath: 'note', reaction: 'wobble', haptic: 'select', keepsCombo: true },
  3: { audioEvent: 'field_commit', breath: 'affirm', reaction: 'lift', haptic: 'success', keepsCombo: true },
  4: { audioEvent: 'segment_action', breath: 'affirm', reaction: 'fling', haptic: 'success', keepsCombo: true },
}

export function flowRatingSignal(rating: UnitRating, passed: boolean): FlowRatingSignal {
  const signal = FLOW_RATING_SIGNALS[rating]
  // The server's pass verdict wins over the grade's default breath.
  return { ...signal, breath: passed ? 'affirm' : 'note' }
}

/** Combo milestones fire on the exact step, so 4/8/12/20 each land once per streak. */
export function comboMilestoneIndex(combo: number, steps: readonly number[]): number | null {
  const index = steps.indexOf(combo)
  return index >= 0 ? index : null
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
