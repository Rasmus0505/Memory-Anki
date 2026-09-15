import type { DictCardHeight } from './types'

export const ENGLISH_LOOKUP_CARD_STATE_KEY = 'memory-anki.english-lookup.card-state'

export interface EnglishLookupCardPreferences {
  oxfordHeight: DictCardHeight
  bingHeight: DictCardHeight
  collinsHeight: DictCardHeight
}

export const DEFAULT_LOOKUP_CARD_PREFERENCES: EnglishLookupCardPreferences = {
  oxfordHeight: 'HALF',
  bingHeight: 'HALF',
  collinsHeight: 'HALF',
}

function isCardHeight(value: unknown): value is DictCardHeight {
  return value === 'COLLAPSE' || value === 'HALF' || value === 'FULL'
}

export function readLookupCardPreferences(): EnglishLookupCardPreferences {
  if (typeof window === 'undefined') return DEFAULT_LOOKUP_CARD_PREFERENCES
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(ENGLISH_LOOKUP_CARD_STATE_KEY) ?? '{}',
    ) as Partial<EnglishLookupCardPreferences>
    return {
      oxfordHeight: isCardHeight(parsed.oxfordHeight)
        ? parsed.oxfordHeight
        : DEFAULT_LOOKUP_CARD_PREFERENCES.oxfordHeight,
      bingHeight: isCardHeight(parsed.bingHeight)
        ? parsed.bingHeight
        : DEFAULT_LOOKUP_CARD_PREFERENCES.bingHeight,
      collinsHeight: isCardHeight(parsed.collinsHeight)
        ? parsed.collinsHeight
        : DEFAULT_LOOKUP_CARD_PREFERENCES.collinsHeight,
    }
  } catch {
    return DEFAULT_LOOKUP_CARD_PREFERENCES
  }
}

export function writeLookupCardPreferences(preferences: EnglishLookupCardPreferences) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      ENGLISH_LOOKUP_CARD_STATE_KEY,
      JSON.stringify(preferences),
    )
  } catch {
    // A storage failure must not block dictionary interaction.
  }
}
