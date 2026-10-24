import { describe, expect, it } from 'vitest'
import { parseFreestyleOverview } from './freestyleOverviewParse'

const payload = {
  round: {
    round_id: 'r1',
    version: 3,
    counts: {
      palaces: 4,
      units: 18,
      new: 6,
      review: 12,
      done: 2,
      remaining: 16,
      remaining_palaces: 3,
      remaining_units: 14,
    },
    by_subject: [{ subject_id: 7, name: '政治', done: 1, total: 4 }],
  },
  milestones: {
    today: '2026-10-23',
    groups: [
      {
        date: '2026-10-31',
        days_left: 8,
        items: [
          { id: 'zhongjiaoshi', title: '中国教育史完成', category: '333', detail: '' },
          { id: 'mayuan', title: '马原 8 宫完成', category: '政治', detail: '' },
        ],
      },
    ],
    overdue_count: 1,
  },
  today: { due_count: 9, due_palace_count: 3, overdue_count: 2, new_unit_count: 6, new_palace_count: 2 },
  yesterday: {
    date: '2026-10-22',
    learned_units: 5,
    learned_palace_count: 2,
    weak_units: [{ unit_id: 'u1', name: '记忆宫殿', palace_name: '马原', again_ratio: 0.4 }],
  },
  next_reviews: [
    { unit_id: 'u2', name: '间隔复习', palace_name: '毛中特', due_date: '2026-10-25', interval_days: 3 },
  ],
}

describe('parseFreestyleOverview', () => {
  it('keeps a well-formed payload as it is', () => {
    const parsed = parseFreestyleOverview(payload)
    expect(parsed.round?.counts.remaining_units).toBe(14)
    expect(parsed.milestones.groups).toHaveLength(1)
    expect(parsed.milestones.groups[0].items.map((item) => item.id)).toEqual(['zhongjiaoshi', 'mayuan'])
    expect(parsed.today.new_palace_count).toBe(2)
    expect(parsed.next_reviews[0].interval_days).toBe(3)
  })

  it('degrades to today-with-nothing when the payload is empty', () => {
    const parsed = parseFreestyleOverview(null)
    expect(parsed.round).toBeNull()
    expect(parsed.milestones.groups).toEqual([])
    expect(parsed.milestones.overdue_count).toBe(0)
    expect(parsed.today.due_count).toBe(0)
    expect(parsed.yesterday.weak_units).toEqual([])
    expect(parsed.next_reviews).toEqual([])
  })

  /**
   * The exact shape that white-screened 随心: the running API still answered
   * `milestones: { reminders: [] }` while the new frontend read `groups.length`.
   */
  it('survives a milestones block that has no groups list', () => {
    const parsed = parseFreestyleOverview({
      ...payload,
      milestones: { today: '2026-10-23', reminders: [], overdue_count: 2 },
    })
    expect(parsed.milestones.groups).toEqual([])
    expect(parsed.milestones.overdue_count).toBe(2)
  })

  it('drops malformed entries instead of passing them to a render', () => {
    const parsed = parseFreestyleOverview({
      ...payload,
      milestones: {
        today: '2026-10-23',
        groups: [
          { date: '', items: [] },
          { date: '2026-10-31', days_left: 8, items: [{ id: '', title: '无 id' }, { id: 'ok', title: '' }] },
        ],
        overdue_count: 0,
      },
      next_reviews: [{ name: '缺 unit_id' }, { unit_id: 'u3', due_date: '2026-10-26' }],
    })
    expect(parsed.milestones.groups).toHaveLength(1)
    expect(parsed.milestones.groups[0].items).toEqual([])
    expect(parsed.next_reviews).toHaveLength(1)
    expect(parsed.next_reviews[0].interval_days).toBe(0)
  })
})
