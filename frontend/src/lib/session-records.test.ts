import { describe, expect, it, vi } from 'vitest'
import {
  createTimeRecord,
  getTimeRecordingThresholdSeconds,
  getDailyTrend,
  getSessionKindBreakdown,
  getTimeRecordSummary,
  isTimeRecordAboveThreshold,
  groupTimeRecordsByDate,
  listTimeRecords,
  restoreTimeRecord,
  setTimeRecordingThresholdSeconds,
  softDeleteTimeRecord,
  type TimeSessionRecord,
} from '@/lib/session-records'

function makeRecord(overrides: Partial<TimeSessionRecord>): TimeSessionRecord {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    kind: overrides.kind ?? 'review',
    palaceId: overrides.palaceId ?? 1,
    title: overrides.title ?? '测试记录',
    startedAt: overrides.startedAt ?? '2026-05-08T08:00:00.000Z',
    endedAt: overrides.endedAt ?? '2026-05-08T08:10:00.000Z',
    effectiveSeconds: overrides.effectiveSeconds ?? 600,
    pauseCount: overrides.pauseCount ?? 0,
    completionMethod: overrides.completionMethod ?? 'manual_complete',
    durationEdited: overrides.durationEdited ?? false,
    deletedAt: overrides.deletedAt ?? null,
    deletedReason: overrides.deletedReason ?? null,
    events: overrides.events ?? [],
  }
}

describe('session-records derived helpers', () => {
  it('returns zeroed summary and empty grouping data for empty records', () => {
    const summary = getTimeRecordSummary([], new Date('2026-05-08T12:00:00.000Z'))

    expect(summary.totalRecords).toBe(0)
    expect(summary.totalEffectiveSeconds).toBe(0)
    expect(summary.last7DaysSeconds).toBe(0)
    expect(summary.todaySeconds).toBe(0)
    expect(summary.weekPauseCount).toBe(0)
    expect(summary.longestSession).toBeNull()
    expect(groupTimeRecordsByDate([])).toEqual({})
    expect(getSessionKindBreakdown([])).toEqual([
      { kind: 'review', label: '正式复习', seconds: 0, sessions: 0 },
      { kind: 'practice', label: '练习', seconds: 0, sessions: 0 },
      { kind: 'palace_edit', label: '宫殿编辑', seconds: 0, sessions: 0 },
    ])
  })

  it('groups records by date and summarizes session kind durations', () => {
    const records = [
      makeRecord({ id: 'a', kind: 'review', startedAt: '2026-05-08T08:00:00.000Z', effectiveSeconds: 600 }),
      makeRecord({ id: 'b', kind: 'practice', startedAt: '2026-05-08T10:00:00.000Z', effectiveSeconds: 300 }),
      makeRecord({ id: 'c', kind: 'palace_edit', startedAt: '2026-05-07T09:00:00.000Z', effectiveSeconds: 120 }),
    ]

    const grouped = groupTimeRecordsByDate(records)
    const breakdown = getSessionKindBreakdown(records)

    expect(Object.keys(grouped)).toEqual(['2026-05-08', '2026-05-07'])
    expect(grouped['2026-05-08']).toHaveLength(2)
    expect(grouped['2026-05-07']).toHaveLength(1)
    expect(breakdown).toEqual([
      { kind: 'review', label: '正式复习', seconds: 600, sessions: 1 },
      { kind: 'practice', label: '练习', seconds: 300, sessions: 1 },
      { kind: 'palace_edit', label: '宫殿编辑', seconds: 120, sessions: 1 },
    ])
  })

  it('pads the recent daily trend with zero-value dates', () => {
    const trend = getDailyTrend(
      [
        makeRecord({ startedAt: '2026-05-06T08:00:00.000Z', effectiveSeconds: 90 }),
        makeRecord({ startedAt: '2026-05-08T08:00:00.000Z', effectiveSeconds: 120 }),
      ],
      4,
      new Date('2026-05-08T12:00:00.000Z'),
    )

    expect(trend).toEqual([
      { dateKey: '2026-05-05', label: '5/5', seconds: 0 },
      { dateKey: '2026-05-06', label: '5/6', seconds: 90 },
      { dateKey: '2026-05-07', label: '5/7', seconds: 0 },
      { dateKey: '2026-05-08', label: '5/8', seconds: 120 },
    ])
  })

  it('computes last 7 day totals, today totals, longest session, and weekly pauses', () => {
    const records = [
      makeRecord({ id: 'today', startedAt: '2026-05-08T08:00:00.000Z', effectiveSeconds: 120, pauseCount: 2, title: '今天' }),
      makeRecord({ id: 'week', startedAt: '2026-05-06T09:00:00.000Z', effectiveSeconds: 240, pauseCount: 1, title: '本周' }),
      makeRecord({ id: 'old', startedAt: '2026-04-30T09:00:00.000Z', effectiveSeconds: 600, pauseCount: 5, title: '更早' }),
    ]

    const summary = getTimeRecordSummary(records, new Date('2026-05-08T12:00:00.000Z'))

    expect(summary.totalRecords).toBe(3)
    expect(summary.totalEffectiveSeconds).toBe(960)
    expect(summary.last7DaysSeconds).toBe(360)
    expect(summary.todaySeconds).toBe(120)
    expect(summary.weekPauseCount).toBe(3)
    expect(summary.longestSession?.id).toBe('old')
  })

  it('ignores soft deleted records in derived statistics', () => {
    const records = [
      makeRecord({ id: 'active', effectiveSeconds: 120, pauseCount: 1 }),
      makeRecord({ id: 'deleted', effectiveSeconds: 999, pauseCount: 9, deletedAt: '2026-05-08T09:00:00.000Z', deletedReason: 'manual' }),
    ]

    const summary = getTimeRecordSummary(records, new Date('2026-05-08T12:00:00.000Z'))
    const breakdown = getSessionKindBreakdown(records)

    expect(summary.totalRecords).toBe(1)
    expect(summary.totalEffectiveSeconds).toBe(120)
    expect(summary.weekPauseCount).toBe(1)
    expect(summary.longestSession?.id).toBe('active')
    expect(breakdown[0]?.seconds).toBe(120)
  })

  it('supports create, soft delete, and restore in local storage helpers', () => {
    window.localStorage.clear()

    const created = createTimeRecord({
      title: '手动补录',
      kind: 'practice',
      palaceId: null,
      startedAt: '2026-05-08T08:00:00.000Z',
      endedAt: '2026-05-08T08:10:00.000Z',
      effectiveSeconds: 600,
      pauseCount: 0,
      completionMethod: 'saved',
      durationEdited: true,
      deletedAt: null,
      deletedReason: null,
      events: [],
    })

    expect(listTimeRecords()).toHaveLength(1)

    softDeleteTimeRecord(created.id)
    expect(listTimeRecords()).toHaveLength(0)
    expect(listTimeRecords({ includeDeleted: true })[0]?.deletedReason).toBe('manual')

    restoreTimeRecord(created.id)
    expect(listTimeRecords()).toHaveLength(1)
    expect(listTimeRecords()[0]?.title).toBe('手动补录')
  })

  it('filters records by threshold and can still read complete records when requested', () => {
    window.localStorage.clear()
    setTimeRecordingThresholdSeconds(30)

    expect(getTimeRecordingThresholdSeconds()).toBe(30)
    expect(isTimeRecordAboveThreshold(30)).toBe(false)
    expect(isTimeRecordAboveThreshold(31)).toBe(true)

    expect(
      createTimeRecord({
        title: '30秒',
        kind: 'review',
        palaceId: 1,
        startedAt: '2026-05-08T08:00:00.000Z',
        endedAt: '2026-05-08T08:01:00.000Z',
        effectiveSeconds: 30,
        pauseCount: 0,
        completionMethod: 'manual_complete',
        durationEdited: false,
        deletedAt: null,
        deletedReason: null,
        events: [],
      }),
    ).toBeNull()

    createTimeRecord({
      title: '31秒',
      kind: 'review',
      palaceId: 1,
      startedAt: '2026-05-08T08:00:00.000Z',
      endedAt: '2026-05-08T08:01:00.000Z',
      effectiveSeconds: 31,
      pauseCount: 0,
      completionMethod: 'manual_complete',
      durationEdited: false,
      deletedAt: null,
      deletedReason: null,
      events: [],
    })

    window.localStorage.setItem(
      'memory-anki.time-records.v1',
      JSON.stringify([
        makeRecord({ id: 'history-short', title: '历史短记录', effectiveSeconds: 29 }),
        makeRecord({ id: 'history-long', title: '历史长记录', effectiveSeconds: 40 }),
      ]),
    )

    expect(listTimeRecords().map((record) => record.title)).toEqual(['历史长记录'])
    expect(listTimeRecords({ includeBelowThreshold: true }).map((record) => record.title)).toEqual(['历史短记录', '历史长记录'])
  })
})
