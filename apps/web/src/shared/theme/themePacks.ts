import { FOREST_PACK } from './packs/forest'
import { PALACE_PACK } from './packs/palace'
import { STUDY_PACK } from './packs/study'
import type { ThemeAmbient, ThemeMotion, ThemePack, ThemePackId, TokenMap } from './packs/types'
import { VOYAGE_PACK } from './packs/voyage'

export type * from './packs/types'

/** Registry order is the wardrobe order and the unlock ladder. */
export const THEME_PACKS: readonly ThemePack[] = [STUDY_PACK, PALACE_PACK, VOYAGE_PACK, FOREST_PACK]
export const DEFAULT_THEME_PACK: ThemePackId = 'study'
export const THEME_PACK_STORAGE_KEY = 'memory-anki-theme-pack'

const BY_ID = new Map(THEME_PACKS.map((pack) => [pack.id, pack]))
/** Pre-pack wardrobe saved a particle skin id; each maps onto the world it grew into. */
const LEGACY_SKIN_TO_PACK: Record<string, ThemePackId> = { ink: 'study', foil: 'palace', galaxy: 'voyage' }

export function isThemePackId(value: unknown): value is ThemePackId {
  return typeof value === 'string' && BY_ID.has(value as ThemePackId)
}

export function themePackById(id: string | null | undefined): ThemePack {
  return BY_ID.get(id as ThemePackId) ?? STUDY_PACK
}

export function coerceThemePackId(value: unknown): ThemePackId {
  if (isThemePackId(value)) return value
  if (typeof value === 'string' && value in LEGACY_SKIN_TO_PACK) return LEGACY_SKIN_TO_PACK[value]
  return DEFAULT_THEME_PACK
}

function declarations(tokens: TokenMap) {
  return Object.entries(tokens).map(([name, value]) => `${name}:${value};`).join('')
}

/**
 * The pack's CSS. `:root[data-theme-pack=x]` (0,2,0) beats the foundation `.dark`
 * block (0,1,0), so the light rule excludes `.dark` and the dark rule carries the
 * same keys at (0,3,0). Injected after the bundle, so equal specificity also wins.
 */
export function themePackStylesheet(pack: ThemePack): string {
  const root = `:root[data-theme-pack="${pack.id}"]`
  const rules: string[] = []
  const shared = declarations(pack.tokens.shared)
  const light = declarations(pack.tokens.light)
  const dark = declarations(pack.tokens.dark)
  if (shared) rules.push(`${root}{${shared}}`)
  if (light) rules.push(`${root}:not(.dark){${light}}`)
  if (dark) rules.push(`${root}.dark{${dark}}`)
  return rules.join('\n')
}

let active: ThemePack = STUDY_PACK
const listeners = new Set<(pack: ThemePack) => void>()

export function activeThemePack(): ThemePack {
  return active
}

/** Motion rhythm of the live pack; read at animation start so a switch applies next turn. */
export function themeMotion(): ThemeMotion {
  return active.motion
}

export function themeAmbient(): ThemeAmbient {
  return active.ambient
}

export function themeColorFor(scheme: 'light' | 'dark') {
  return active.themeColor[scheme]
}

export function onThemePackChange(listener: (pack: ThemePack) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const STYLE_ID = 'memory-anki-theme-pack'

function paint(pack: ThemePack) {
  const root = document.documentElement
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = themePackStylesheet(pack)
  root.dataset.themePack = pack.id
  root.dataset.cardMaterial = pack.cardMaterial
  root.dataset.cardBookmark = pack.bookmark
  root.style.setProperty('--ma-page-turn-ms', `${pack.motion.pageTurnMs}ms`)
  root.style.setProperty('--ma-flip-ms', `${pack.motion.flipMs}ms`)
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = pack.themeColor[root.classList.contains('dark') ? 'dark' : 'light']
}

/** Paints the world. Only CSS/DOM; the particle skin is bound by the caller (app shell). */
export function applyThemePack(id: string | null | undefined, { persist = true } = {}) {
  const pack = themePackById(coerceThemePackId(id))
  if (typeof document !== 'undefined') paint(pack)
  if (persist) {
    try {
      window.localStorage.setItem(THEME_PACK_STORAGE_KEY, pack.id)
    } catch {
      // Storage unavailable: the pack still applies for this session.
    }
  }
  if (pack !== active) {
    active = pack
    listeners.forEach((listener) => listener(pack))
  }
  return pack
}

function readStoredPack(): string | null {
  try {
    return window.localStorage.getItem(THEME_PACK_STORAGE_KEY)
  } catch {
    return null
  }
}

/** Boot: paint the last applied pack before React so the first frame is the right world. */
export function initializeThemePack() {
  if (typeof window === 'undefined') return
  applyThemePack(readStoredPack(), { persist: false })
}

export function __resetThemePackForTests() {
  active = STUDY_PACK
  listeners.clear()
  if (typeof document !== 'undefined') {
    document.getElementById(STYLE_ID)?.remove()
    delete document.documentElement.dataset.themePack
  }
}
