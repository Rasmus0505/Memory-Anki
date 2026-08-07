import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_FLIP_CARD_REVEAL_CONFIG,
  FLIP_CARD_REVEAL_SETTINGS_STORAGE_KEY,
  readFlipCardRevealSettings,
  resetFlipCardRevealSettings,
  sanitizeFlipCardRevealConfig,
  useFlipCardRevealSettings,
  writeFlipCardRevealSettings,
} from './flipCardRevealSettings'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'

describe('flipCardRevealSettings', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
  })

  it('uses the grouped two-phase default and sanitizes invalid values', () => {
    expect(readFlipCardRevealSettings()).toEqual(DEFAULT_FLIP_CARD_REVEAL_CONFIG)
    expect(sanitizeFlipCardRevealConfig({ granularity: 'invalid', stage: 'invalid' })).toEqual(
      DEFAULT_FLIP_CARD_REVEAL_CONFIG,
    )
    expect(sanitizeFlipCardRevealConfig({ granularity: 'single', stage: 'direct' })).toEqual({
      granularity: 'single',
      stage: 'direct',
    })
  })

  it('writes sanitized settings and resets to the grouped default', () => {
    expect(writeFlipCardRevealSettings({ granularity: 'single', stage: 'direct' })).toEqual({
      granularity: 'single',
      stage: 'direct',
    })
    expect(readFlipCardRevealSettings()).toEqual({ granularity: 'single', stage: 'direct' })
    expect(window.localStorage.getItem(FLIP_CARD_REVEAL_SETTINGS_STORAGE_KEY)).toBeNull()
    expect(resetFlipCardRevealSettings()).toEqual(DEFAULT_FLIP_CARD_REVEAL_CONFIG)
  })

  it('updates mounted sessions through the shared preference event', () => {
    const { result } = renderHook(() => useFlipCardRevealSettings())

    act(() => {
      result.current.updateSettings({ granularity: 'single', stage: 'direct' })
    })

    expect(result.current.settings).toEqual({ granularity: 'single', stage: 'direct' })
  })
})

