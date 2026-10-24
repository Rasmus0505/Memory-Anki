import { describe, expect, it } from 'vitest'
import { decodeSubjectMemoryLadder } from './api'
import {
  formatReviewDate,
  nodeScale,
  stageLabel,
  subjectKeyFromProgressId,
} from './model'

describe('subject memory ladder model', () => {
  it('names interval bands as day ranges, never as levels', () => {
    expect(stageLabel(0)).toBe('首学')
    expect(stageLabel(1)).toBe('1–2天')
    expect(stageLabel(14)).toBe('14–29天')
    expect(stageLabel(240)).toBe('240–364天')
    expect(stageLabel(365)).toBe('365天以上')
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
