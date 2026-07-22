import { request } from '@/shared/api/http'
import type { MasteryTrendResponse } from '@/shared/api/contracts'

export function getPalaceMasteryTrendApi(palaceId: number) {
  return request<MasteryTrendResponse>(`/review/palaces/${palaceId}/memory/trend`)
}
