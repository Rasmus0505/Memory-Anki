import { request } from "@/shared/api/http"
import type { DashboardQuery, DashboardResponse } from "@/shared/api/contracts"
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
