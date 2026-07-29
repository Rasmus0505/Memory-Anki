/**
 * Shared English word interaction surface.
 * Dual-dictionary lookup lives in `english-lookup`.
 */
export { ReadingLookupText as EnglishLookupText } from '@/modules/english-reading/public'
export { EnglishInteractiveText } from './EnglishInteractiveText'
export {
  useEnglishLookup,
  EnglishLookupPanel,
  LookupAnchor,
  LOOKUP_PANEL_WIDTH,
  normalizeLookupQuery,
  type EnglishLookupController,
} from '@/modules/english-lookup/public'
/** @deprecated Prefer useEnglishLookup. */
export { useEnglishLookup as useEnglishDictionaryLookup } from '@/modules/english-lookup/public'
