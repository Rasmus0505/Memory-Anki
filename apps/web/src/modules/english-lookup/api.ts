import { request } from '@/shared/api/http'
import type { HtmlDictResult } from './types'

export function lookupOxfordApi(query: string) {
  return request<HtmlDictResult>(`/english-lookup/oxford?q=${encodeURIComponent(query)}`)
}

export function lookupBingApi(query: string) {
  return request<HtmlDictResult>(`/english-lookup/bing?q=${encodeURIComponent(query)}`)
}

export function lookupCollinsApi(query: string) {
  return request<HtmlDictResult>(`/english-lookup/collins?q=${encodeURIComponent(query)}`)
}
