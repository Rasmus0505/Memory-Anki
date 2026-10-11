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

export const DEFAULT_STUDY_GOALS: StudyGoals = {
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
