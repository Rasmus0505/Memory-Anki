import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyThemePreference,
  DARK_THEME_COLOR,
  getStoredThemePreference,
  initializeTheme,
  LIGHT_THEME_COLOR,
  resolveTheme,
  setThemePreference,
  THEME_STORAGE_KEY,
  THEME_UPDATED_EVENT,
} from './themePreference'

type MediaListener = (event: MediaQueryListEvent) => void

let prefersDark = false
let mediaListeners: MediaListener[] = []

function installMatchMediaStub() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: prefersDark,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: MediaListener) => {
        mediaListeners.push(listener)
      },
      removeEventListener: (_type: string, listener: MediaListener) => {
        mediaListeners = mediaListeners.filter((entry) => entry !== listener)
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

function dispatchSystemThemeChange(nextPrefersDark: boolean) {
  prefersDark = nextPrefersDark
  const event = { matches: nextPrefersDark, media: '(prefers-color-scheme: dark)' } as MediaQueryListEvent
  mediaListeners.forEach((listener) => listener(event))
}

describe('themePreference', () => {
  beforeEach(() => {
    prefersDark = false
    mediaListeners = []
    installMatchMediaStub()
    window.localStorage.clear()
    document.head.innerHTML = '<meta name="theme-color" content="#020617" />'
    document.documentElement.className = ''
    document.documentElement.style.colorScheme = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('falls back to system when storage is empty or invalid', () => {
    expect(getStoredThemePreference()).toBe('system')

    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia')

    expect(getStoredThemePreference()).toBe('system')
  })

  it('applies dark and light themes to html and theme-color meta', () => {
    applyThemePreference('dark')

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(DARK_THEME_COLOR)

    applyThemePreference('light')

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(LIGHT_THEME_COLOR)
  })

  it('stores local preference and dispatches an update event', () => {
    const listener = vi.fn()
    window.addEventListener(THEME_UPDATED_EVENT, listener)

    setThemePreference('dark')

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ detail: 'dark' })

    window.removeEventListener(THEME_UPDATED_EVENT, listener)
  })

  it('resolves and follows system theme only while preference is system', () => {
    prefersDark = true

    expect(resolveTheme('system')).toBe('dark')

    initializeTheme()
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    dispatchSystemThemeChange(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    setThemePreference('dark')
    dispatchSystemThemeChange(false)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
