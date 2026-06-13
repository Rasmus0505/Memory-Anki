import type { AiRuntimeOptions } from './profile'
import type { MindMapDoc } from './mindmap'

export interface MindMapImportSourceNode {
  text: string
  rich_text_html?: string
  emphasis_marks?: Array<{
    kind: 'underline' | 'wavy-underline'
    text: string
  }>
  children: MindMapImportSourceNode[]
}
export interface MindMapImportSourceTree {
  title: string
  children: MindMapImportSourceNode[]
}
export interface MindMapImportPreviewResponse {
  ok: boolean
  error?: string
  source_tree?: MindMapImportSourceTree
  editor_doc?: MindMapDoc | string | null
  extracted_text?: string
  structure_image_index?: number | null
  image_count?: number
  selected_pages?: number[]
  structure_page?: number | null
  match_mode?: 'strict_match' | 'approximate_match' | 'direct_generation'
  can_apply?: boolean
  warnings?: string[]
  ocr_grounding_used?: boolean
  ocr_text_chars?: number | null
}
export interface MindMapBatchImportPreviewResponse {
  ok: boolean
  error?: string
  source_tree?: MindMapImportSourceTree
  editor_doc?: MindMapDoc | string | null
  structure_image_index?: number | null
  image_count?: number
}
export interface ImageTextPreviewResponse {
  ok: boolean
  error?: string
  extracted_text?: string
  selected_pages?: number[]
}
export interface MindMapAiSplitRequest {
  editor_doc: MindMapDoc | string | null
  target_node_uid: string | null
  ai_options?: AiRuntimeOptions
}
export interface MindMapAiSplitResponse {
  ok: boolean
  editor_doc?: MindMapDoc | string | null
  generated_children_count?: number
  reassigned_existing_children_count?: number
  model?: string
  ai_call_log_id?: string | null
  error?: string
  request_id?: string
}
export type MindMapImportJobStatus = 'draft' | 'running' | 'paused' | 'completed' | 'failed' | 'interrupted'
export type MindMapImportJobStage = 'prepared' | 'structure' | 'ocr' | 'merge' | 'text' | 'completed'
export interface MindMapImportJobError {
  code: string
  stage: MindMapImportJobStage
  message: string
  retryable: boolean
  raw_snippet?: string
  request_id?: string
  details?: Record<string, unknown>
}
export interface MindMapImportJobUsage {
  structure: number
  ocr: number
  merge: number
  text: number
  total: number
}
export interface MindMapImportJobProgress {
  phase: string
  message: string
  step: number | null
  total_steps: number | null
  preview_text: string
}
export interface MindMapImportJobResult {
  source_tree?: MindMapImportSourceTree
  editor_doc?: MindMapDoc | string | null
  extracted_text?: string
  structure_image_index?: number | null
  image_count?: number
  selected_pages?: number[]
  structure_page?: number | null
  match_mode?: 'strict_match' | 'approximate_match' | 'direct_generation'
  can_apply?: boolean
  warnings?: string[]
  ocr_grounding_used?: boolean
  ocr_text_chars?: number | null
}
export type PdfImportMode = 'direct_generation' | 'structured_merge'
export interface MindMapImportJob {
  id: string
  entity_key?: string
  status: MindMapImportJobStatus
  stage: MindMapImportJobStage
  resumable: boolean
  pause_requested?: boolean
  source_kind: 'image-single' | 'image-batch' | 'subject-pdf'
  mode: 'mindmap' | 'text'
  source_meta?: Record<string, unknown>
  result?: MindMapImportJobResult | null
  error?: MindMapImportJobError | null
  usage?: MindMapImportJobUsage
  progress?: MindMapImportJobProgress | null
  created_at?: string | null
  updated_at?: string | null
  started_at?: string | null
  completed_at?: string | null
}
export interface MindMapImportJobListResponse {
  items: MindMapImportJob[]
}
export interface ImportStreamStatusEvent {
  phase: string
  message: string
  step: number
  total_steps: number
}
export interface ImportStreamDeltaEvent {
  text: string
  accumulated_text: string
  channel: 'text' | 'raw_model'
}
export interface MindMapPdfImportPreviewRequest {
  subject_document_id: number
  page_selection: number[]
  pdf_mode?: PdfImportMode
  structure_page?: number | null
  range_prompt?: string
  fallback_title?: string
  import_options?: PdfImportOptions
  ai_options?: AiRuntimeOptions
}
export interface TextPdfImportPreviewRequest {
  subject_document_id: number
  page_selection: number[]
  range_prompt?: string
  ai_options?: AiRuntimeOptions
}
export interface PdfImportOptions {
  quote_original_text_only: boolean
  mount_on_original_leaf_only: boolean
  preserve_emphasis_marks: boolean
  semantic_split_long_paragraphs: boolean
  preserve_line_breaks: boolean
}
