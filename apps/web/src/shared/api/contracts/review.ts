import type { MindMapDoc } from './mindmap'

export interface ReviewQueueChapter {
  id: number
  name: string
  subject_id: number
  subject: { id: number; name: string } | null
}
export interface ReviewStageSummary {
  review_number: number
  label: string
  completed: boolean
  completed_at: string | null
  scheduled_at: string | null
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
  current_review_schedule_id?: number | null
  review_stage_total?: number
  review_stage_completed?: number
  review_stage_progress?: number
}
export interface ReviewScheduleSummary {
  id: number
  palace_id: number
  scheduled_date: string
  due_at: string | null
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
  later_today_count: number
  overdue_count: number
  smoothed_count: number
  stats: {
    total: number
    review_count: number
    review_duration_seconds: number
  }
  chapter: ReviewQueueChapter | null
  reviews: ReviewScheduleSummary[]
  later_today_reviews: ReviewScheduleSummary[]
}
export interface SpreadOverdueMove {
  schedule_id: number
  palace_id: number
  palace_title: string
  old_date: string
  old_at?: string | null
  new_date: string
}
export interface SpreadOverdueResponse {
  ok: boolean
  spread: number
  moves: SpreadOverdueMove[]
}
export interface ReviewSessionSubmitResponse {
  ok: boolean
  completion_mode: "manual_complete" | "auto_complete" | string
  score: number
  next_id: number | null
  mastered: boolean
  review_log_id: number
  palace_id: number
  chapter_id: number | null
  duration_seconds: number
  completed_stage_count: number
  total_stage_count: number
  completed_stage_label: string | null
  next_stage_label: string | null
  next_review_at: string | null
  needs_practice: boolean
}
export interface ReviewStageProgressRepairResponse {
  ok: boolean
  dry_run?: boolean
  before?: ReviewStageProgressHealthResponse
  after?: ReviewStageProgressHealthResponse
  palace_count: number
  segment_count: number
  orphan_progress_count?: number
  orphan_study_session_count?: number
  practice_recovery_count?: number
  study_session_count?: number
}

export interface ReviewStageProgressHealthResponse {
  ok: boolean
  orphan_progress_count: number
  orphan_progress_ids?: number[]
  orphan_study_session_count: number
  orphan_study_session_ids?: string[]
  stage_gap_palace_count: number
  total_issues: number
  needs_repair: boolean
}

export interface ReviewLoadForecastItem {
  date: string
  due_count: number
  is_today: boolean
}

export interface ReviewLoadForecastResponse {
  days: number
  overdue_count: number
  total_upcoming: number
  items: ReviewLoadForecastItem[]
}
export interface ReviewStageAdjustmentPreviewPayload {
  target_completed_count: number
  completed_at: string | null
  needs_practice: boolean
}

export interface ReviewStageAdjustmentPayload extends ReviewStageAdjustmentPreviewPayload {
  expected_completed_count: number
  note?: string
}

export interface ReviewStageAdjustmentResponse {
  ok: boolean
  palace_id: number
  palace_title: string
  previous_completed_count: number
  target_completed_count: number
  total_stage_count: number
  direction: 'forward' | 'backward' | 'reset' | 'unchanged'
  current_stage_label: string | null
  target_stage_label: string | null
  preserved_stage_labels: string[]
  added_stage_labels: string[]
  removed_stage_labels: string[]
  next_stage_label: string | null
  next_review_at: string | null
  mastered: boolean
  needs_practice: boolean
}

export interface PalaceMemoryProjectionNode {
  node_uid: string
  stability_days: number
  retrievability: number
  due_at: string | null
  due: boolean
  state_source: string
  rating: 1 | 2 | 3 | 4 | 5 | null
}

export interface PalaceMemoryProjection {
  palace_id: number
  node_count: number
  mastery_progress: number
  mastery_percent: number
  memory_health: number
  memory_health_percent: number
  mastered_node_count: number
  mastery_horizon_days: number
  due_node_count: number
  overdue_node_count: number
  next_review_at: string | null
  mastered: boolean
  severe_weak_node_count: number
  nodes: PalaceMemoryProjectionNode[]
}

export interface PalaceRatingOperationResult extends PalaceMemoryProjection {
  operation_id: string
  affected_node_count: number
  affected_node_uids?: string[]
  previous_mastery_progress?: number
  current_mastery_progress?: number
  previous_memory_health?: number
  current_memory_health?: number
  undo_available?: boolean
  idempotent?: boolean
}
