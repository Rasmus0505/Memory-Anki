export interface MindMapEditorState {
  editor_doc: Record<string, unknown> | string | null
  editor_config: Record<string, unknown>
  editor_local_config: Record<string, unknown>
  lang: string
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
  editor_doc: MindMapDoc | string | null
  pegs: Array<{ id: number; name: string; content: string; children: unknown[] }>
  attachments: Array<{ id: number; filename: string; original_name: string }>
  chapters: ReviewQueueChapter[]
}

export interface ReviewScheduleSummary {
  id: number
  palace_id: number
  scheduled_date: string
  interval_days: number
  algorithm_used: string
  completed: boolean
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

export interface PalaceReviewPlanItem {
  id: number
  scheduled_date: string | null
  completed: boolean
  review_number: number
  sequence_label: string
  same_day_index: number
  same_day_total: number
  algorithm_used: string
  review_type: string
  interval_days: number
}

export interface PalaceReviewPlanResponse {
  palace_id: number
  palace_title: string
  plan: PalaceReviewPlanItem[]
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
  session_kind: "practice" | "review"
  palace_id: number | null
  review_schedule_id: number | null
  reveal_map: Record<string, "hidden" | "placeholder" | "revealed">
  red_node_ids: string[]
  completed: boolean
  updated_at: string | null
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
  [key: string]: string
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

export interface TimeRecordListResponse<TItem = Record<string, unknown>> {
  items: TItem[]
}
