import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetWindowLayoutMemoryForTest } from '@/shared/preferences/windowLayoutMemory'
import {
  DEFAULT_LOOKUP_CARD_PREFERENCES,
  ENGLISH_LOOKUP_CARD_STATE_KEY,
  readLookupCardPreferences,
  readLookupPanelSize,
  writeLookupCardPreferences,
  writeLookupPanelSize,
} from './preferences'

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height })
}

describe('english lookup card preferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetWindowLayoutMemoryForTest()
  })

  afterEach(() => {
    resetWindowLayoutMemoryForTest()
    setViewport(1024, 768)
  })

  it('restores the last selected height for both dictionaries', () => {
    writeLookupCardPreferences({
      oxfordHeight: 'FULL',
      bingHeight: 'COLLAPSE',
      collinsHeight: 'FULL',
    })

    expect(readLookupCardPreferences()).toEqual({
      oxfordHeight: 'FULL',
      bingHeight: 'COLLAPSE',
      collinsHeight: 'FULL',
    })
  })

  it('falls back safely when persisted data is invalid', () => {
    window.localStorage.setItem(ENGLISH_LOOKUP_CARD_STATE_KEY, '{bad json')
    expect(readLookupCardPreferences()).toEqual(DEFAULT_LOOKUP_CARD_PREFERENCES)
  })

  it('remembers a manual panel size as a viewport ratio', () => {
    setViewport(1200, 800)
    writeLookupPanelSize(600, 400)
    setViewport(400, 300)

    expect(readLookupPanelSize({ width: 380, height: 220 })).toEqual({ width: 200, height: 150 })
    setViewport(1200, 800)
    expect(readLookupPanelSize({ width: 380, height: 220 })).toEqual({ width: 600, height: 400 })
  })
})
