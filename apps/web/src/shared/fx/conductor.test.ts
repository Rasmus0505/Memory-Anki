import { describe, expect, it } from 'vitest'
import { GRADE_VARIANTS, __resetGradeVariantsForTests, nextGradeVariant } from './conductor'

describe('grade variant conductor', () => {
  it('does not repeat the same variant back to back for one grade', () => {
    __resetGradeVariantsForTests()
    const seen: string[] = []
    for (let step = 0; step < 12; step += 1) {
      seen.push(nextGradeVariant(3, step * 17))
    }
    expect(new Set(seen).size).toBeGreaterThan(1)
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]).not.toBe(seen[index - 1])
    }
    for (const variant of seen) {
      expect(GRADE_VARIANTS).toContain(variant)
    }
  })
})