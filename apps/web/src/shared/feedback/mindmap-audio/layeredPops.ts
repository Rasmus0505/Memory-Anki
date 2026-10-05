import type { ToneSpec } from './toneProfiles'

/** One action owns one sequence; each object contributes one countable glass bell. */
export type PopRole =
  | 'reveal'
  | 'deal'
  | 'fold'
  | 'remove'
  | 'lift'
  | 'select'
  | 'unlink'
  | 'deny'
  | 'land'
  | 'close'
  | 'grade'

export interface LayeredPopOptions {
  role: PopRole
  /** Number of objects affected by this action; defaults to one. */
  count?: number
  /** 1..4 = forgotten / hard / good / easy. */
  grade?: 1 | 2 | 3 | 4
  /** Progress step: 1 is the original pitch; subsequent steps rise by a whole tone. */
  step?: number
}

const GLASS_FREQUENCY = 1318.5
const GLASS_DECAY_MS = 380
const GLASS_PEAK_GAIN = 0.076
const CLEAR_POPS = 5
const CLEAR_POP_GAP_MS = 82
const TAIL_POP_GAP_MS = 38
const MAX_POPS = 40
const PITCH_PATTERN = [0, 0, 2, 0, 4] as const
const GRADE_RATIOS = [1, 9 / 8, 5 / 4, 4 / 3] as const
const ROLES: readonly PopRole[] = [
  'reveal', 'deal', 'fold', 'remove', 'lift', 'select', 'unlink', 'deny', 'land', 'close', 'grade',
]

/** The selected glass audition voice, with its peak doubled for the application. */
export function buildGlassBell(
  frequency = GLASS_FREQUENCY,
  scale = 1,
  offsetMs = 0,
  durationScale = 1,
): ToneSpec[] {
  return [
    {
      frequency,
      durationMs: GLASS_DECAY_MS * durationScale,
      gain: GLASS_PEAK_GAIN * scale,
      type: 'sine',
      offsetMs,
      pan: 0,
      attackMs: 4,
      envelope: 'glass',
    },
    {
      frequency: frequency * 2.4,
      durationMs: GLASS_DECAY_MS * 0.52 * durationScale,
      gain: GLASS_PEAK_GAIN * 0.15 * scale,
      type: 'sine',
      offsetMs,
      pan: 0,
      attackMs: 4,
      envelope: 'glass',
    },
  ]
}

export function buildLayeredPops(options: LayeredPopOptions): ToneSpec[] {
  const { role, count = 1, grade = 4, step = 0 } = options
  if (!ROLES.includes(role)) return []

  // Denial stays in the same family: a quiet lower bell, without a punitive slide.
  if (role === 'deny') return buildGlassBell(GLASS_FREQUENCY * 0.5, 0.52, 0, 0.7)
  if (role === 'close') return buildGlassBell(GLASS_FREQUENCY * 4 / 3, 0.65, 0, 1.7)
  if (role === 'grade') {
    return buildGlassBell(GLASS_FREQUENCY * (GRADE_RATIOS[grade - 1] ?? GRADE_RATIOS[3]), 0.82, 0, 1.1)
  }

  if (!Number.isFinite(count) || count <= 0) return []
  const total = Math.min(MAX_POPS, Math.max(1, Math.round(count)))
  const transpose = Number.isFinite(step) ? 2 ** (Math.max(0, step - 1) * 2 / 12) : 1
  const downward = role === 'fold' || role === 'remove' || role === 'unlink'
  const tones: ToneSpec[] = []
  let offsetMs = 0

  for (let index = 0; index < total; index += 1) {
    if (index > 0) offsetMs += index < CLEAR_POPS ? CLEAR_POP_GAP_MS : TAIL_POP_GAP_MS
    const scale = index < CLEAR_POPS
      ? 1 - index * 0.08
      : Math.max(0.18, 0.57 - (index - CLEAR_POPS) * 0.055)
    const semitones = PITCH_PATTERN[index % PITCH_PATTERN.length]! * (downward ? -1 : 1)
    const frequency = GLASS_FREQUENCY * transpose * (downward ? 0.9 : 1) * 2 ** (semitones / 12)
    tones.push(...buildGlassBell(frequency, scale, offsetMs, index < CLEAR_POPS ? 1 : 0.65))
  }

  return tones
}
