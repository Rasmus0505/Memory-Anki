import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  lookupBingApi,
  lookupCollinsApi,
  lookupOxfordApi,
} from './api'
import { useEnglishLookup } from './useEnglishLookup'

vi.mock('./api', () => ({
  lookupBingApi: vi.fn(),
  lookupCollinsApi: vi.fn(),
  lookupOxfordApi: vi.fn(),
}))
vi.mock('./audioManager', () => ({
  getLookupAudioManager: () => ({ stop: vi.fn(), play: vi.fn() }),
}))

const lookupResult = {
  query: 'memory',
  wordCount: 1,
  oxford: {
    status: 'ok' as const,
    entries: [],
    audio: { us: null, uk: null },
    error: null,
    sourceUrl: null,
  },
  bing: {
    status: 'ok' as const,
    entries: [],
    audio: { us: null, uk: null },
    error: null,
    sourceUrl: null,
  },
  collins: {
    status: 'ok' as const,
    entries: [],
    audio: { us: null, uk: null },
    error: null,
    sourceUrl: null,
  },
  audio: { us: null, uk: null },
  sourceUrls: { oxford: null, bing: null, collins: null },
}

function pointerEvent(type: string, pointerId: number, clientX: number, clientY: number) {
  const event = new Event(type) as PointerEvent
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
  })
  return event
}

describe('useEnglishLookup panel interactions', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.mocked(lookupOxfordApi).mockResolvedValue(lookupResult.oxford)
    vi.mocked(lookupBingApi).mockResolvedValue(lookupResult.bing)
    vi.mocked(lookupCollinsApi).mockResolvedValue(lookupResult.collins)
  })

  it('keeps dimensions stable while dragging and supports corner resize', async () => {
    const { result } = renderHook(() => useEnglishLookup({ isActive: true }))

    act(() => {
      void result.current.runSearch('memory', { left: 100, top: 100, maxHeight: 400 })
    })
    await waitFor(() => expect(result.current.panel.loading).toBe(false))

    act(() => {
      result.current.handleHeaderPointerDown({
        target: document.createElement('div'),
        pointerId: 1,
        clientX: 110,
        clientY: 110,
        preventDefault: vi.fn(),
      } as never)
    })
    act(() => window.dispatchEvent(pointerEvent('pointermove', 1, 160, 180)))

    expect(result.current.panel.left).toBe(150)
    expect(result.current.panel.top).toBe(170)
    expect(result.current.panel.width).toBe(380)
    expect(result.current.panel.maxHeight).toBe(400)

    act(() => window.dispatchEvent(pointerEvent('pointerup', 1, 160, 180)))
    act(() => {
      result.current.handleResizePointerDown('se', {
        pointerId: 2,
        clientX: 530,
        clientY: 570,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: { setPointerCapture: vi.fn() },
      } as never)
    })
    act(() => window.dispatchEvent(pointerEvent('pointermove', 2, 590, 620)))

    expect(result.current.panel.width).toBe(440)
    expect(result.current.panel.maxHeight).toBe(450)
  })

  it('keeps an unpinned lookup panel open when the viewport resizes', async () => {
    const { result } = renderHook(() => useEnglishLookup({ isActive: true }))

    act(() => {
      void result.current.runSearch('memory', { left: 100, top: 100, maxHeight: 400 })
    })
    await waitFor(() => expect(result.current.panel.loading).toBe(false))

    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(result.current.panel.open).toBe(true)
    expect(result.current.panel.query).toBe('memory')
    expect(result.current.panel.searchInput).toBe('memory')
    expect(result.current.panel.result?.oxford.status).toBe('ok')
  })
})
