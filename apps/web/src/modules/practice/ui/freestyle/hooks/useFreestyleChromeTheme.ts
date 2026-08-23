import { useEffect } from 'react'
import { applyThemePreference, getStoredThemePreference } from '@/shared/theme/themePreference'

const FREESTYLE_THEME_COLOR = '#0b0c0e'

/** iPhone standalone status bar should match the near-black feed, not the warm app chrome. */
export function useFreestyleChromeTheme(active: boolean) {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const previous = meta?.content
    if (meta) meta.content = FREESTYLE_THEME_COLOR
    return () => {
      if (meta && previous) {
        meta.content = previous
        return
      }
      applyThemePreference(getStoredThemePreference())
    }
  }, [active])
}
