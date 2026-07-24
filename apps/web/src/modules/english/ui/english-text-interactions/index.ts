/**
 * Shared English word/sentence interaction surface for listening + reading.
 * Core lookup/selection logic still lives under english-reading for now;
 * this package is the stable host import path and owns shared chrome.
 */
export { ReadingLookupText as EnglishLookupText } from '@/modules/english-reading/public'
export { EnglishDictionaryFloat } from './EnglishDictionaryFloat'
export { EnglishInteractiveText } from './EnglishInteractiveText'
export {
  LOOKUP_WORD_RE,
  DICTIONARY_PANEL_WIDTH,
  SENTENCE_TRANSLATION_TRIGGER_WIDTH,
  SENTENCE_TRANSLATION_TRIGGER_HEIGHT,
  normalizeLookupWord,
  canUseSpeechSynthesis,
  hasActiveTextSelection,
  extractSentenceSelection,
  getDictionaryPartOfSpeechLabel,
  type DictionaryPanelState,
  type SentenceSelectionPayload,
  type SentenceTranslationPanelState,
  type SentenceTranslationTriggerState,
} from '@/modules/english-reading/public'
export { useEnglishReadingDictionaryInteractions as useEnglishDictionaryLookup } from '@/modules/english-reading/public'
export { useEnglishReadingSentenceTranslationInteractions as useEnglishSentenceSelectionActions } from '@/modules/english-reading/public'
