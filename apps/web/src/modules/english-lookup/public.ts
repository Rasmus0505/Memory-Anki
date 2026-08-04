/**
 * Public surface for module `english-lookup`.
 * Saladict-style lookup (Vocabulary.com + Cambridge + Google Translate).
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
} from './normalize'
export type {
  EnglishLookupSearchResponse,
  EnglishLookupPanelState,
  LookupAnchorState,
  VocabularyResult,
  CambridgeResult,
  GoogleTranslateResult,
  DictCardHeight,
} from './types'
export {
  LOOKUP_PANEL_WIDTH,
  VOCAB_HALF_PX,
  CAMBRIDGE_HALF_PX,
  MAX_LOOKUP_WORDS,
} from './types'
