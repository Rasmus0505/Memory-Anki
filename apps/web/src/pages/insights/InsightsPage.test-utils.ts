import type { DashboardResponse } from '@/shared/api/contracts'

export function buildDashboardResponse(
  payload: Partial<DashboardResponse> & {
    stats?: Partial<DashboardResponse['stats']>
    english_stats?: Partial<DashboardResponse['english_stats']>
  },
): DashboardResponse {
  const { stats, english_stats, ...rest } = payload
  return {
    due_count: 0,
    due_later_today_count: 0,
    needs_practice_count: 0,
    reviews: [],
    stats: {
      total: 0,
      review_count: 0,
      review_duration_seconds: 0,
      ...stats,
    },
    today_review_duration_seconds: 0,
    weekly_review_duration_seconds: 0,
    today_total_review_duration_seconds: 0,
    monthly_total_review_duration_seconds: 0,
    selected_total_review_duration_seconds: 0,
    weekly_total_review_duration_seconds: 0,
    weekly_formal_review_duration_seconds: 0,
    english_stats: {
      total_courses: 0,
      unfinished_courses: 0,
      completed_courses: 0,
      today_reading_seconds: 0,
      weekly_reading_seconds: 0,
      total_reading_seconds: 0,
      today_practice_seconds: 0,
      weekly_practice_seconds: 0,
      total_practice_seconds: 0,
      today_total_seconds: 0,
      weekly_total_seconds: 0,
      total_seconds: 0,
      ...english_stats,
    },
    today_learning_palaces: [],
    today_new_palace_count: 0,
    today_new_palaces: [],
    recent_palaces: [],
    ...rest,
  }
}
