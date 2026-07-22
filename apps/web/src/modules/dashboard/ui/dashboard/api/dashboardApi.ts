import { request } from "@/shared/api/http"
import type {
  DashboardHeatmapResponse,
  DashboardQuery,
  DashboardResponse,
  WeeklyReport,
} from "@/shared/api/contracts"
import { consumePrefetchedPromise, prefetchPromise } from "@/shared/api/promiseWarmupCache"

function buildDashboardPath(query?: DashboardQuery) {
  const params = new URLSearchParams()
  if (query?.duration_mode) params.set("duration_mode", query.duration_mode)
  if (query?.month) params.set("month", query.month)
  if (query?.start_date) params.set("start_date", query.start_date)
  if (query?.end_date) params.set("end_date", query.end_date)
  const suffix = params.toString() ? `?${params.toString()}` : ""
  return `/dashboard${suffix}`
}

export function getDashboardApi(query?: DashboardQuery) {
  const path = buildDashboardPath(query)
  return consumePrefetchedPromise(`dashboard:${path}`, () => request<DashboardResponse>(path))
}

export function prefetchDashboardApi(query?: DashboardQuery) {
  const path = buildDashboardPath(query)
  prefetchPromise(`dashboard:${path}`, () => request<DashboardResponse>(path))
}

export function getDashboardHeatmapApi(days = 182) {
  return request<DashboardHeatmapResponse>(`/dashboard/heatmap?days=${days}`)
}

export interface StudyGoals {
  weekly_study_minutes: number
  weekly_review_count: number
}

export const DEFAULT_STUDY_GOALS: StudyGoals = {
  weekly_study_minutes: 300,
  weekly_review_count: 20,
}

export function getWeeklyReportApi(offsetWeeks = 1) {
  return request<WeeklyReport>(`/dashboard/weekly-report?offset_weeks=${offsetWeeks}`)
}

export function getStudyGoalsApi() {
  return request<{ items: Record<string, unknown> }>('/profile/client-preferences').then(
    (response) => (response.items?.study_goals as StudyGoals | null) ?? null,
  )
}

export function saveStudyGoalsApi(goals: StudyGoals) {
  return request<{ items: Record<string, unknown> }>('/profile/client-preferences', {
    method: 'PUT',
    body: JSON.stringify({ study_goals: goals }),
    persistence: {
      resourceKey: 'preferences:study-goals',
      coalesceKey: 'preferences:study-goals',
      description: '保存学习目标',
      replayMode: 'auto',
    },
  })
}

export interface ReviewNoteItem {
  id: number
  palace_id: number
  palace_title: string
  review_date: string | null
  note: string
}

export function getRecentReviewNotesApi(limit = 10) {
  return request<{ items: ReviewNoteItem[] }>(`/review/notes?limit=${limit}`)
}
