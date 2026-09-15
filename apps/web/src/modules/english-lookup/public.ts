/**
 * Public surface for module `english-lookup`.
 * Saladict-style lookup (Oxford, Bing, Collins) with Youdao pronunciation.
 */
export { useEnglishLookup, type EnglishLookupController } from './useEnglishLookup'
export { EnglishLookupPanel } from './EnglishLookupPanel'
export { LookupAnchor } from './LookupAnchor'
export { getLookupAudioManager, LookupAudioManager } from './audioManager'
export {
  normalizeLookupQuery,
  countLookupWords,
  isValidLookupQuery,
  preferredAudioUrl,
  lookupVoiceUrl,
} from './normalize'
export type {
  EnglishLookupSearchResponse,
  EnglishLookupPanelState,
  LookupAnchorState,
  HtmlDictResult,
  MachineTranslateResult,
  CambridgeResult,
  GoogleTranslateResult,
  DictCardHeight,
  LookupDictId,
} from './types'
export {
  LOOKUP_PANEL_WIDTH,
  OXFORD_HALF_PX,
  BING_HALF_PX,
  COLLINS_HALF_PX,
  CAMBRIDGE_HALF_PX,
  MAX_LOOKUP_WORDS,
} from './types'
