export interface ThemeMotion {
  /** Button / keyboard page turn in the freestyle feed. */
  pageTurnMs: number
  /** Mind-map node reveal flip. */
  flipMs: number
  /** Landing overshoot of the flip, in degrees (rebound is a third of it). */
  flipOvershootDeg: number
}

export interface ThemePack {
  motion: ThemeMotion
  themeColor: { light: string; dark: string }
}
