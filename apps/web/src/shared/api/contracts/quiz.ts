import type {
  AiRuntimeOptions,
  AiScenarioRuntimeOptionsMap,
  ResolvedAiRuntimeMeta,
} from './profile'

export type PalaceQuizQuestionType =
  | 'multiple_choice'
  | 'true_false'
  | 'fill_blank'
  | 'matching'
  | 'ordering'
  | 'categorization'
  | 'short_answer'
export type PalaceQuizPdfSourceRole = 'question' | 'answer'

export interface PalaceQuizOption {
  id: string
  text: string
}

export interface PalaceQuizSourceMeta {
  source_kind: string
  subject_document_id: number | null
  page_numbers: number[] | null
  image_names: string[] | null
  pdf_sources?: PalaceQuizPdfSourceMeta[] | null
  extra_prompt: string
  secondary_review_enabled?: boolean
  ai_call_log_id: string | null
  generated_at: string
  generation_mode: string
  recovered_from_ai_call_log_id?: string | null
  review_mode?: 'chapter' | 'cross_palace' | string | null
  related_palace_ids?: number[] | null
  related_palace_summaries?: Array<{
    palace_id: number
    title: string
    subject?: { id: number; name: string } | null
    first_multi_nodes: string[]
  }> | null
  question_types?: PalaceQuizQuestionType[] | string[] | null
  question_count?: number | null
}

export interface PalaceQuizPdfSourceMeta {
  subject_document_id: number | null
  document_name?: string | null
  page_numbers: number[] | null
  image_names?: string[] | null
  role_hint?: PalaceQuizPdfSourceRole | string | null
}

export interface PalaceQuizMiniPalaceRef {
  id: number
  name: string
}

export interface PalaceQuizAnswerPayload {
  correct_option_id?: string
  reference_answer?: string
  correct_answer?: boolean
  false_explanation?: string
  blanks?: Array<{
    id: string
    answer: string
    aliases?: string[]
  }>
  pairs?: Array<{
    left_id: string
    left: string
    right_id: string
    right: string
  }>
  items?: Array<{
    id: string
    text: string
    category_id?: string
  }>
  correct_order_ids?: string[]
  categories?: Array<{
    id: string
    name: string
  }>
}

export interface PalaceQuizQuestionDraft {
  mini_palace_id?: number | null
  source_chapter_id?: number | null
  classified_chapter_id?: number | null
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
  palace_id: number | null
  mini_palace: PalaceQuizMiniPalaceRef | null
  source_chapter?: { id: number; name: string; subject_id: number } | null
  classified_chapter?: { id: number; name: string; subject_id: number; parent_id: number | null } | null
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
  mini_palace_groups?: PalaceQuizMiniPalaceGroupPreview[]
  child_chapter_groups?: Array<{
    classified_chapter_id: number
    classified_chapter_name: string
    questions: PalaceQuizQuestionDraft[]
  }>
  unassigned_questions: PalaceQuizQuestionDraft[]
}

export interface PalaceQuizGenerationPreview {
  palace_id?: number | null
  chapter_id?: number
  questions: PalaceQuizQuestionDraft[]
  source_meta: PalaceQuizSourceMeta
  ai_call_log_id: string | null
  resolved_ai?: ResolvedAiRuntimeMeta | null
  resolved_ai_steps?: {
    generation?: ResolvedAiRuntimeMeta | null
    pairing?: ResolvedAiRuntimeMeta | null
    review?: ResolvedAiRuntimeMeta | null
  } | null
  warnings?: string[]
  generation_stats?: {
    returned_count: number
    savable_count: number
    skipped_count: number
  }
  grouped_questions?: PalaceQuizGroupedPreview | null
  related_palace_summaries?: Array<{
    palace_id: number
    title: string
    subject?: { id: number; name: string } | null
    first_multi_nodes: string[]
  }>
}

export interface RecoverPalaceQuizFromAiLogRequest {
  ai_call_log_id: string
  classify_by_mini_palace?: boolean
  ai_options?: AiRuntimeOptions
  ai_options_by_scenario?: AiScenarioRuntimeOptionsMap
}

export interface RecoverAndSavePalaceQuizFromAiLogRequest
  extends RecoverPalaceQuizFromAiLogRequest {
  selected_chapter_id: number
}

export interface RecoverAndSavePalaceQuizFromAiLogResult {
  items: PalaceQuizQuestion[]
  recovered_count: number
  saved_count: number
  deduped_count: number
  ai_call_log_id: string
  grouped_summary: Array<{
    classified_chapter_id: number
    classified_chapter_name: string
    question_count: number
  }>
  generation_stats?: {
    returned_count: number
    savable_count: number
    skipped_count: number
  }
  warnings?: string[]
  skipped_reasons?: Array<{
    code: string
    count: number
    question_indexes?: number[]
  }>
}

export interface PalaceQuizStreamStatusEvent {
  phase: string
  message: string
  step?: number | null
  total?: number | null
}

export interface PalaceQuizStreamDeltaEvent {
  text: string
}

export interface PalaceShortAnswerFeedback {
  question_id: number
  feedback_text: string
  ai_call_log_id: string | null
  resolved_ai?: ResolvedAiRuntimeMeta | null
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
  resolved_ai?: ResolvedAiRuntimeMeta | null
}
