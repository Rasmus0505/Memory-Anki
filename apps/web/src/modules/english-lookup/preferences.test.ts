import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_LOOKUP_CARD_PREFERENCES,
  ENGLISH_LOOKUP_CARD_STATE_KEY,
  readLookupCardPreferences,
  writeLookupCardPreferences,
} from './preferences'

describe('english lookup card preferences', () => {
  beforeEach(() => window.localStorage.clear())

  it('restores the last selected height for both dictionaries', () => {
    writeLookupCardPreferences({
      vocabularyHeight: 'COLLAPSE',
      cambridgeHeight: 'FULL',
      googleHeight: 'COLLAPSE',
    })

    expect(readLookupCardPreferences()).toEqual({
      vocabularyHeight: 'COLLAPSE',
      cambridgeHeight: 'FULL',
      googleHeight: 'COLLAPSE',
    })
  })

  it('falls back safely when persisted data is invalid', () => {
    window.localStorage.setItem(ENGLISH_LOOKUP_CARD_STATE_KEY, '{bad json')
    expect(readLookupCardPreferences()).toEqual(DEFAULT_LOOKUP_CARD_PREFERENCES)
  })
})
