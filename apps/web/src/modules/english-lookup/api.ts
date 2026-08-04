import { request } from '@/shared/api/http'
import type {
  CambridgeResult,
  GoogleTranslateResult,
  VocabularyResult,
} from './types'

export function translateEnglishLookupApi(query: string) {
  return request<GoogleTranslateResult>(`/english-lookup/translate?q=${encodeURIComponent(query)}`)
}

export function lookupVocabularyApi(query: string) {
  return request<VocabularyResult>(`/english-lookup/vocabulary?q=${encodeURIComponent(query)}`)
}

export function lookupCambridgeApi(query: string) {
  return request<CambridgeResult>(`/english-lookup/cambridge?q=${encodeURIComponent(query)}`)
}
