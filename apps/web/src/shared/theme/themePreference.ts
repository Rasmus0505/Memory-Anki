export type ThemePreference = 'light' | 'dark' | 'system'

export const THEME_STORAGE_KEY = 'memory-anki-theme'
export const THEME_UPDATED_EVENT = 'memory-anki-theme-updated'

export const LIGHT_THEME_COLOR = '#f9f7f3'
export const DARK_THEME_COLOR = '#1a1614'

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function getStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(raw) ? raw : 'system'
  } catch {
    return 'system'
  }
}

export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function updateThemeColorMeta(theme: 'light' | 'dark') {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) {
    meta.content = theme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR
  }
}

export function applyThemePreference(preference: ThemePreference) {
  if (typeof document === 'undefined') return
  const theme = resolveTheme(preference)
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
  updateThemeColorMeta(theme)
}

export function setThemePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // localStorage 不可用时仅应用到当前会话
  }
  applyThemePreference(preference)
  window.dispatchEvent(new CustomEvent(THEME_UPDATED_EVENT, { detail: preference }))
}

export function initializeTheme() {
  if (typeof window === 'undefined') return
  applyThemePreference(getStoredThemePreference())
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', () => {
    if (getStoredThemePreference() === 'system') {
      applyThemePreference('system')
    }
  })
}
