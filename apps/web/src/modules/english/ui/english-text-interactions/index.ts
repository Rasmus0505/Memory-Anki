/**
 * Shared English word/sentence interaction surface for listening + reading.
 * Core lookup/selection logic still lives under english-reading for now;
 * this package is the stable host import path and owns shared chrome.
 */
export { ReadingLookupText as EnglishLookupText } from '@/modules/english-reading/public'
export { EnglishDictionaryFloat } from './EnglishDictionaryFloat'
export {
  LOOKUP_WORD_RE,
  normalizeLookupWord,
  canUseSpeechSynthesis,
  hasActiveTextSelection,
  extractSentenceSelection,
  type DictionaryPanelState,
  type SentenceSelectionPayload,
  type SentenceTranslationPanelState,
  type SentenceTranslationTriggerState,
} from '@/modules/english-reading/public'
export { useEnglishReadingDictionaryInteractions as useEnglishDictionaryLookup } from '@/modules/english-reading/public'
export { useEnglishReadingSentenceTranslationInteractions as useEnglishSentenceSelectionActions } from '@/modules/english-reading/public'
