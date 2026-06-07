export interface MindMapEditorState {
  editor_doc: Record<string, unknown> | string | null
  editor_config: Record<string, unknown>
  editor_local_config: Record<string, unknown>
  lang: string
}

export type PalaceEditorSource =
  | 'palace_edit'
  | 'palace_edit_autosave'
  | 'host_bootstrap_sync'
  | 'version_restore'
  | 'backup_restore'
  | 'import_apply'
  | 'review_edit'
  | 'practice_edit'
  | 'unknown'

export interface PalaceEditorSavePayload extends Partial<MindMapEditorState> {
  editor_source?: PalaceEditorSource
  sync_reason?: string | null
  allow_stale_overwrite?: boolean
  confirm_dangerous_change?: boolean
}

export interface MindMapNodeData {
  text?: string
  note?: string
  uid?: string
  memoryAnkiId?: number | null
  memoryAnkiNodeType?: string | null
  memoryAnkiRootKind?: string | null
  [key: string]: unknown
}

export interface MindMapDocNode {
  data?: MindMapNodeData
  children?: MindMapDocNode[]
  [key: string]: unknown
}

export interface MindMapDoc {
  root?: MindMapDocNode
  [key: string]: unknown
}

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
  structure_image_index?: number
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
  structure_image_index?: number
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
  structure_image_index?: number
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
}

export interface TextPdfImportPreviewRequest {
  subject_document_id: number
  page_selection: number[]
  range_prompt?: string
}

export interface PdfImportOptions {
  quote_original_text_only: boolean
  mount_on_original_leaf_only: boolean
  preserve_emphasis_marks: boolean
  semantic_split_long_paragraphs: boolean
  preserve_line_breaks: boolean
}

export interface SubjectDocumentSummary {
  id: number
  subject_id: number
  filename: string
  original_name: string
  mime_type: string
  file_size: number
  page_count: number
  created_at: string | null
}

export interface PdfPageSummary {
  page_number: number
  thumbnail_url: string
  preview_url: string
}

export interface ReviewQueueChapter {
  id: number
  name: string
  subject_id: number
  subject: { id: number; name: string } | null
}

export interface ReviewPalaceSummary {
  id: number
  title: string
  description: string
  archived: boolean
  mastered: boolean
  needs_practice?: boolean
  editor_doc: MindMapDoc | string | null
  pegs: Array<{ id: number; name: string; content: string; children: unknown[] }>
  attachments: Array<{ id: number; filename: string; original_name: string }>
  chapters: ReviewQueueChapter[]
  stage_labels?: string[]
  review_stages?: ReviewStageSummary[]
}

export interface ReviewScheduleSummary {
  id: number
  palace_id: number
  scheduled_date: string
  interval_days: number
  algorithm_used: string
  completed: boolean
  completed_at?: string | null
  review_number: number
  review_type: string
  schedule_count: number
  overdue_schedule_count: number
  next_due_date: string
  palace: ReviewPalaceSummary | null
}

export interface ReviewQueueResponse {
  due_count: number
  overdue_count: number
  smoothed_count: number
  stats: {
    total: number
    review_count: number
    review_duration_seconds: number
  }
  chapter: ReviewQueueChapter | null
  reviews: ReviewScheduleSummary[]
}

export interface DashboardResponse {
  due_count: number
  due_later_today_count: number
  needs_practice_count: number
  reviews: ReviewScheduleSummary[]
  stats: {
    total: number
    review_count: number
    review_duration_seconds: number
  }
  today_review_duration_seconds: number
  weekly_review_duration_seconds: number
  today_total_review_duration_seconds: number
  monthly_total_review_duration_seconds: number
  selected_total_review_duration_seconds: number
  weekly_total_review_duration_seconds: number
  weekly_formal_review_duration_seconds: number
  english_stats: {
    total_courses: number
    unfinished_courses: number
    completed_courses: number
    today_practice_seconds: number
    weekly_practice_seconds: number
    total_practice_seconds: number
  }
  today_learning_palaces: Array<{
    palace_id: number
    palace_title: string
    total_seconds: number
    review_seconds: number
    practice_seconds: number
    palace_edit_seconds: number
  }>
  today_new_palace_count: number
  today_new_palaces: Array<{
    subject: SubjectSummary | null
    chapter_groups: Array<{
      source_chapter: ChapterSummary | null
      palaces: Array<{
        id: number
        title: string
        created_at: string | null
        primary_chapter: ChapterSummary | null
        resolved_parent_chapter: ChapterSummary | null
      }>
    }>
    ungrouped_palaces: Array<{
      id: number
      title: string
      created_at: string | null
      primary_chapter: ChapterSummary | null
      resolved_parent_chapter: ChapterSummary | null
    }>
  }>
  recent_palaces: Array<{
    id: number
    title: string
    description: string
    peg_count: number
    created_at: string | null
  }>
}

export interface DashboardQuery {
  duration_mode?: 'month' | 'range' | 'all'
  month?: string
  start_date?: string
  end_date?: string
}

export interface EnglishGenerationTask {
  id: string
  status: 'queued' | 'running' | 'failed' | 'completed'
  stage: string
  progressPercent: number
  message: string
  sourceFilename: string
  fileSize: number
  errorMessage: string
  courseId: number | null
  createdAt: string | null
  updatedAt: string | null
  startedAt: string | null
  completedAt: string | null
}

export interface EnglishCourseSummary {
  id: number
  title: string
  originalFilename: string
  sentenceCount: number
  durationSeconds: number
  status: 'unfinished' | 'completed'
  currentSentenceIndex: number
  updatedAt: string | null
  createdAt: string | null
}

export interface EnglishCourseProgress {
  currentSentenceIndex: number
  completedSentenceIndexes: number[]
  completed: boolean
  updatedAt: string | null
}

export interface EnglishCourseSentence {
  id: number
  index: number
  textEn: string
  textZh: string
  startMs: number
  endMs: number
  tokens: string[]
}

export interface EnglishCourseDetail extends EnglishCourseSummary {
  mediaUrl: string
  sentences: EnglishCourseSentence[]
  progress: EnglishCourseProgress
}

export interface EnglishWorkspaceResponse {
  currentTask: EnglishGenerationTask | null
  continueCourse: EnglishCourseSummary | null
  recentCourses: EnglishCourseSummary[]
  stats: DashboardResponse['english_stats']
}

export interface EnglishSentenceCheckResponse {
  passed: boolean
  tokenResults: Array<{
    input: string
    correct: boolean
    missing: boolean
    unexpected: boolean
  }>
  normalizedInput: string[]
  tokenCount: number
}

export interface EnglishGenerationLogEvent {
  id: string
  timestamp: string
  stage: string
  kind: string
  message: string
  data: Record<string, unknown>
}

export interface EnglishGenerationLogResponse {
  task: EnglishGenerationTask | null
  events: EnglishGenerationLogEvent[]
  aiLogs: AiCallLogDetail[]
}

export interface PalaceReviewPlanItem {
  date: string | null
  representative_schedule_id: number
  schedule_count: number
  pending_count: number
  completed_count: number
  completed: boolean
  review_number: number
  interval_days: number
  review_type: string
}

export interface PalaceReviewPlanResponse {
  palace_id: number
  palace_title: string
  plan: PalaceReviewPlanItem[]
}

export interface PalaceSegmentSummary {
  id: number
  palace_id: number
  name: string
  display_name?: string
  color: string
  created_at: string | null
  sort_order: number
  node_uids: string[]
  node_count: number
  estimated_review_seconds: number
  review_stage_total: number
  review_stage_completed: number
  review_stage_progress: number
  stage_labels: string[]
  review_stages: ReviewStageSummary[]
  next_review_at: string | null
  has_due_review: boolean
  current_review_schedule_id: number | null
  is_empty: boolean
  is_virtual_default?: boolean
}

export interface ReviewStageSummary {
  review_number: number
  label: string
  completed: boolean
  completed_at: string | null
  scheduled_at: string | null
}

export interface MindMapHostSegmentSummary {
  id: number
  name: string
  color: string
  created_at: string | null
  node_uids: string[]
}

export interface MindMapHostSegmentRangeDraft {
  active: boolean
  targetSegmentId: number | "new" | null
  selectedNodeUids: string[]
  overriddenConflictNodeUids: string[]
}

export interface BilinkSearchResult {
  type: 'node' | 'palace'
  palace_id: number
  palace_title: string
  node_uid: string | null
  node_text: string | null
  node_path: string[] | null
}

export interface BilinkSearchResponse {
  results: BilinkSearchResult[]
}

export interface BilinkItem {
  id: number
  direction: 'incoming' | 'outgoing' | null
  source_palace_id: number
  source_palace_title: string
  target_palace_id: number
  target_palace_title: string
  src_uid: string | null
  tgt_uid: string | null
  text: string
  source_node_text: string | null
  target_node_text: string | null
  source_node_path: string[] | null
  target_node_path: string[] | null
}

export interface BilinkListResponse {
  items: BilinkItem[]
}

export interface BilinkCountsResponse {
  counts: Record<string, number>
}

export interface BilinkNodeSummary {
  uid: string
  text: string
}

export interface BilinkNodeContext {
  palace_id: number
  palace_title: string
  node_uid: string | null
  node_text: string
  node_note: string
  node_path: string[]
  parent_text: string | null
  children: BilinkNodeSummary[]
  siblings: BilinkNodeSummary[]
}

export interface PalaceListItem {
  id: number
  title: string
  description: string
  mastered: boolean
  needs_practice?: boolean
  created_at: string | null
  next_review_at: string | null
  has_due_review: boolean
  current_review_schedule_id: number | null
  review_stage_total: number
  review_stage_completed: number
  review_stage_progress: number
  stage_labels: string[]
  review_stages?: ReviewStageSummary[]
  segments: PalaceSegmentSummary[]
  chapters?: Array<unknown>
}

export interface ChapterSummary {
  id: number
  name: string
  subject_id: number | null
  parent_id: number | null
  is_explicit?: boolean
}

export interface SubjectSummary {
  id: number
  name: string
  color: string
}

export interface PalaceGroupedItem extends PalaceListItem {
  resolved_title: string
  title_mode: string
  manual_title: string
  grouping_mode: string
  manual_group_chapter_id: number | null
  binding_status: string
  primary_chapter_id: number | null
  primary_chapter: ChapterSummary | null
  resolved_subject: SubjectSummary | null
  resolved_parent_chapter: ChapterSummary | null
  group_id: number | null
  group_sort_order: number
}

export interface PalaceChapterGroup {
  source_chapter: ChapterSummary
  palaces: PalaceGroupedItem[]
}

export interface PalaceSubjectGroup {
  subject: SubjectSummary | null
  chapter_groups: PalaceChapterGroup[]
  ungrouped_palaces: PalaceGroupedItem[]
}

export interface PalaceSubjectShelfItem {
  subject: SubjectSummary | null
  palace_count: number
  chapter_count: number
  review_status: 'due_now' | 'due_later_today' | 'idle'
  has_due_review: boolean
  has_due_later_today: boolean
  due_now_count: number
  due_later_today_count: number
  needs_practice_count: number
}

export interface PalaceSubjectShelfResponse {
  items: PalaceSubjectShelfItem[]
}

export interface PalaceGroupSummary {
  id: number
  name: string
  color: string
  sort_order: number
  source_chapter_id: number | null
  palaces: PalaceGroupedItem[]
}

export interface PalaceGroupedListResponse {
  groups: PalaceGroupSummary[]
  ungrouped: PalaceGroupedItem[]
  subjects: PalaceSubjectGroup[]
}

export interface PalaceVersionSummary {
  id: number
  palace_id: number
  trigger_reason: string
  title: string
  created_at_value: string | null
  created_at: string | null
}

export interface PalaceVersionListResponse {
  palace_id: number
  palace_title: string
  removed_duplicates?: number
  versions: PalaceVersionSummary[]
}

export interface PalaceVersionDetail extends PalaceVersionSummary {
  editor_doc: Record<string, unknown> | string | null
  editor_config: Record<string, unknown> | string | null
  editor_local_config: Record<string, unknown> | string | null
}

export interface SessionProgressSnapshot {
  id: number
  session_kind: "practice" | "review" | "segment_practice" | "segment_review"
  palace_id: number | null
  review_schedule_id: number | null
  palace_segment_id: number | null
  palace_segment_review_schedule_id: number | null
  reveal_map: Record<string, "hidden" | "placeholder" | "revealed">
  red_node_ids: string[]
  completed: boolean
  updated_at: string | null
}

export interface ReviewSessionSubmitResponse {
  ok: boolean
  completion_mode: "manual_complete" | "auto_complete" | string
  score: number
  next_id: number | null
  mastered: boolean
}

export interface SegmentReviewScheduleSummary {
  id: number
  palace_segment_id: number
  palace_id: number | null
  scheduled_date: string
  interval_days: number
  algorithm_used: string
  completed: boolean
  completed_at?: string | null
  review_number: number
  review_type: string
  schedule_count: number
  overdue_schedule_count: number
  next_due_date: string
  estimated_review_seconds: number
  segment: PalaceSegmentSummary | null
}

export interface SegmentReviewQueueResponse {
  due_count: number
  overdue_count: number
  smoothed_count: number
  stats: {
    total: number
    review_count: number
    review_duration_seconds: number
  }
  chapter: ReviewQueueChapter | null
  reviews: SegmentReviewScheduleSummary[]
}

export interface BatchSegmentReviewSessionResponse {
  palace: {
    id: number
    title: string
    description: string
  }
  segments: PalaceSegmentSummary[]
  editor_doc: Record<string, unknown> | string | null
  estimated_review_seconds: number
}

export interface BatchSegmentReviewSubmitResponse {
  ok: boolean
  completed_segment_ids: number[]
  completion_mode: "manual_complete" | "auto_complete" | string
}

export interface BackupSummary {
  kind: "full" | "rescue"
  name: string
  path: string
  created_at: string
  reason: string
  has_database: boolean
  has_attachments: boolean
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

export interface AiCallLogArtifact {
  name: string
  label: string
  mime_type: string
  source_kind: string
  url: string
}

export interface AiCallLogSummary {
  id: string
  feature: string
  operation: string
  job_id?: string | null
  palace_id?: number | null
  status: string
  provider: string
  base_url: string
  model: string
  request_id: string
  created_at?: string | null
  updated_at?: string | null
}

export interface AiCallLogDetail extends AiCallLogSummary {
  request_payload: Record<string, unknown>
  response_payload: Record<string, unknown>
  error_payload: Record<string, unknown>
  prompt_text: string
  response_text: string
  input_artifacts: AiCallLogArtifact[]
}

export interface AiCallLogListResponse {
  items: AiCallLogSummary[]
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

export interface RuntimeInfo {
  channel: string
  commit: string | null
  short_commit: string | null
  runtime_generation: number
  declared_runtime_generation: number
  min_supported_generation: number
  max_supported_generation: number
  last_started_at: string | null
}

export interface TimeRecordListResponse<TItem = Record<string, unknown>> {
  items: TItem[]
}
