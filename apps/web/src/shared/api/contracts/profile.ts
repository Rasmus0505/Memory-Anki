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
  default_review_mode: string
  sleep_review_time: string
  early_review_anchor: string
  ebbinghaus_intervals: string
  daily_max_reviews: string
  mastered_interval: string
  auto_smooth_overdue: string
  overdue_smoothing_days: string
  overdue_smoothing_threshold: string
  mindmap_ai_split_api_key: string
  mindmap_ai_split_base_url: string
  mindmap_ai_split_model: string
  mindmap_ai_split_temperature: string
  mindmap_ai_split_max_children: string
  mindmap_ai_split_include_note: string
  mindmap_ai_split_custom_instruction: string
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
  active_version_id?: string | null
  candidate_version?: AiPromptVersionSummary | null
}
export interface AiPromptVersionSummary {
  id: string
  prompt_key?: string
  status: 'candidate' | 'passed' | 'failed' | 'active' | 'archived'
  template?: string
  source?: string
  eval_summary?: {
    run_id?: string
    case_count?: number
    schema_success_rate?: number
    assertion_success_rate?: number
    critical_passed?: boolean
    gate_passed?: boolean
  }
  created_at?: string | null
  activated_at?: string | null
}
export interface AiPromptTemplateListResponse {
  items: AiPromptTemplate[]
  candidates?: AiPromptVersionSummary[]
  requires_evaluation?: boolean
}
export interface AiRuntimeOptions {
  model?: string
  thinking_enabled?: boolean | null
  prompt_override?: string | null
}
export type AiScenarioRuntimeOptionsMap = Record<string, AiRuntimeOptions>
export type AiProviderKey = 'dashscope' | 'qwen' | 'zhipu' | 'siliconflow' | 'deepseek'
export type AiModelType = 'llm' | 'vl' | 'translation' | 'asr'

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
  structured_output_mode: 'json_schema' | 'json_object' | 'prompt_only'
  input_price_per_million?: number | null
  output_price_per_million?: number | null
  cached_input_price_per_million?: number | null
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
  structured_output_probe?: {
    suggested_mode: 'json_schema' | 'json_object' | 'prompt_only'
    current_mode: 'json_schema' | 'json_object' | 'prompt_only'
    errors: Record<string, string>
    requires_confirmation: boolean
  }
}
export interface AiEvalRun {
  id: string
  prompt_key: string
  candidate_version_id: string
  status: string
  case_count: number
  schema_success_rate: number
  assertion_success_rate: number
  critical_passed: boolean
  gate_passed: boolean
  results: Array<Record<string, unknown>>
}
export interface AiQualitySummary {
  range_days: number
  metrics: {
    total_calls: number
    success_rate: number
    structured_success_rate: number
    repair_rate: number
    p50_duration_ms: number | null
    p95_duration_ms: number | null
    input_tokens: number
    output_tokens: number
    cached_input_tokens: number
    estimated_cost: number
    has_estimated_cost: boolean
  }
  errors: Array<{ kind: string; count: number }>
  recent_evals: Array<{
    id: string
    prompt_key: string
    status: string
    case_count: number
    assertion_success_rate: number
    gate_passed: boolean
    created_at: string | null
  }>
  prompt_candidates: Array<{
    id: string
    prompt_key: string
    status: string
    created_at: string | null
  }>
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
export interface FullImportManifest {
  format_version: number
  alembic_revision: string
  created_at: string
  table_counts: Record<string, number>
}
export interface FullImportPreviewResponse {
  ok: boolean
  error?: string
  manifest?: FullImportManifest
  attachment_count?: number
  schema_match?: boolean
  current_alembic_revision?: string
}
export interface FullImportResponse {
  ok: boolean
  error?: string
  table_counts?: Record<string, number>
  restored_attachments?: number
}
export interface ClientPreferences {
  memory_anki_shortcuts: Record<string, unknown> | null
  review_feedback_settings: Record<string, unknown> | null
  english_practice_settings: Record<string, unknown> | null
  timer_automation_config: Record<string, unknown> | null
  timer_focus_config: Record<string, unknown> | null
  break_guard_config: Record<string, unknown> | null
  dashboard_duration_filter: Record<string, unknown> | null
  study_goals: Record<string, unknown> | null
  palace_list_view_settings: Record<string, unknown> | null
  palace_shelf_view_settings: Record<string, unknown> | null
}
export interface ClientPreferencesResponse {
  items: ClientPreferences
}
export interface TimeRecordListResponse<TItem = Record<string, unknown>> {
  items: TItem[]
}
