/**
 * Per-learner growth bookkeeping, synced through client preferences:
 * wardrobe picks, plus which ceremonies already played so none ever repeats
 * on the other device.
 */
export interface GrowthState {
  skin: string
  material: string
  bookmark: string
  /** Level and XP the learner last *saw* settled; null until the first baseline. */
  seenLevel: number | null
  seenXp: number | null
  /** Stamps whose full ceremony has played. */
  celebrated: string[]
  /** Stamps / quest keys already announced with a quiet corner stamp. */
  toasted: string[]
}

export const DEFAULT_GROWTH_STATE: GrowthState = {
  skin: 'ink',
  material: 'rice',
  bookmark: 'foil',
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
    skin: typeof record.skin === 'string' ? record.skin : DEFAULT_GROWTH_STATE.skin,
    material: typeof record.material === 'string' ? record.material : DEFAULT_GROWTH_STATE.material,
    bookmark: typeof record.bookmark === 'string' ? record.bookmark : DEFAULT_GROWTH_STATE.bookmark,
    seenLevel: nullableNumber(record.seenLevel),
    seenXp: nullableNumber(record.seenXp),
    celebrated: stringList(record.celebrated),
    toasted: stringList(record.toasted).slice(-TOASTED_LIMIT),
  }
}

export function isGrowthState(value: unknown): value is GrowthState {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.skin === 'string'
    && typeof record.material === 'string'
    && typeof record.bookmark === 'string'
    && Array.isArray(record.celebrated)
    && Array.isArray(record.toasted)
}

export function appendToasted(list: readonly string[], keys: readonly string[]) {
  const merged = [...list, ...keys.filter((key) => !list.includes(key))]
  return merged.slice(-TOASTED_LIMIT)
}
