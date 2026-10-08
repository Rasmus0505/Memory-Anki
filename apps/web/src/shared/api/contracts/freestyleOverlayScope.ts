/**
 * The 做题 scope report contract, split from `freestyle.ts`.
 *
 * The scope rule has its own owner (`build_overlay_question_pack` in
 * apps/api/.../practice/application/overlay_quiz_service.py) and its own
 * incident history, so keeping these types together makes that boundary visible
 * and keeps the main contract file inside its size budget.
 */

/** Why a scheduled palace contributes nothing to 做题. Copy lives in the UI. */
export type FreestyleOverlayScopeReason =
  | ''
  | 'no_questions'
  | 'kinds_filtered'
  /** The learner took every card of this palace out with 移除本队列. */
  | 'palace_removed'

/**
 * One row of the backend's authoritative 做题 scope report.
 *
 * The scope is the round's own review set: no "excluded by config" reason (a
 * palace the round scheduled stays in scope), but all-移除本队列 does leave.
 */
export interface FreestyleOverlayScopePalace {
  palace_id: number
  title: string
  /** Available questions in this palace, ignoring the kind filter. */
  question_count: number
  objective: number
  subjective: number
  /** Does this palace currently contribute questions to the pool? */
  in_pool: boolean
  /** Stable reason code when `in_pool` is false; the UI owns the copy. */
  reason: FreestyleOverlayScopeReason
}

export interface FreestyleOverlayScopePalaces {
  scheduled_count: number
  in_pool_count: number
  question_count: number
  palaces: FreestyleOverlayScopePalace[]
}
