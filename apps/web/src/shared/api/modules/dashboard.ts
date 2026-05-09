import { request } from "@/shared/api/http"
import type { DashboardResponse } from "@/shared/api/contracts"

export function getDashboardApi() {
  return request<DashboardResponse>("/dashboard")
}
