import { describe, expect, it } from 'vitest'
import { buildPalaceParentQuestionTotals } from './usePalaceParentQuestionTotal'
import type { PalaceGroupedListResponse } from '@/shared/api/contracts'

function palace(id: number) {
  return { id } as PalaceGroupedListResponse['ungrouped'][number]
}

describe('buildPalaceParentQuestionTotals', () => {
  it('maps each chapter palace to its chapter total and ungrouped palaces to their subject total', () => {
    const data = {
      groups: [],
      ungrouped: [],
      subjects: [
        {
          subject: { id: 1, name: '外国教育史' },
          question_total: 61,
          chapter_groups: [
            { source_chapter: { id: 10, name: '第一章' }, question_total: 34, palaces: [palace(101), palace(102)] },
            { source_chapter: { id: 11, name: '第二章' }, question_total: 20, palaces: [palace(103)] },
          ],
          ungrouped_palaces: [palace(201)],
        },
      ],
    } as unknown as PalaceGroupedListResponse

    const totals = buildPalaceParentQuestionTotals(data)

    expect(totals.get(101)).toBe(34)
    expect(totals.get(102)).toBe(34)
    expect(totals.get(103)).toBe(20)
    expect(totals.get(201)).toBe(61)
  })

  it('returns an empty map before the catalog has loaded', () => {
    expect(buildPalaceParentQuestionTotals(null).size).toBe(0)
  })
})
