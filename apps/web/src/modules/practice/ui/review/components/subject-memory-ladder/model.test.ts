import { describe, expect, it } from 'vitest'
import { decodeSubjectMemoryLadder } from './api'
import {
  defaultStageIndex,
  formatReviewDate,
  nodeScale,
  stageLabel,
  subjectKeyFromProgressId,
  type SubjectMemoryLadderStage,
} from './model'

function stage(index: number, palaceCount: number, overdue = 0): SubjectMemoryLadderStage {
  return {
    stage_index: index,
    interval_days: [0, 1, 3, 7, 14, 30, 60, 120, 240, 365][index] ?? 0,
    palace_count: palaceCount,
    unit_count: palaceCount,
    overdue_palace_count: overdue,
    palaces: [],
  }
}

describe('subject memory ladder model', () => {
  it('names stages in learner language', () => {
    expect(stageLabel(0)).toBe('刚学')
    expect(stageLabel(14)).toBe('14天')
    expect(stageLabel(365)).toBe('1年')
  })

  it('starts on the first overdue stage, otherwise the fullest stage', () => {
    expect(defaultStageIndex([stage(0, 1), stage(1, 4, 1), stage(2, 9)])).toBe(1)
    expect(defaultStageIndex([stage(0, 1), stage(1, 4), stage(2, 9)])).toBe(2)
  })

  it('keeps an empty node visible but smaller than a full node', () => {
    expect(nodeScale(0, 3)).toBeLessThan(nodeScale(3, 3))
  })

  it('formats review dates without shifting the calendar day', () => {
    expect(formatReviewDate('2026-08-12', false, true)).toBe('今天')
    expect(formatReviewDate('2026-08-11', true, false)).toBe('逾期 · 8月11日')
    expect(formatReviewDate('2026-08-20', false, false)).toBe('8月20日')
  })

  it('reads a progress subject id without guessing other nodes', () => {
    expect(subjectKeyFromProgressId('subject:12')).toBe(12)
    expect(subjectKeyFromProgressId('subject:unassigned')).toBe('unassigned')
    expect(subjectKeyFromProgressId('palace:4')).toBeNull()
  })

  it('rejects a ladder that is not the ten scheduling stages', () => {
    expect(() => decodeSubjectMemoryLadder({ ladder: [0], generated_at: 'now', subjects: [] })).toThrow(/不兼容/)
  })
})
