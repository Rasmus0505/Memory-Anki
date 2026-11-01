/**
 * Server-side progress projection for one freestyle round.
 *
 * The backend computes this from the persisted plan and ships it with every
 * round payload. The client must not re-derive counts or card status from the
 * plan: two derivations with slightly different inputs is how the rail and the
 * round sheet ended up disagreeing about the same round.
 *
 * `viewing` is deliberately absent. What the learner is looking at is a
 * client-side instant, not part of the stored round.
 */
export type FreestyleRoundProgressStatus = 'done' | 'pending' | 'excluded' | 'compressed'
export type FreestyleRoundProgressTone = 'done' | 'retry' | 'pending'
export type FreestyleRoundOccurrenceKind = 'source' | 'retry' | 'step'

export interface FreestyleRoundProgressItem {
  card_id: string
  source_card_id: string
  occurrence_kind: FreestyleRoundOccurrenceKind
  retry_attempt: number
  unit_id: string
  palace_id: number | null
  kind: string
  entered_on: string
  is_new: boolean
  bedtime: boolean
  is_quiz: boolean
  status: FreestyleRoundProgressStatus
  tone: FreestyleRoundProgressTone
  scored: boolean
  own_rating: number | null
  waiting_retry: boolean
  available_at: string | null
  servable: boolean
  wrong: boolean
}

export interface FreestyleRoundProgress {
  plan_version: number | null
  current_card_id: string | null
  current_index: number
  position: number
  position_base: number
  total: number
  scheduled_base: number
  done_count: number
  retry_count: number
  retry_inserted: number
  passed_count: number
  next_unfinished_id: string | null
  fully_handled: boolean
  waiting: { count: number; next_ready_at: string | null }
  compressible_ids: string[]
  wrong_unit_ids: string[]
  items: FreestyleRoundProgressItem[]
}
