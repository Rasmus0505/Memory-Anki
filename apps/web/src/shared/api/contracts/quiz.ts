import type {
  AiRuntimeOptions,
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
export interface PalaceQuizOption {
  id: string
  text: string
}

export interface PalaceQuizSourceMeta {
  source_kind: string
  page_numbers: number[] | null
  image_names: string[] | null
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
  source_pages?: Record<string, string[]> | null
  ocr_source_refs?: Array<Record<string, unknown>> | null
  repair_batch?: string | null
  repair_action?: string | null
  import_batch?: string | null
  approved_supplemental_from_ocr_source?: boolean | null
}

export interface PalaceQuizOcrSource {
  id: number
  palace_id: number
  source_kind: string
  source_set: string
  page_key: string
  page_number: number | null
  image_path: string
  raw_text: string
  lines: Array<Record<string, unknown>>
  source_meta: Record<string, unknown>
  import_batch: string
  created_at: string | null
  updated_at: string | null
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
  ocr_sources?: PalaceQuizOcrSourceDraft[]
  recovered_from_log?: boolean
}

export type PalaceQuizOcrSourceDraft = Omit<
  PalaceQuizOcrSource,
  'id' | 'palace_id' | 'created_at' | 'updated_at'
>

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
  verdict?: 'correct' | 'partial' | 'incorrect' | null
  hit_points?: string[]
  missed_points?: string[]
  suggestion?: string
  ai_call_log_id: string | null
  resolved_ai?: ResolvedAiRuntimeMeta | null
}

export interface PalaceQuestionExplainResult {
  question_id: number
  explanation_text: string
  ai_call_log_id: string | null
  resolved_ai?: ResolvedAiRuntimeMeta | string | null
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
