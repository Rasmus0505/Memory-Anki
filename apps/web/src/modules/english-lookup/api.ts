import { request } from '@/shared/api/http'
import type {
  CambridgeResult,
  EnglishLookupSearchResponse,
  GoogleTranslateResult,
  VocabularyResult,
} from './types'

export function searchEnglishLookupApi(query: string) {
  const q = encodeURIComponent(query)
  return request<EnglishLookupSearchResponse>(`/english-lookup/search?q=${q}`)
}

export function translateEnglishLookupApi(query: string) {
  return request<GoogleTranslateResult>(`/english-lookup/translate?q=${encodeURIComponent(query)}`)
}

export function lookupVocabularyApi(query: string) {
  return request<VocabularyResult>(`/english-lookup/vocabulary?q=${encodeURIComponent(query)}`)
}

export function lookupCambridgeApi(query: string) {
  return request<CambridgeResult>(`/english-lookup/cambridge?q=${encodeURIComponent(query)}`)
}
