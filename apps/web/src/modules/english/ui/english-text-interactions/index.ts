/**
 * Shared English word interaction surface.
 * Dual-dictionary lookup lives in `english-lookup`.
 */
export { EnglishInteractiveText } from './EnglishInteractiveText'
export {
  useEnglishLookup,
  EnglishLookupPanel,
  LookupAnchor,
  LOOKUP_PANEL_WIDTH,
  normalizeLookupQuery,
  type EnglishLookupController,
} from '@/modules/english-lookup/public'
