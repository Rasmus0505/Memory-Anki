import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_FREESTYLE_DISPLAY_SETTINGS,
  FREESTYLE_DISPLAY_SETTINGS_STORAGE_KEY,
  readFreestyleDisplaySettings,
  sanitizeFreestyleDisplaySettings,
} from './freestyleDisplaySettings'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'

describe('freestyle display settings', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
  })

  it('sanitizes invalid values to the default', () => {
    expect(sanitizeFreestyleDisplaySettings({ rating_mode: 'false' })).toEqual(DEFAULT_FREESTYLE_DISPLAY_SETTINGS)
    expect(sanitizeFreestyleDisplaySettings(null)).toEqual(DEFAULT_FREESTYLE_DISPLAY_SETTINGS)
    expect(sanitizeFreestyleDisplaySettings({ rating_mode: true })).toEqual({
      rating_mode: true,
      flip_mode: 'free',
    })
    expect(sanitizeFreestyleDisplaySettings({ rating_mode: true, flip_mode: 'focused' })).toEqual({
      rating_mode: true,
      flip_mode: 'focused',
    })
  })

  it('restores a locally stored setting before backend preferences finish loading', () => {
    window.localStorage.setItem(FREESTYLE_DISPLAY_SETTINGS_STORAGE_KEY, JSON.stringify({ rating_mode: false }))

    expect(readFreestyleDisplaySettings()).toEqual({ rating_mode: true, flip_mode: 'free' })
  })
})
