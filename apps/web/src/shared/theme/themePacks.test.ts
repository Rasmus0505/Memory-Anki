import { afterEach, describe, expect, it } from 'vitest'
import {
  THEME_PACKS,
  THEME_PACK_STORAGE_KEY,
  __resetThemePackForTests,
  activeThemePack,
  applyThemePack,
  coerceThemePackId,
  initializeThemePack,
  onThemePackChange,
  themeMotion,
  themePackStylesheet,
} from './themePacks'

afterEach(() => {
  __resetThemePackForTests()
  window.localStorage.clear()
})

describe('theme pack manifests', () => {
  it('every pack sets the same keys in light and dark, so dark never inherits a light token', () => {
    for (const pack of THEME_PACKS) {
      expect(Object.keys(pack.tokens.dark).sort(), pack.id).toEqual(Object.keys(pack.tokens.light).sort())
    }
  })

  it('never uses a cold blue ground (warm-only palette rule)', () => {
    for (const pack of THEME_PACKS) {
      for (const scheme of ['light', 'dark'] as const) {
        const ground = pack.tokens[scheme]['--color-background']
        if (!ground) continue
        const hue = Number(/hsl\((\d+)/.exec(ground)?.[1])
        expect(hue >= 190 && hue <= 250, `${pack.id} ${scheme} ${ground}`).toBe(false)
      }
    }
  })

  it('keeps flow-safe motion: no page turn or flip longer than 700ms', () => {
    for (const pack of THEME_PACKS) {
      expect(pack.motion.pageTurnMs).toBeLessThanOrEqual(700)
      expect(pack.motion.flipMs).toBeLessThanOrEqual(700)
    }
  })

  it('the default pack emits no overrides (foundation tokens are the reference look)', () => {
    expect(themePackStylesheet(THEME_PACKS[0])).toBe('')
  })

  it('scopes light rules away from .dark and gives dark rules higher specificity', () => {
    const css = themePackStylesheet(THEME_PACKS[1])
    expect(css).toContain(':root[data-theme-pack="palace"]:not(.dark){')
    expect(css).toContain(':root[data-theme-pack="palace"].dark{')
  })
})

describe('applying a pack', () => {
  it('paints tokens, card dress and rhythm, then notifies listeners once', () => {
    const seen: string[] = []
    onThemePackChange((pack) => seen.push(pack.id))
    applyThemePack('voyage')
    applyThemePack('voyage')
    const root = document.documentElement
    expect(root.dataset.themePack).toBe('voyage')
    expect(root.dataset.cardBookmark).toBe('starlight')
    expect(document.getElementById('memory-anki-theme-pack')?.textContent).toContain('--color-stage')
    expect(themeMotion().flipMs).toBe(activeThemePack().motion.flipMs)
    expect(seen).toEqual(['voyage'])
    expect(window.localStorage.getItem(THEME_PACK_STORAGE_KEY)).toBe('voyage')
  })

  it('maps legacy particle skins and junk onto real packs', () => {
    expect(coerceThemePackId('foil')).toBe('palace')
    expect(coerceThemePackId('galaxy')).toBe('voyage')
    expect(coerceThemePackId('nope')).toBe('study')
  })

  it('boot paints the last stored pack without rewriting storage', () => {
    window.localStorage.setItem(THEME_PACK_STORAGE_KEY, 'forest')
    initializeThemePack()
    expect(document.documentElement.dataset.themePack).toBe('forest')
    expect(activeThemePack().id).toBe('forest')
  })
})
