import type { DictCardHeight } from './types'

export const ENGLISH_LOOKUP_CARD_STATE_KEY = 'memory-anki.english-lookup.card-state'

export interface EnglishLookupCardPreferences {
  vocabularyHeight: DictCardHeight
  cambridgeHeight: DictCardHeight
  googleHeight: DictCardHeight
}

export const DEFAULT_LOOKUP_CARD_PREFERENCES: EnglishLookupCardPreferences = {
  vocabularyHeight: 'HALF',
  cambridgeHeight: 'HALF',
  googleHeight: 'HALF',
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
      vocabularyHeight: isCardHeight(parsed.vocabularyHeight)
        ? parsed.vocabularyHeight
        : DEFAULT_LOOKUP_CARD_PREFERENCES.vocabularyHeight,
      cambridgeHeight: isCardHeight(parsed.cambridgeHeight)
        ? parsed.cambridgeHeight
        : DEFAULT_LOOKUP_CARD_PREFERENCES.cambridgeHeight,
      googleHeight: isCardHeight(parsed.googleHeight)
        ? parsed.googleHeight
        : DEFAULT_LOOKUP_CARD_PREFERENCES.googleHeight,
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
