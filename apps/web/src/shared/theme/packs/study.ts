import type { ThemePack } from './types'

/** Default world: exactly the foundation tokens (no overrides), warm paper and ink. */
export const STUDY_PACK: ThemePack = {
  id: 'study',
  label: '纸墨书房',
  tagline: '暖纸、墨点与金粉',
  blurb: '一盏台灯下的书房。纸屑墨点，金粉落定，默认的手感。',
  unlock: { level: 1 },
  fxSkin: 'ink',
  timbre: 'paper-wood',
  cardMaterial: 'rice',
  bookmark: 'foil',
  motion: { pageTurnMs: 380, flipMs: 560, flipOvershootDeg: 13 },
  ambient: { mote: 'dust', moteLight: [32, 78, 52], moteDark: [40, 90, 72] },
  tokens: { shared: {}, light: {}, dark: {} },
  themeColor: { light: '#fbf6ef', dark: '#181411' },
  preview: {
    ground: 'hsl(38 56% 96%)',
    card: 'hsl(43 100% 99%)',
    accent: 'hsl(28 80% 51%)',
    ink: 'hsl(24 26% 14%)',
    glow: 'hsl(40 96% 62%)',
  },
}
