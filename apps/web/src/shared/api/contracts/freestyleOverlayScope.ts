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
  /** The palace has questions, but none on this round's reviewed units/root paths. */
  | 'unit_no_questions'
  | 'kinds_filtered'
  /** The learner took every card of this palace out with 移除本队列. */
  | 'palace_removed'
  /** The learner deleted this palace from 做题 (questions only; review is unchanged). */
  | 'palace_skipped'

/**
 * One row of the backend's authoritative 做题 scope report.
 *
 * The scope is the round's own review set: no "excluded by config" reason (a
 * palace the round scheduled stays in scope), but all-移除本队列 does leave.
 */
export interface FreestyleOverlayScopePalace {
  palace_id: number
  title: string
  /**
   * Questions available in this palace in the **active 做题 range**, ignoring
   * the kind filter. 本轮复习单元 counts only the scheduled units and their
   * root paths; 整个宫殿 counts every published question.
   */
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
  /** Playable questions only: blocked palaces are not summed into this. */
  question_count: number
  palaces: FreestyleOverlayScopePalace[]
}
