export interface BackupSummary {
  kind: "full" | "rescue"
  name: string
  path: string
  created_at: string
  reason: string
  has_database: boolean
  has_attachments: boolean
  has_english_data?: boolean
  included_items?: string[]
}
export interface BackupListResponse {
  items: BackupSummary[]
}
export interface ReviewSettings {
  default_algorithm: string
  default_review_mode: string
  custom_intervals: string
  algorithm_change_scope: string
  sleep_review_time: string
  early_review_anchor: string
  ebbinghaus_intervals: string
  daily_max_reviews: string
  mastered_interval: string
  auto_smooth_overdue: string
  overdue_smoothing_days: string
  overdue_smoothing_threshold: string
  time_recording_threshold_seconds: string
  import_pdf_quote_original_default: string
  import_pdf_mount_leaf_only_default: string
  import_pdf_preserve_emphasis_default: string
  import_pdf_semantic_split_default: string
  import_pdf_preserve_line_breaks_default: string
  mindmap_ai_split_api_key: string
  mindmap_ai_split_base_url: string
  mindmap_ai_split_model: string
  mindmap_ai_split_temperature: string
  mindmap_ai_split_max_children: string
  mindmap_ai_split_include_note: string
  mindmap_ai_split_custom_instruction: string
  flow_voice_api_key: string
  flow_voice_base_url: string
  flow_voice_model: string
  flow_voice_voice: string
  flow_voice_format: string
  flow_voice_sample_rate: string
  flow_voice_instruction: string
  [key: string]: string
}
export interface AiPromptPlaceholder {
  name: string
  description: string
}
export interface AiPromptTemplate {
  key: string
  label: string
  description: string
  template: string
  default_template: string
  is_customized: boolean
  required_placeholders: string[]
  available_placeholders: AiPromptPlaceholder[]
}
export interface AiPromptTemplateListResponse {
  items: AiPromptTemplate[]
}
export interface ImportPalacesResponse {
  ok: boolean
  count?: number
  error?: string
}
export interface CreateBackupResponse {
  ok: boolean
  path: string
}
export interface RestoreBackupResponse {
  ok: boolean
  rescue_path: string
}
export interface ClientPreferences {
  memory_anki_shortcuts: Record<string, unknown> | null
  review_feedback_settings: Record<string, unknown> | null
  english_practice_settings: Record<string, unknown> | null
  timer_automation_config: Record<string, unknown> | null
  dashboard_duration_filter: Record<string, unknown> | null
  palace_list_view_settings: Record<string, unknown> | null
  palace_shelf_view_settings: Record<string, unknown> | null
  voice_coach_settings: Record<string, unknown> | null
}
export interface ClientPreferencesResponse {
  items: ClientPreferences
}
export interface TimeRecordListResponse<TItem = Record<string, unknown>> {
  items: TItem[]
}
