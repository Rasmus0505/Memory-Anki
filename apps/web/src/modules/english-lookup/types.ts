/** Saladict-style lookup contracts (backend english-lookup). */

export type DictCardHeight = 'COLLAPSE' | 'HALF' | 'FULL'

export type EngineStatus = 'idle' | 'searching' | 'ok' | 'empty' | 'error'

export type LookupDictId = 'oxford' | 'bing' | 'collins'

export interface HtmlDictEntry {
  id: string
  html: string
}

export interface HtmlDictResult {
  status: EngineStatus
  entries: HtmlDictEntry[]
  audio: { us: string | null; uk: string | null }
  error: string | null
  sourceUrl: string | null
}

/** @deprecated Use HtmlDictResult */
export type CambridgeResult = HtmlDictResult
export type CambridgeEntry = HtmlDictEntry

export interface MachineTranslateResult {
  status: EngineStatus
  translation: string
  detectedLanguage: string | null
  error: string | null
  sourceUrl: string | null
}

/** @deprecated Use MachineTranslateResult */
export type GoogleTranslateResult = MachineTranslateResult

export interface EnglishLookupSearchResponse {
  query: string
  wordCount: number
  oxford: HtmlDictResult
  bing: HtmlDictResult
  collins: HtmlDictResult
  audio: { us: string | null; uk: string | null }
  sourceUrls: {
    oxford: string | null
    bing: string | null
    collins: string | null
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
  oxfordHeight: DictCardHeight
  bingHeight: DictCardHeight
  collinsHeight: DictCardHeight
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
export const OXFORD_HALF_PX = 265
export const BING_HALF_PX = 240
export const COLLINS_HALF_PX = 265
export const CAMBRIDGE_HALF_PX = OXFORD_HALF_PX
export const MAX_LOOKUP_WORDS = 5
