import type { Hsl, ParticleShape } from './particles/particleModel'

export type FxSkinId = 'ink' | 'foil' | 'galaxy' | 'firefly'

export interface FxPalette {
  gold: Hsl
  amber: Hsl
  paper: Hsl
  cream: Hsl
  /** Gold dark enough to read on warm paper (additive would wash out). */
  paperGold: Hsl
  green: Hsl
  leaf: Hsl
  ink: Hsl
  coral: Hsl
  /** Mirrors --color-rate-*, so particles read as the keycap that fired them. */
  rating: Record<1 | 2 | 3 | 4, Hsl>
  /** Shape used for small sparkle dust. */
  sparkShape: ParticleShape
  /** Paper flakes become glowing specks when true. */
  luminous: boolean
}

export interface FxSkin {
  id: FxSkinId
  label: string
  blurb: string
  palette: FxPalette
}

const RATING: FxPalette['rating'] = {
  1: [8, 76, 62],
  2: [38, 92, 56],
  3: [104, 44, 54],
  4: [190, 56, 54],
}

const INK: FxPalette = {
  gold: [40, 96, 62],
  amber: [30, 90, 56],
  paper: [40, 50, 92],
  cream: [36, 70, 84],
  paperGold: [36, 90, 46],
  green: [104, 50, 42],
  leaf: [110, 45, 52],
  ink: [24, 38, 20],
  coral: [8, 76, 64],
  rating: RATING,
  sparkShape: 'dot',
  luminous: false,
}

const FOIL: FxPalette = {
  ...INK,
  gold: [44, 100, 64],
  amber: [36, 96, 58],
  paper: [46, 90, 80],
  cream: [42, 92, 70],
  paperGold: [40, 96, 44],
  leaf: [48, 80, 56],
  sparkShape: 'star',
}

/** Warm night: plum, rose and gold. Never a cold blue. */
const GALAXY: FxPalette = {
  ...INK,
  gold: [42, 100, 70],
  amber: [330, 80, 70],
  paper: [290, 60, 86],
  cream: [18, 90, 82],
  paperGold: [300, 55, 52],
  green: [150, 45, 50],
  leaf: [310, 55, 66],
  ink: [280, 40, 26],
  coral: [350, 80, 68],
  rating: { 1: [350, 78, 68], 2: [30, 96, 62], 3: [130, 50, 60], 4: [280, 70, 72] },
  sparkShape: 'star',
  luminous: true,
}

/** Amber-green fireflies over moss: glowing specks, soft leaf greens. */
const FIREFLY: FxPalette = {
  ...INK,
  gold: [58, 96, 64],
  amber: [44, 94, 58],
  paper: [70, 50, 86],
  cream: [56, 80, 80],
  paperGold: [48, 90, 42],
  green: [120, 44, 44],
  leaf: [96, 50, 50],
  ink: [140, 30, 18],
  coral: [18, 80, 62],
  rating: { 1: [14, 78, 62], 2: [44, 94, 58], 3: [100, 50, 52], 4: [168, 46, 48] },
  sparkShape: 'dot',
  luminous: true,
}

export const FX_SKINS: Record<FxSkinId, FxSkin> = {
  ink: { id: 'ink', label: '纸墨', blurb: '纸屑、墨点与金粉，默认手感', palette: INK },
  foil: { id: 'foil', label: '金箔', blurb: '碎金箔片与星芒，每一下都亮', palette: FOIL },
  galaxy: { id: 'galaxy', label: '星河', blurb: '暖夜星尘，紫玫与金色发光', palette: GALAXY },
  firefly: { id: 'firefly', label: '萤火', blurb: '琥珀绿的萤火，一明一灭', palette: FIREFLY },
}

export const FX_SKIN_IDS = Object.keys(FX_SKINS) as FxSkinId[]

export function isFxSkinId(value: unknown): value is FxSkinId {
  return typeof value === 'string' && value in FX_SKINS
}

/** Live palette read by every recipe at emit time; mutated in place on skin change. */
export const pal: FxPalette = { ...INK, rating: { ...INK.rating } }
let activeSkin: FxSkinId = 'ink'

export function setFxSkin(id: FxSkinId) {
  const skin = FX_SKINS[id] ?? FX_SKINS.ink
  activeSkin = skin.id
  Object.assign(pal, skin.palette, { rating: { ...skin.palette.rating } })
}

export function activeFxSkin(): FxSkinId {
  return activeSkin
}
