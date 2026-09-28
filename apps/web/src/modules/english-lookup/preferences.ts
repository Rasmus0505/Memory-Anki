import {
  currentViewportSize,
  pixelsFromRatio,
  readEnglishLookupMemory,
  viewportRatio,
  writeEnglishLookupMemory,
} from '@/shared/preferences/windowLayoutMemory'
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

function cardPreferencesFromUnknown(parsed: {
  oxfordHeight?: unknown
  bingHeight?: unknown
  collinsHeight?: unknown
} | null | undefined): EnglishLookupCardPreferences {
  return {
    oxfordHeight: isCardHeight(parsed?.oxfordHeight)
      ? parsed.oxfordHeight
      : DEFAULT_LOOKUP_CARD_PREFERENCES.oxfordHeight,
    bingHeight: isCardHeight(parsed?.bingHeight)
      ? parsed.bingHeight
      : DEFAULT_LOOKUP_CARD_PREFERENCES.bingHeight,
    collinsHeight: isCardHeight(parsed?.collinsHeight)
      ? parsed.collinsHeight
      : DEFAULT_LOOKUP_CARD_PREFERENCES.collinsHeight,
  }
}

export function readLookupCardPreferences(): EnglishLookupCardPreferences {
  const remembered = readEnglishLookupMemory()
  if (remembered && (
    isCardHeight(remembered.oxfordHeight)
    || isCardHeight(remembered.bingHeight)
    || isCardHeight(remembered.collinsHeight)
  )) {
    return cardPreferencesFromUnknown(remembered)
  }
  if (typeof window === 'undefined') return DEFAULT_LOOKUP_CARD_PREFERENCES
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(ENGLISH_LOOKUP_CARD_STATE_KEY) ?? '{}',
    ) as Partial<EnglishLookupCardPreferences>
    return cardPreferencesFromUnknown(parsed)
  } catch {
    return DEFAULT_LOOKUP_CARD_PREFERENCES
  }
}

export function writeLookupCardPreferences(preferences: EnglishLookupCardPreferences) {
  const current = readEnglishLookupMemory()
  writeEnglishLookupMemory({
    widthRatio: current?.widthRatio ?? null,
    heightRatio: current?.heightRatio ?? null,
    oxfordHeight: preferences.oxfordHeight,
    bingHeight: preferences.bingHeight,
    collinsHeight: preferences.collinsHeight,
  })
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

export function readLookupPanelSize(fallback: { width: number; height: number }) {
  const remembered = readEnglishLookupMemory()
  const viewport = currentViewportSize()
  return {
    width: remembered?.widthRatio == null
      ? fallback.width
      : pixelsFromRatio(remembered.widthRatio, viewport.width),
    height: remembered?.heightRatio == null
      ? fallback.height
      : pixelsFromRatio(remembered.heightRatio, viewport.height),
  }
}

export function writeLookupPanelSize(width: number, height: number) {
  const current = readEnglishLookupMemory()
  const cards = readLookupCardPreferences()
  const viewport = currentViewportSize()
  writeEnglishLookupMemory({
    widthRatio: viewportRatio(width, viewport.width, 0.05, 1.5),
    heightRatio: viewportRatio(height, viewport.height, 0.05, 1.5),
    oxfordHeight: current?.oxfordHeight ?? cards.oxfordHeight,
    bingHeight: current?.bingHeight ?? cards.bingHeight,
    collinsHeight: current?.collinsHeight ?? cards.collinsHeight,
  })
}
