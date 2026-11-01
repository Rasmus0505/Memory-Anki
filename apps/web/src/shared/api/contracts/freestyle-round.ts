/** Round-plan occurrence identity, split out to keep `freestyle.ts` within budget. */

export type FreestyleRoundOccurrenceStatus = 'pending' | 'inserted' | 'completed' | 'cancelled'

export interface ActiveFreestyleOverlayWrongQuestionsResponse {
  workspace: 'primary' | `p${number}`
  round_id: string
  plan_version: number
  wrong_question_ids: number[]
}

export interface FreestyleRoundOccurrence {
  occurrence_id: string
  source_card_id: string
  source_unit_id: string
  retry_attempt: number
  rating: number | null
  insert_target_index: number
  status: FreestyleRoundOccurrenceStatus
  encounter_id: string
  entered_on?: string
  available_at?: string | null
  kind?: 'retry' | 'step'
}
