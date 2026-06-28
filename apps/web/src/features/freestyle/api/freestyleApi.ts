import { request } from '@/shared/api/http'
import type {
  FreestyleContentType,
  FreestyleFeedResponse,
  FreestyleRange,
} from '@/shared/api/contracts'

export function getFreestyleFeedApi(params: {
  range: FreestyleRange
  palaceIds?: number[]
  contentTypes?: FreestyleContentType[]
}) {
  const searchParams = new URLSearchParams()
  searchParams.set('range', params.range)
  if (params.range === 'specific_palaces' && params.palaceIds?.length) {
    searchParams.set('palace_ids', params.palaceIds.join(','))
  }
  if (params.contentTypes?.length) {
    searchParams.set('content_types', params.contentTypes.join(','))
  }
  return request<FreestyleFeedResponse>(`/freestyle/feed?${searchParams.toString()}`)
}

