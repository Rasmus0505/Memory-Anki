import { describe, expect, it } from 'vitest'
import type { ExamOverview, ExamPalaceRow } from '@/shared/api/contracts'
import { buildKnowledgeMap, clampStars, formatDaysLeft, formatPercent, nodeMastery, starSourceLabel } from './examFormat'

function palace(partial: Partial<ExamPalaceRow>): ExamPalaceRow {
  return {
    id: 1, title: 'p', subject_id: 1, chapter_id: null, stars: 1, stars_source: 'derived', own_stars: null,
    question_count: 0, subjective_count: 0, unit_count: 0, learned_count: 0, mastery_ratio: 0, recall: 0, priority: 0,
    ...partial,
  }
}

describe('exam format', () => {
  it('clamps stars and formats ratios and countdowns', () => {
    expect([clampStars(0), clampStars(2.4), clampStars(9)]).toEqual([1, 2, 3])
    expect(formatPercent(0.456)).toBe('46%')
    expect(formatPercent(null)).toBe('—')
    expect(formatDaysLeft(null)).toBe('未设置考试')
    expect(formatDaysLeft(12)).toBe('距考试 12 天')
    expect(formatDaysLeft(0)).toBe('今天考试')
    expect(starSourceLabel('derived')).toBe('按题目推算')
  })

  it('rolls palace mastery up the chapter tree and keeps unbound palaces separate', () => {
    const overview = {
      chapters: [
        { id: 10, subject_id: 1, parent_id: null, name: '线代', sort_order: 0, exam_stars: 3, exam_stars_source: 'ai' },
        { id: 11, subject_id: 1, parent_id: 10, name: '特征值', sort_order: 0, exam_stars: null, exam_stars_source: null },
        { id: 20, subject_id: 2, parent_id: null, name: '其他学科', sort_order: 0, exam_stars: null, exam_stars_source: null },
      ],
      palaces: [
        palace({ id: 1, chapter_id: 11, unit_count: 4, learned_count: 4, mastery_ratio: 1 }),
        palace({ id: 2, chapter_id: 10, unit_count: 4, learned_count: 2, mastery_ratio: 0 }),
        palace({ id: 3, chapter_id: null, unit_count: 1 }),
      ],
    } as unknown as ExamOverview

    const { roots, loose } = buildKnowledgeMap(overview, 1)
    expect(roots.map((node) => node.chapter.id)).toEqual([10])
    expect(roots[0]?.unitCount).toBe(8)
    expect(roots[0]?.learnedCount).toBe(6)
    expect(nodeMastery(roots[0]!)).toBe(0.5)
    expect(roots[0]?.children[0]?.palaces.map((row) => row.id)).toEqual([1])
    expect(loose.map((row) => row.id)).toEqual([3])
  })
})

describe('round summary diff', async () => {
  const { diffLitPalaces } = await import('../ui/ExamRoundSummary')
  it('lists palaces that gained learned units, high stars first', () => {
    const before = { palaces: [palace({ id: 1, learned_count: 1 }), palace({ id: 2, stars: 3, learned_count: 0 }), palace({ id: 3 })] } as unknown as ExamOverview
    const after = {
      palaces: [palace({ id: 1, learned_count: 3 }), palace({ id: 2, stars: 3, learned_count: 1 }), palace({ id: 3 })],
    } as unknown as ExamOverview
    expect(diffLitPalaces(before, after).map((row) => [row.palace.id, row.gainedUnits])).toEqual([[2, 1], [1, 2]])
  })
})
