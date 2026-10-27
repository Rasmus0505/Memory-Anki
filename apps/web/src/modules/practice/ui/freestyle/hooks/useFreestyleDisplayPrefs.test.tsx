import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FREESTYLE_DISPLAY_SETTINGS_UPDATED_EVENT,
  saveFreestyleDisplaySettings,
  type FreestyleDisplaySettings,
} from '@/modules/practice/public'
import { emitAppEvent } from '@/shared/events/appEvents'
import { useFreestyleDisplayPrefs } from './useFreestyleDisplayPrefs'

const settings: FreestyleDisplaySettings = {
  rating_mode: true,
  flip_mode: 'free',
  auto_advance: false,
  rating_scope: 'unit',
  mindmap_zoom: 1.2,
  mindmap_zoom_phone: 0.7,
}

vi.mock('@/modules/practice/public', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/practice/public')>()
  return {
    ...actual,
    readFreestyleDisplaySettings: () => settings,
    saveFreestyleDisplaySettings: vi.fn((patch: Partial<FreestyleDisplaySettings>) => ({
      ...settings,
      ...patch,
    })),
  }
})

function stubViewport(isNarrow: boolean) {
  let narrow = isNarrow
  const listeners = new Set<(event: { matches: boolean }) => void>()
  window.matchMedia = vi.fn((query: string) => ({
    get matches() {
      return query.includes('max-width: 767px') ? narrow : false
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
      listeners.delete(listener)
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
  return {
    setNarrow(next: boolean) {
      narrow = next
      listeners.forEach((listener) => listener({ matches: next }))
    },
  }
}

describe('useFreestyleDisplayPrefs', () => {
  beforeEach(() => {
    vi.mocked(saveFreestyleDisplaySettings).mockClear()
  })

  it('uses the desktop zoom slot on a wide viewport', () => {
    stubViewport(false)
    const { result } = renderHook(() => useFreestyleDisplayPrefs())

    expect(result.current.mindmapZoom).toBe(1.2)
    act(() => result.current.updateMindmapZoom(1.4))
    expect(saveFreestyleDisplaySettings).toHaveBeenCalledWith({ mindmap_zoom: 1.4 })
  })

  it('uses the phone zoom slot on a narrow viewport', () => {
    stubViewport(true)
    const { result } = renderHook(() => useFreestyleDisplayPrefs())

    expect(result.current.mindmapZoom).toBe(0.7)
    act(() => result.current.updateMindmapZoom(0.9))
    expect(saveFreestyleDisplaySettings).toHaveBeenCalledWith({ mindmap_zoom_phone: 0.9 })
  })

  it('leaves a phone without a zoom preference unset so the per-card fit runs', () => {
    stubViewport(true)
    settings.mindmap_zoom_phone = null
    const { result } = renderHook(() => useFreestyleDisplayPrefs())

    expect(result.current.mindmapZoom).toBeUndefined()
    settings.mindmap_zoom_phone = 0.7
  })

  it('switches slots when the window crosses the phone width while open', () => {
    const media = stubViewport(false)
    const { result } = renderHook(() => useFreestyleDisplayPrefs())
    expect(result.current.mindmapZoom).toBe(1.2)

    act(() => media.setNarrow(true))
    expect(result.current.mindmapZoom).toBe(0.7)

    act(() => media.setNarrow(false))
    expect(result.current.mindmapZoom).toBe(1.2)
  })

  it('follows preference updates from another surface', () => {
    stubViewport(false)
    const { result } = renderHook(() => useFreestyleDisplayPrefs())

    act(() => {
      emitAppEvent(FREESTYLE_DISPLAY_SETTINGS_UPDATED_EVENT, { ...settings, mindmap_zoom: 0.4 })
    })
    expect(result.current.mindmapZoom).toBe(0.4)
  })
})
