import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectClientSource } from './clientSource'

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value,
  })
}

afterEach(() => {
  delete window.memoryAnkiDesktopTimer
  vi.unstubAllGlobals()
})

describe('detectClientSource', () => {
  it('detects the Electron desktop bridge as desktop', () => {
    setUserAgent('Mozilla/5.0 Electron/39.0')
    window.memoryAnkiDesktopTimer = { isDesktop: true }
    expect(detectClientSource()).toBe('desktop')
  })

  it('detects standalone display mode as PWA', () => {
    setUserAgent('Mozilla/5.0')
    vi.stubGlobal('matchMedia', undefined)
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    expect(detectClientSource()).toBe('pwa')
  })

  it('keeps a regular desktop browser as desktop', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    window.matchMedia = vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    expect(detectClientSource()).toBe('desktop')
  })
})
