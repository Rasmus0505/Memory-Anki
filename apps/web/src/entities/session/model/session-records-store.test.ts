import { describe, expect, it } from 'vitest'
import {
  cleanupLegacyPracticeProgressStorage,
  getAllDailyTrend,
  getSessionKindBreakdown,
  getTrendByRange,
  type TimeSessionRecord,
} from '@/entities/session/model'

function buildRecord(
  id: string,
  kind: TimeSessionRecord['kind'],
  startedAt: string,
  effectiveSeconds: number,
  deletedAt: string | null = null,
): TimeSessionRecord {
  return {
    id,
    kind,
    palaceId: 1,
    sourceKind: 'palace',
    englishCourseId: null,
    title: id,
    startedAt,
    endedAt: startedAt,
    effectiveSeconds,
    pauseCount: 0,
    completionMethod: 'manual_complete',
    durationEdited: false,
    deletedAt,
    deletedReason: deletedAt ? 'manual' : null,
    events: [],
  }
}

describe('session-record chart helpers', () => {
  const reference = new Date(2026, 5, 12, 12, 0, 0)

  it('builds fixed-day trends with the requested length', () => {
    const records = [
      buildRecord('recent', 'review', '2026-06-12T08:00:00', 600),
      buildRecord('month', 'practice', '2026-05-20T08:00:00', 900),
      buildRecord('quarter', 'palace_edit', '2026-03-20T08:00:00', 1200),
    ]

    expect(getTrendByRange(records, 7, reference)).toHaveLength(7)
    expect(getTrendByRange(records, 30, reference)).toHaveLength(30)
    expect(getTrendByRange(records, 90, reference)).toHaveLength(90)
  })

  it('fills all-trend from the earliest valid record to today', () => {
    const records = [
      buildRecord('first', 'review', '2026-06-09T08:00:00', 600),
      buildRecord('last', 'practice', '2026-06-12T08:00:00', 900),
    ]

    const trend = getAllDailyTrend(records, reference)

    expect(trend).toHaveLength(4)
    expect(trend.map((point) => point.label)).toEqual([
      '6/9',
      '6/10',
      '6/11',
      '6/12',
    ])
    expect(trend.map((point) => point.seconds)).toEqual([600, 0, 0, 900])
  })

  it('filters breakdown by range and ignores deleted records', () => {
    const records = [
      buildRecord('recent-review', 'review', '2026-06-11T08:00:00', 600),
      buildRecord('older-practice', 'practice', '2026-05-10T08:00:00', 900),
      buildRecord('recent-quiz', 'quiz', '2026-06-12T08:00:00', 300),
      buildRecord(
        'deleted-edit',
        'palace_edit',
        '2026-06-10T08:00:00',
        1200,
        '2026-06-10T09:00:00',
      ),
    ]

    expect(getSessionKindBreakdown(records, 7, reference)).toEqual([
      { kind: 'review', label: '正式复习', seconds: 600, sessions: 1 },
      { kind: 'practice', label: '练习', seconds: 0, sessions: 0 },
      { kind: 'quiz', label: '做题', seconds: 300, sessions: 1 },
      { kind: 'palace_edit', label: '宫殿编辑', seconds: 0, sessions: 0 },
    ])

    expect(getSessionKindBreakdown(records, 'all', reference)).toEqual([
      { kind: 'review', label: '正式复习', seconds: 600, sessions: 1 },
      { kind: 'practice', label: '练习', seconds: 900, sessions: 1 },
      { kind: 'quiz', label: '做题', seconds: 300, sessions: 1 },
      { kind: 'palace_edit', label: '宫殿编辑', seconds: 0, sessions: 0 },
    ])
  })
})

describe('cleanupLegacyPracticeProgressStorage', () => {
  it('removes the retired practice progress localStorage key', () => {
    const legacyKey = ['memory-anki', ['practice', 'progress'].join('-'), 'v1'].join('.')

    window.localStorage.setItem(legacyKey, '{"1":{"completed":false}}')

    cleanupLegacyPracticeProgressStorage()

    expect(window.localStorage.getItem(legacyKey)).toBeNull()
  })
})
