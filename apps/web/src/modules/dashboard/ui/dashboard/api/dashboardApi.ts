import { request } from "@/shared/api/http"
import type {
  DashboardHeatmapResponse,
  DashboardResponse,
  WeeklyReport,
} from "@/shared/api/contracts"
import {
  clearPrefetchedPromisesByPrefix,
  consumePrefetchedPromise,
  prefetchPromise,
} from "@/shared/api/promiseWarmupCache"

export function getDashboardApi() {
  const path = '/dashboard'
  return consumePrefetchedPromise(`dashboard:${path}`, () => request<DashboardResponse>(path))
}

export function prefetchDashboardApi() {
  const path = '/dashboard'
  prefetchPromise(`dashboard:${path}`, () => request<DashboardResponse>(path))
}

export function invalidateDashboardApi() {
  clearPrefetchedPromisesByPrefix('dashboard:')
}

export function getDashboardHeatmapApi(days = 182) {
  return request<DashboardHeatmapResponse>(`/dashboard/heatmap?days=${days}`)
}

export interface StudyGoals {
  weekly_review_count: number
}

export function getWeeklyReportApi(offsetWeeks = 1) {
  return request<WeeklyReport>(`/dashboard/weekly-report?offset_weeks=${offsetWeeks}`)
}

export function getStudyGoalsApi() {
  return request<{ items: Record<string, unknown> }>('/profile/client-preferences').then(
    (response) => (response.items?.study_goals as StudyGoals | null) ?? null,
  )
}
