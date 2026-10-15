/**
 * Flip XP: a pure game-feel meter, deliberately unrelated to learning progress.
 *
 * Earned by the learner's own flips, never by unit completion or ratings, so it
 * cannot reward or punish memory. Chained flips within a short window earn a
 * bonus. Stored only on this device.
 */

const STORAGE_KEY = 'memory-anki.freestyle.flip-xp.v1'
const CHAIN_WINDOW_MS = 4000
const BASE_XP = 10
const CHAIN_STEP_XP = 5
const MAX_XP_PER_FLIP = 30

export interface FlipXpState {
  xp: number
  level: number
  chain: number
  lastFlipAt: number
}

export interface FlipXpGain {
  state: FlipXpState
  gained: number
  chain: number
  leveledUp: boolean
}

export const INITIAL_FLIP_XP: FlipXpState = { xp: 0, level: 1, chain: 0, lastFlipAt: 0 }

/** XP needed to clear `level`. Level 1 needs 40, level 2 needs 80, and so on. */
export function flipXpNeeded(level: number): number {
  return Math.max(1, level) * 40
}

/** XP for the Nth flip in a chain: 10, then +5 per chained flip, capped at 30. */
export function flipXpForChain(chain: number): number {
  return Math.min(MAX_XP_PER_FLIP, BASE_XP + Math.max(0, chain - 1) * CHAIN_STEP_XP)
}

export function applyFlipXp(state: FlipXpState, now: number): FlipXpGain {
  const continuing = state.lastFlipAt > 0 && now - state.lastFlipAt <= CHAIN_WINDOW_MS
  const chain = continuing ? state.chain + 1 : 1
  const gained = flipXpForChain(chain)
  let xp = state.xp + gained
  let level = state.level
  let leveledUp = false
  while (xp >= flipXpNeeded(level)) {
    xp -= flipXpNeeded(level)
    level += 1
    leveledUp = true
  }
  return {
    state: { xp, level, chain, lastFlipAt: now },
    gained,
    chain,
    leveledUp,
  }
}

function readStored(): FlipXpState {
  if (typeof window === 'undefined') return INITIAL_FLIP_XP
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return INITIAL_FLIP_XP
    const parsed = JSON.parse(raw) as Partial<FlipXpState>
    const level = Number.isFinite(parsed.level) && (parsed.level as number) >= 1 ? Math.floor(parsed.level as number) : 1
    const xp = Number.isFinite(parsed.xp) && (parsed.xp as number) >= 0 ? Math.floor(parsed.xp as number) : 0
    return {
      xp: Math.min(xp, flipXpNeeded(level) - 1),
      level,
      chain: 0,
      lastFlipAt: 0,
    }
  } catch {
    return INITIAL_FLIP_XP
  }
}

let current: FlipXpState | null = null
const listeners = new Set<() => void>()

export function getFlipXpSnapshot(): FlipXpState {
  if (current == null) current = readStored()
  return current
}

export function subscribeFlipXp(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Records one learner flip and persists the new meter. Returns what the feedback should show. */
export function recordFlipXp(now: number = Date.now()): FlipXpGain {
  const result = applyFlipXp(getFlipXpSnapshot(), now)
  current = result.state
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ xp: result.state.xp, level: result.state.level }))
    } catch {
      // Quota or private-mode failure: the meter still works for this session.
    }
  }
  listeners.forEach((listener) => listener())
  return result
}

/** Test seam: resets the in-memory meter and forgets the cached snapshot. */
export function resetFlipXpForTests() {
  current = null
}

/**
 * Orbs thrown by one flip, from the card's label length: one orb per two characters,
 * at least one, at most twelve. Only the look changes; the XP itself stays `flipXpForChain`.
 */
export function flipOrbCount(label: string): number {
  const length = Array.from(label.replace(/\s+/g, '')).length
  return Math.min(12, Math.max(1, Math.ceil(length / 2)))
}

/** Orbs thrown by a rating, by grade: 忘记 1, 困难 2, 记得 3, 轻松 5. Visual feedback only, no XP. */
export function ratingOrbCount(rating: 1 | 2 | 3 | 4): number {
  return ({ 1: 1, 2: 2, 3: 3, 4: 5 } as const)[rating]
}

/** Cumulative XP earned to date: every cleared level plus the current bar. Pure, so a session can be diffed. */
export function flipXpTotal(state: Pick<FlipXpState, 'xp' | 'level'>): number {
  let total = state.xp
  for (let level = 1; level < state.level; level += 1) total += flipXpNeeded(level)
  return total
}

export interface FlipXpSessionSummary {
  /** Level and total XP when this session began. */
  startLevel: number
  /** Overall level now: 总等级. */
  level: number
  /** XP earned since the session began. */
  gainedXp: number
  /** Levels cleared since the session began. */
  levelsGained: number
}

let sessionStart: { level: number; total: number } | null = null

/** Marks the start of a 随心 visit. Settlement reports the gain relative to this mark. */
export function beginFlipXpSession() {
  const state = getFlipXpSnapshot()
  sessionStart = { level: state.level, total: flipXpTotal(state) }
}

export function readFlipXpSession(): FlipXpSessionSummary {
  const state = getFlipXpSnapshot()
  const start = sessionStart ?? { level: state.level, total: flipXpTotal(state) }
  return {
    startLevel: start.level,
    level: state.level,
    gainedXp: Math.max(0, flipXpTotal(state) - start.total),
    levelsGained: Math.max(0, state.level - start.level),
  }
}
