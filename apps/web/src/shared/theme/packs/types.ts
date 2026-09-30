/**
 * A theme pack is a whole world: surface tokens, paper, stage, ambient motes,
 * particle skin, synth timbre and motion rhythm. One file per pack; the registry
 * applies it. Business code never branches on a pack id.
 */

export type ThemePackId = 'study' | 'palace' | 'voyage' | 'forest'

/** How a pack is earned: a level, or a specific stamp from the stamp book. */
export type UnlockRule = { level: number } | { stamp: string; label: string }

export type Hsl = readonly [number, number, number]

/** CSS custom properties, e.g. `{ '--color-primary': 'hsl(4 68% 44%)' }`. */
export type TokenMap = Readonly<Record<`--${string}`, string>>

export type MoteKind = 'dust' | 'gild' | 'star' | 'firefly'

/** Particle palette id understood by `@/shared/fx` (`setFxSkin`). */
export type PackFxSkin = 'ink' | 'foil' | 'galaxy' | 'firefly'

/** Synth voice family the audio channel builds every sound from. */
export type PackTimbre = 'paper-wood' | 'bell-lacquer' | 'celesta-chime' | 'marimba-water'

export interface ThemeMotion {
  /** Button / keyboard page turn in the freestyle feed. */
  pageTurnMs: number
  /** Mind-map node reveal flip. */
  flipMs: number
  /** Landing overshoot of the flip, in degrees (rebound is a third of it). */
  flipOvershootDeg: number
}

export interface ThemeAmbient {
  mote: MoteKind
  moteLight: Hsl
  moteDark: Hsl
}

export interface ThemePackPreview {
  ground: string
  card: string
  accent: string
  ink: string
  glow: string
}

export interface ThemePack {
  id: ThemePackId
  label: string
  /** One short line under the name. */
  tagline: string
  blurb: string
  unlock: UnlockRule
  fxSkin: PackFxSkin
  timbre: PackTimbre
  /** Card texture / 3-star bookmark the pack dresses cards with (growth.css). */
  cardMaterial: 'rice' | 'kraft' | 'wax' | 'goldfleck'
  bookmark: 'foil' | 'cinnabar' | 'bamboo' | 'starlight'
  motion: ThemeMotion
  ambient: ThemeAmbient
  /** `shared` applies in both schemes; `light` and `dark` must set the same keys. */
  tokens: { shared: TokenMap; light: TokenMap; dark: TokenMap }
  themeColor: { light: string; dark: string }
  preview: ThemePackPreview
}
