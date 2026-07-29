/** Saladict-style dual-dictionary lookup contracts (backend english-lookup). */

export type DictCardHeight = 'COLLAPSE' | 'HALF' | 'FULL'

export type EngineStatus = 'idle' | 'searching' | 'ok' | 'empty' | 'error'

export interface VocabularyResult {
  status: EngineStatus
  short: string | null
  long: string | null
  error: string | null
  sourceUrl: string | null
}

export interface CambridgeEntry {
  id: string
  html: string
}

export interface CambridgeResult {
  status: EngineStatus
  entries: CambridgeEntry[]
  audio: { us: string | null; uk: string | null }
  error: string | null
  sourceUrl: string | null
}

export interface GoogleTranslateResult {
  status: EngineStatus
  translation: string
  detectedLanguage: string | null
  error: string | null
  sourceUrl: string | null
}

export interface EnglishLookupSearchResponse {
  query: string
  wordCount: number
  vocabulary: VocabularyResult
  cambridge: CambridgeResult
  google: GoogleTranslateResult
  audio: { us: string | null; uk: string | null }
  sourceUrls: {
    vocabulary: string | null
    cambridge: string | null
    google: string | null
  }
}

export interface LookupHistoryItem {
  queryId: number
  query: string
  result: EnglishLookupSearchResponse | null
  error: string | null
}

export interface EnglishLookupPanelState {
  open: boolean
  pinned: boolean
  dragging: boolean
  left: number
  top: number
  width: number
  maxHeight: number
  query: string
  queryId: number
  searchInput: string
  loading: boolean
  result: EnglishLookupSearchResponse | null
  error: string | null
  vocabularyHeight: DictCardHeight
  cambridgeHeight: DictCardHeight
  googleHeight: DictCardHeight
  /** Auto-play once per queryId when audio first becomes available. */
  autoPlayedQueryId: number | null
}

export interface LookupAnchorState {
  visible: boolean
  left: number
  top: number
  query: string
}

export const LOOKUP_PANEL_WIDTH = 380
export const LOOKUP_PANEL_MIN_WIDTH = 320
export const LOOKUP_PANEL_MIN_HEIGHT = 220
export const VOCAB_HALF_PX = 180
export const CAMBRIDGE_HALF_PX = 265
export const MAX_LOOKUP_WORDS = 5
