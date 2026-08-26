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
      auto_advance: false,
      rating_scope: 'unit',
      mindmap_zoom: 0.99,
    })
    expect(sanitizeFreestyleDisplaySettings({ rating_mode: true, flip_mode: 'focused' })).toEqual({
      rating_mode: true,
      flip_mode: 'focused',
      auto_advance: false,
      rating_scope: 'unit',
      mindmap_zoom: 0.99,
    })
  })

  it('keeps auto-advance off unless it was explicitly enabled', () => {
    // Opt-in: the learner keeps control of pace until they ask for flow.
    expect(sanitizeFreestyleDisplaySettings({}).auto_advance).toBe(false)
    expect(sanitizeFreestyleDisplaySettings({ auto_advance: 'yes' }).auto_advance).toBe(false)
    expect(sanitizeFreestyleDisplaySettings({ auto_advance: true }).auto_advance).toBe(true)
  })

  it('restores a locally stored setting before backend preferences finish loading', () => {
    window.localStorage.setItem(
      FREESTYLE_DISPLAY_SETTINGS_STORAGE_KEY,
      JSON.stringify({ rating_mode: false, auto_advance: true }),
    )

    expect(readFreestyleDisplaySettings()).toEqual({
      rating_mode: true,
      flip_mode: 'free',
      auto_advance: true,
      rating_scope: 'unit',
      mindmap_zoom: 0.99,
    })
  })

  it('keeps an explicit palace rating scope', () => {
    expect(sanitizeFreestyleDisplaySettings({ rating_scope: 'palace' }).rating_scope).toBe('palace')
    expect(sanitizeFreestyleDisplaySettings({ rating_scope: 'section' }).rating_scope).toBe('unit')
  })

  it('keeps valid mind-map zoom and clamps finite values to the canvas bounds', () => {
    expect(sanitizeFreestyleDisplaySettings({ mindmap_zoom: 0.76 }).mindmap_zoom).toBe(0.76)
    expect(sanitizeFreestyleDisplaySettings({ mindmap_zoom: 0.12 }).mindmap_zoom).toBe(0.12)
    expect(sanitizeFreestyleDisplaySettings({ mindmap_zoom: 1.4 }).mindmap_zoom).toBe(1.4)
    expect(sanitizeFreestyleDisplaySettings({ mindmap_zoom: 0.01 }).mindmap_zoom).toBe(0.12)
    expect(sanitizeFreestyleDisplaySettings({ mindmap_zoom: 2 }).mindmap_zoom).toBe(1.4)
  })

  it('falls back to the default zoom for absent or non-finite values', () => {
    expect(sanitizeFreestyleDisplaySettings({}).mindmap_zoom).toBe(0.99)
    expect(sanitizeFreestyleDisplaySettings({ mindmap_zoom: '0.8' }).mindmap_zoom).toBe(0.99)
    expect(sanitizeFreestyleDisplaySettings({ mindmap_zoom: Number.NaN }).mindmap_zoom).toBe(0.99)
    expect(sanitizeFreestyleDisplaySettings({ mindmap_zoom: Infinity }).mindmap_zoom).toBe(0.99)
  })
})
