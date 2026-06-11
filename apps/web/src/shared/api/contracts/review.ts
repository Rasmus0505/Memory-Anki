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
  focus_node_uids?: string[]
  focus_count?: number
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
export interface ReviewSessionSubmitResponse {
  ok: boolean
  completion_mode: "manual_complete" | "auto_complete" | string
  score: number
  next_id: number | null
  mastered: boolean
}
