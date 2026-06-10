import type { MindMapDoc } from './mindmap'
import type { ReviewPalaceSummary, ReviewQueueChapter, ReviewStageSummary } from './review'

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
  current_review_type?: string | null
  is_empty: boolean
  is_virtual_default?: boolean
}
export interface MiniPalaceSummary {
  id: number
  palace_id: number
  name: string
  node_uids: string[]
  node_count: number
  sort_order: number
  created_at: string | null
  updated_at: string | null
  is_empty: boolean
}
export interface PalaceListItem {
  id: number
  title: string
  description: string
  mastered: boolean
  needs_practice?: boolean
  focus_node_uids?: string[]
  focus_count?: number
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
export interface PalaceFocusSessionResponse {
  palace: ReviewPalaceSummary
  editor_doc: MindMapDoc | string | null
  focus_node_uids: string[]
  focus_count: number
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
    focus_node_uids?: string[]
    focus_count?: number
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
export interface SessionProgressSnapshot {
  id: number
  session_kind: "practice" | "review" | "segment_practice" | "segment_review" | "focus_practice"
  palace_id: number | null
  review_schedule_id: number | null
  palace_segment_id: number | null
  palace_segment_review_schedule_id: number | null
  reveal_map: Record<string, "hidden" | "placeholder" | "revealed">
  red_node_ids: string[]
  completed: boolean
  updated_at: string | null
}
