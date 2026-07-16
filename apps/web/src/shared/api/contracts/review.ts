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
  editor_doc: MindMapDoc | string | null
  pegs: Array<{ id: number; name: string; content: string; children: unknown[] }>
  attachments: Array<{ id: number; filename: string; original_name: string }>
  chapters: ReviewQueueChapter[]
}
export interface FsrsRatingCounts {
  忘记: number
  困难: number
  记得: number
  轻松: number
}
export interface ReviewMemorySummary {
  mastery_progress: number
  mastery_percent: number
  memory_health: number
  memory_health_percent: number
  due_node_count: number
  overdue_node_count: number
  next_review_at: string | null
}
export interface ReviewScheduleSummary {
  id: string | number
  session_id?: string | null
  palace_id: number
  scheduled_date?: string | null
  due_at: string | null
  next_due_at?: string | null
  interval_days?: number | null
  algorithm_used: string
  completed: boolean
  completed_at?: string | null
  review_number?: number
  review_type: string
  due_node_count: number
  overdue_node_count: number
  frozen_due_node_uids?: string[]
  memory_summary?: ReviewMemorySummary
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
  stats: { total: number; review_count: number; review_duration_seconds: number }
  chapter: ReviewQueueChapter | null
  reviews: ReviewScheduleSummary[]
  later_today_reviews: ReviewScheduleSummary[]
}
export interface ReviewCompletionSummary extends ReviewMemorySummary {
  scope_node_count: number
  rated_node_count: number
  unrated_due_node_count: number
  rating_counts: FsrsRatingCounts
  remaining_due_node_count: number
}
export interface ReviewSessionSubmitResponse extends ReviewCompletionSummary {
  ok: boolean
  completion_mode: "manual_complete" | "auto_complete" | string
  score: number
  next_id: string | number | null
  review_log_id: number
  palace_id: number
  chapter_id: number | null
  duration_seconds: number
}
export interface MasteryTrendPoint {
  at: string
  mastery_progress: number
  mastery_percent: number
}

export interface MasteryTrendResponse {
  palace_id: number
  points: MasteryTrendPoint[]
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
