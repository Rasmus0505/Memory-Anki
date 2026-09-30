/** Particle variants for one grade. None of these draw an expanding ring. */
export const GRADE_VARIANTS = ['paper', 'ink', 'leaf', 'mote'] as const
export type GradeVariant = (typeof GRADE_VARIANTS)[number]

const lastByGrade = new Map<number, GradeVariant>()
let cursor = 0

/**
 * Seed-rotated variant for a grade. The same grade never plays the same
 * variant twice in a row, so a long run of 记得 does not look identical.
 */
export function nextGradeVariant(grade: number, seed = 0): GradeVariant {
  const start = Math.abs(Math.trunc(seed) + cursor) % GRADE_VARIANTS.length
  cursor = (cursor + 1) % 997
  for (let step = 0; step < GRADE_VARIANTS.length; step += 1) {
    const variant = GRADE_VARIANTS[(start + step) % GRADE_VARIANTS.length]
    if (lastByGrade.get(grade) !== variant) {
      lastByGrade.set(grade, variant)
      return variant
    }
  }
  const fallback = GRADE_VARIANTS[start]
  lastByGrade.set(grade, fallback)
  return fallback
}

export function __resetGradeVariantsForTests() {
  lastByGrade.clear()
  cursor = 0
}
