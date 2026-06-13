export type PalaceQuizQuestionType = 'multiple_choice' | 'short_answer'

export interface PalaceQuizOption {
  id: string
  text: string
}

export interface PalaceQuizSourceMeta {
  source_kind: string
  subject_document_id: number | null
  page_numbers: number[] | null
  image_names: string[] | null
  extra_prompt: string
  ai_call_log_id: string | null
  generated_at: string
  generation_mode: string
}

export interface PalaceQuizMiniPalaceRef {
  id: number
  name: string
}

export interface PalaceQuizAnswerPayload {
  correct_option_id?: string
  reference_answer?: string
}

export interface PalaceQuizQuestionDraft {
  mini_palace_id?: number | null
  origin_question_id?: number | null
  question_type: PalaceQuizQuestionType
  stem: string
  options: PalaceQuizOption[]
  answer_payload: PalaceQuizAnswerPayload
  analysis: string
  source_meta: PalaceQuizSourceMeta
}

export interface PalaceQuizQuestion extends PalaceQuizQuestionDraft {
  id: number
  palace_id: number
  mini_palace: PalaceQuizMiniPalaceRef | null
  sort_order: number
  correct_count: number
  incorrect_count: number
  attempt_count: number
  created_at: string | null
  updated_at: string | null
}

export interface PalaceQuizMiniPalaceGroupPreview {
  mini_palace_id: number
  mini_palace_name: string
  questions: PalaceQuizQuestionDraft[]
}

export interface PalaceQuizGroupedPreview {
  mini_palace_groups: PalaceQuizMiniPalaceGroupPreview[]
  unassigned_questions: PalaceQuizQuestionDraft[]
}

export interface PalaceQuizGenerationPreview {
  palace_id: number
  questions: PalaceQuizQuestionDraft[]
  source_meta: PalaceQuizSourceMeta
  ai_call_log_id: string | null
  grouped_questions?: PalaceQuizGroupedPreview | null
}

export interface PalaceShortAnswerFeedback {
  question_id: number
  feedback_text: string
  ai_call_log_id: string | null
}

export interface PalaceQuizMiniPalaceClassificationResult {
  palace_id: number
  mini_palace_groups: Array<{
    mini_palace_id: number
    mini_palace_name: string
    question_count: number
  }>
  unassigned_count: number
  copied_question_count: number
  ai_call_log_id: string | null
}
