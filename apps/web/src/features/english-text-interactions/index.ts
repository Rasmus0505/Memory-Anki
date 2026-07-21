/**
 * Shared English word/sentence interaction surface for listening + reading.
 * Core lookup/selection logic still lives under english-reading for now;
 * this package is the stable host import path and owns shared chrome.
 */
export { ReadingLookupText as EnglishLookupText } from '@/features/english-reading/components/EnglishReadingText'
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
} from '@/features/english-reading/model/englishReadingInteractions'
export { useEnglishReadingDictionaryInteractions as useEnglishDictionaryLookup } from '@/features/english-reading/hooks/useEnglishReadingDictionaryInteractions'
export { useEnglishReadingSentenceTranslationInteractions as useEnglishSentenceSelectionActions } from '@/features/english-reading/hooks/useEnglishReadingSentenceTranslationInteractions'
