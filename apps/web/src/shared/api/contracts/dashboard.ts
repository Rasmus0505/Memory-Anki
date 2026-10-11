import type { ChapterSummary, SubjectSummary } from './palace'

export interface DashboardReviewUnit {
  id: string
  palace_id: number
  palace_title: string
  unit_title: string
  due_date: string
  interval_days: number
  node_count: number
  overdue: boolean
}

export interface DashboardSnapshotMetadata {
  status: 'ready' | 'stale' | 'pending'
  generated_at: string | null
  scope: string
  refresh_pending: boolean
}

export interface DashboardResponse {
  snapshot?: DashboardSnapshotMetadata
  due_count: number
  overdue_count: number
  due_later_today_count: number
  reviews: DashboardReviewUnit[]
  stats: {
    total: number
    review_count: number
  }
  english_stats: {
    total_courses: number
    unfinished_courses: number
    completed_courses: number
  }
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
export interface HeatmapDayItem {
  date: string
  review_count: number
  active: boolean
}

export interface DashboardHeatmapResponse {
  start_date: string
  end_date: string
  items: HeatmapDayItem[]
  current_streak: number
  longest_streak: number
  active_day_count: number
}

export interface WeeklyReport {
  week_start: string
  week_end: string
  review_count: number
  average_score: number
  new_palace_count: number
}
