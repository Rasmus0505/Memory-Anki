export interface FreestyleOverlayQuizProgressRequest {
  operation_id: string
  expected_version: number
  current_index: number
  completed_ids: number[]
  states: Record<string, Record<string, unknown>>
  auto_prioritize_wrong_palaces?: boolean
  wrong_question_ids?: number[]
}
