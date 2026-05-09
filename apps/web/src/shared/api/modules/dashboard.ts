import { request } from "@/shared/api/http"

export function getDashboardApi() {
  return request<any>("/dashboard")
}
