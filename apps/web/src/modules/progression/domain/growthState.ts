import { DEFAULT_THEME_PACK, coerceThemePackId, type ThemePackId } from '@/shared/theme/themePacks'

/**
 * Per-learner growth bookkeeping, synced through client preferences:
 * the worn theme pack, plus which ceremonies already played so none ever
 * repeats on the other device.
 */
export interface GrowthState {
  pack: ThemePackId
  /** Packs whose unboxing ceremony has played (the default pack counts as opened). */
  unboxed: ThemePackId[]
  /** Level and XP the learner last *saw* settled; null until the first baseline. */
  seenLevel: number | null
  seenXp: number | null
  /** Stamps whose full ceremony has played. */
  celebrated: string[]
  /** Stamps / quest keys already announced with a quiet corner stamp. */
  toasted: string[]
}

export const DEFAULT_GROWTH_STATE: GrowthState = {
  pack: DEFAULT_THEME_PACK,
  unboxed: [DEFAULT_THEME_PACK],
  seenLevel: null,
  seenXp: null,
  celebrated: [],
  toasted: [],
}

/** Quest toasts are keyed per day; only the recent ones are kept. */
const TOASTED_LIMIT = 200

const stringList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const nullableNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export function sanitizeGrowthState(value: unknown): GrowthState {
  if (!value || typeof value !== 'object') return { ...DEFAULT_GROWTH_STATE }
  const record = value as Record<string, unknown>
  return {
    // Pre-pack states saved a particle skin; it maps onto the world it grew into.
    pack: coerceThemePackId(record.pack ?? record.skin),
    unboxed: unboxedList(record.unboxed),
    seenLevel: nullableNumber(record.seenLevel),
    seenXp: nullableNumber(record.seenXp),
    celebrated: stringList(record.celebrated),
    toasted: stringList(record.toasted).slice(-TOASTED_LIMIT),
  }
}

function unboxedList(value: unknown): ThemePackId[] {
  const ids = stringList(value).map((id) => coerceThemePackId(id))
  return Array.from(new Set([DEFAULT_THEME_PACK, ...ids]))
}

export function isGrowthState(value: unknown): value is GrowthState {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  // Pre-pack states (`skin`, no `unboxed`) stay valid so sanitize can migrate them
  // instead of the store dropping seen levels and stamps back to a fresh baseline.
  const packShape = typeof record.pack === 'string' || typeof record.skin === 'string'
  return packShape
    && Array.isArray(record.celebrated)
    && Array.isArray(record.toasted)
}

export function appendToasted(list: readonly string[], keys: readonly string[]) {
  const merged = [...list, ...keys.filter((key) => !list.includes(key))]
  return merged.slice(-TOASTED_LIMIT)
}
