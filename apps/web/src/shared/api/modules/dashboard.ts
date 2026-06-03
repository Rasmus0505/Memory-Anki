import { request } from "@/shared/api/http"
import type { DashboardQuery, DashboardResponse } from "@/shared/api/contracts"

export function getDashboardApi(query?: DashboardQuery) {
  const params = new URLSearchParams()
  if (query?.duration_mode) params.set('duration_mode', query.duration_mode)
  if (query?.month) params.set('month', query.month)
  if (query?.start_date) params.set('start_date', query.start_date)
  if (query?.end_date) params.set('end_date', query.end_date)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  return request<DashboardResponse>(`/dashboard${suffix}`)
}
