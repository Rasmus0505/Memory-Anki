import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (event: { matches: boolean }) => void

function createMatchMediaMock(initialMatches: boolean) {
  const listeners = new Set<Listener>()
  let matches = initialMatches

  const mediaQueryList = {
    get matches() {
      return matches
    },
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
    addListener: (listener: Listener) => listeners.add(listener),
    removeListener: (listener: Listener) => listeners.delete(listener),
    dispatchEvent: () => true,
  }

  return {
    mediaQueryList,
    listenerCount: () => listeners.size,
    setMatches(next: boolean) {
      matches = next
      listeners.forEach((listener) => listener({ matches: next }))
    },
  }
}

/**
 * The module keeps one shared MediaQueryList for the whole app, so each test needs
 * a fresh module instance to observe attach/detach independently.
 */
async function loadModule(initialMatches: boolean) {
  const mock = createMatchMediaMock(initialMatches)
  window.matchMedia = vi.fn(() => mock.mediaQueryList) as unknown as typeof window.matchMedia
  vi.resetModules()
  const module = await import('@/shared/lib/prefersReducedMotion')
  return { ...mock, module }
}

describe('prefersReducedMotion', () => {
  const originalMatchMedia = window.matchMedia

  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  beforeEach(() => {
    vi.resetModules()
  })

  it('reads the current preference synchronously', async () => {
    const on = await loadModule(true)
    expect(on.module.prefersReducedMotion()).toBe(true)

    const off = await loadModule(false)
    expect(off.module.prefersReducedMotion()).toBe(false)
  })

  it('reacts to the setting changing while the app is open', async () => {
    const media = await loadModule(false)
    const { usePrefersReducedMotion } = media.module

    const { result } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(false)

    // The whole point of the consolidation: toggling the OS setting must take
    // effect immediately, without a page reload.
    act(() => media.setMatches(true))
    expect(result.current).toBe(true)

    act(() => media.setMatches(false))
    expect(result.current).toBe(false)
  })

  it('picks up a preference that was already on at mount', async () => {
    const media = await loadModule(true)
    const { result } = renderHook(() => media.module.usePrefersReducedMotion())
    expect(result.current).toBe(true)
  })

  it('shares one subscription across consumers and releases it when all unmount', async () => {
    const media = await loadModule(false)
    const { usePrefersReducedMotion } = media.module

    const first = renderHook(() => usePrefersReducedMotion())
    const second = renderHook(() => usePrefersReducedMotion())

    // Two consumers, one browser listener.
    expect(media.listenerCount()).toBe(1)

    act(() => media.setMatches(true))
    expect(first.result.current).toBe(true)
    expect(second.result.current).toBe(true)

    first.unmount()
    // Still one consumer left, so the shared listener stays attached.
    expect(media.listenerCount()).toBe(1)

    second.unmount()
    // Nothing is listening any more; the module must not leak the listener.
    expect(media.listenerCount()).toBe(0)
  })
})
