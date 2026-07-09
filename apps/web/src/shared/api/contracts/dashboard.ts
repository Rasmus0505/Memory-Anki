import type { ChapterSummary, SubjectSummary } from './palace'
import type { ReviewScheduleSummary } from './review'

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
    today_reading_seconds: number
    weekly_reading_seconds: number
    total_reading_seconds: number
    today_practice_seconds: number
    weekly_practice_seconds: number
    total_practice_seconds: number
    today_total_seconds: number
    weekly_total_seconds: number
    total_seconds: number
  }
  today_learning_palaces: Array<{
    palace_id: number
    palace_title: string
    total_seconds: number
    review_seconds: number
    practice_seconds: number
    quiz_seconds: number
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

export interface HeatmapDayItem {
  date: string
  review_count: number
  study_seconds: number
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
  study_seconds: number
  review_count: number
  average_score: number
  new_palace_count: number
}
