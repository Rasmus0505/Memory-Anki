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
    overdue_count: 0,
    due_later_today_count: 0,
    reviews: [],
    stats: {
      total: 0,
      review_count: 0,
      ...stats,
    },
    english_stats: {
      total_courses: 0,
      unfinished_courses: 0,
      completed_courses: 0,
      ...english_stats,
    },
    today_new_palace_count: 0,
    today_new_palaces: [],
    recent_palaces: [],
    ...rest,
  }
}
