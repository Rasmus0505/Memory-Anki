/**
 * Rare-show roll with pity. Pure: state in, decision + next state out, so the
 * odds are testable and the persisted counter lives wherever the host wants.
 */

export const RARE_SHOWS = ['koi', 'phoenix', 'fireflies', 'lotus'] as const
export type RareShow = (typeof RARE_SHOWS)[number]

export const RARE_LABEL: Record<RareShow, string> = {
  koi: '锦鲤跃出',
  phoenix: '凤凰掠轨',
  fireflies: '满屏萤火',
  lotus: '墨莲绽放',
}

/** ~1 in 45 per eligible rating ≈ once every 2–3 typical rounds. */
export const RARE_BASE_CHANCE = 1 / 45
/** Ratings without a show after which the next eligible rating always gets one. */
export const RARE_PITY = 80
/** Chance ramps up over the last stretch before pity so it never feels scripted. */
const RAMP_START = 55

export interface RarityState {
  sinceLast: number
  last: RareShow | null
}

export const INITIAL_RARITY: RarityState = { sinceLast: 0, last: null }

export function rareChance(sinceLast: number) {
  if (sinceLast + 1 >= RARE_PITY) return 1
  if (sinceLast < RAMP_START) return RARE_BASE_CHANCE
  const t = (sinceLast - RAMP_START) / (RARE_PITY - RAMP_START)
  return RARE_BASE_CHANCE + t * (0.35 - RARE_BASE_CHANCE)
}

export function pickRareShow(last: RareShow | null, random: () => number = Math.random): RareShow {
  const pool = RARE_SHOWS.filter((show) => show !== last)
  return pool[Math.floor(random() * pool.length)] ?? RARE_SHOWS[0]
}

/**
 * One rating. `eligible` is false for 忘记: a surprise right after an honest miss
 * would read as mockery. The pity counter still advances so it is never lost.
 */
export function rollRare(state: RarityState, eligible: boolean, random: () => number = Math.random): { show: RareShow | null; next: RarityState } {
  if (!eligible || random() >= rareChance(state.sinceLast)) {
    return { show: null, next: { sinceLast: state.sinceLast + 1, last: state.last } }
  }
  const show = pickRareShow(state.last, random)
  return { show, next: { sinceLast: 0, last: show } }
}

const STORAGE_KEY = 'memory-anki.fx.rarity.v1'

function isState(value: unknown): value is RarityState {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.sinceLast === 'number'
    && (record.last === null || (typeof record.last === 'string' && (RARE_SHOWS as readonly string[]).includes(record.last)))
}

/** Per-device on purpose: the counter is a pacing aid, not progress. */
export function readRarityState(): RarityState {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')
    return isState(parsed) ? parsed : INITIAL_RARITY
  } catch {
    return INITIAL_RARITY
  }
}

export function writeRarityState(state: RarityState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Private mode / quota: pacing just restarts.
  }
}
