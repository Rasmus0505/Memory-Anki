import { request } from "@/shared/api/http"
import type { DashboardQuery, DashboardResponse } from "@/shared/api/contracts"

const warmedDashboardGetCache = new Map<string, Promise<DashboardResponse>>()

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
  const warmed = warmedDashboardGetCache.get(path)
  if (warmed) {
    warmedDashboardGetCache.delete(path)
    return warmed
  }
  return request<DashboardResponse>(path)
}

export function prefetchDashboardApi(query?: DashboardQuery) {
  const path = buildDashboardPath(query)
  if (warmedDashboardGetCache.has(path)) return
  const pending = request<DashboardResponse>(path).catch((error) => {
    warmedDashboardGetCache.delete(path)
    throw error
  })
  warmedDashboardGetCache.set(path, pending)
  void pending.catch(() => {})
}
