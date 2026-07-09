import { request } from '@/shared/api/http'
import type { GlobalSearchResponse } from '@/shared/api/contracts'

export function globalSearchApi(query: string, limit = 8) {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  return request<GlobalSearchResponse>(`/search?${params.toString()}`)
}
