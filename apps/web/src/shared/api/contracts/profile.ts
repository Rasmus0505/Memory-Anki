export interface BackupSummary {
  kind: "full" | "rescue"
  /** full = 完整备份(含附件等大目录)，rolling = 轻量备份(仅数据库+迁移状态) */
  scope?: "full" | "rolling"
  full?: boolean
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
  source_location: string
  required_placeholders: string[]
  available_placeholders: AiPromptPlaceholder[]
}
export interface AiPromptTemplateListResponse {
  items: AiPromptTemplate[]
}
export interface AiRuntimeOptions {
  model?: string
  thinking_enabled?: boolean | null
  prompt_override?: string | null
}
export type AiScenarioRuntimeOptionsMap = Record<string, AiRuntimeOptions>
export type AiProviderKey = 'dashscope' | 'qwen' | 'zhipu' | 'siliconflow' | 'deepseek'
export type AiModelType = 'llm' | 'vl' | 'translation' | 'asr' | 'tts'

export interface ResolvedAiRuntimeMeta {
  scene_key: string
  scene_label?: string
  model_key: string
  model_label: string
  provider: AiProviderKey
  provider_label?: string
  model_type: AiModelType
  model_type_label?: string
  has_vision: boolean
  thinking_enabled: boolean
}

export interface AiModelCatalogItem {
  key: string
  label: string
  display_name: string
  provider: AiProviderKey
  provider_label: string
  model_type: AiModelType
  model_type_label: string
  has_vision: boolean
  supports_thinking: boolean
  supports_temperature: boolean
  is_builtin: boolean
  is_active: boolean
  default_base_url: string
  usage_count?: number
  bound_scene_labels?: string[]
  last_used_at?: string | null
  last_status?: string | null
}
export interface AiProviderSettings {
  key: AiProviderKey
  label: string
  api_key_masked: string
  has_api_key: boolean
  base_url: string
  api_key_config_key: string
  base_url_config_key: string
  api_key_source?: 'db' | 'env' | 'default'
  base_url_source?: 'db' | 'env' | 'default'
  model_count?: number
  last_called_at?: string | null
  last_status?: string | null
  last_success_at?: string | null
  last_error_at?: string | null
  last_model?: string | null
}
export interface AiModelCategory {
  key: AiModelType
  label: string
  description: string
  shared_model?: string | null
  shared_thinking_enabled?: boolean
  has_shared_config?: boolean
  available_models: AiModelCatalogItem[]
  scene_keys: string[]
  scene_count?: number
  custom_scene_count?: number
  scene_details: Array<{
    key: string
    label: string
    description: string
  }>
}
export interface AiSceneBinding {
  key: string
  label: string
  description: string
  category_key: AiModelType
  category_label: string
  config_key: string
  thinking_config_key: string
  default_model: string
  current_model: string
  default_thinking_enabled: boolean
  current_thinking_enabled: boolean
  effective_model: string
  effective_thinking_enabled: boolean
  inherits_category_default: boolean
  available_models: AiModelCatalogItem[]
  source_location: string
  latest_resolved_model?: ResolvedAiRuntimeMeta | null
  last_called_at?: string | null
  last_status?: string | null
  resolved_provider?: string | null
  resolved_model_label?: string | null
}
export interface AiModelImpactResponse {
  model_key: string
  model_label: string
  exists: boolean
  can_delete: boolean
  usage_count: number
  bound_scene_labels: string[]
  scene_impacts: Array<{
    key: string
    label: string
    category_key: AiModelType
    category_label: string
    config_key: string
  }>
  category_impacts: Array<{
    key: AiModelType
    label: string
  }>
}
export interface AiConnectionTestResponse {
  ok: boolean
  provider: AiProviderKey
  provider_label?: string
  model: string
  latency_ms: number
  error?: string | null
  source?: 'db' | 'env' | 'default'
}
export interface AiModelSettingsSummary {
  provider_count: number
  active_model_count: number
  scene_count: number
  recent_success_call_count: number
}
export interface AiModelSettingsResponse {
  providers: AiProviderSettings[]
  categories: AiModelCategory[]
  models: AiModelCatalogItem[]
  scenes: AiSceneBinding[]
  scenarios?: AiSceneBinding[]
  summary?: AiModelSettingsSummary
}
export type AiModelMetadata = AiModelCatalogItem
export type AiModelScenario = AiSceneBinding
export type AiModelScenariosResponse = AiModelSettingsResponse
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
  timer_focus_config: Record<string, unknown> | null
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
