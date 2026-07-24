import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimeSessionRecord } from '@/modules/session/public'
import {
  applyTimeRecordFormPatch,
  applyTimeRecordQuickAddPatch,
  buildTimeRecordFormState,
  buildTimeRecordQuickAddFormState,
  calculateEndedAtFromEffectiveMinutes,
  formatEffectiveSecondsAsMinutes,
  formatTableDateTime,
  formatTableTime,
  parseEffectiveMinutesToSeconds,
  parseTimeRecordFormState,
  parseTimeRecordQuickAddFormState,
  sessionKindOptions,
} from '@/modules/settings/ui/profile/model/time-record-form'
import { formatLocalDateTimeInputValue } from '@/shared/lib/dateTime'

// Absolute UTC instants; form fields show the host local wall clock.
const baseRecord: TimeSessionRecord = {
  id: 'record-1',
  kind: 'review',
  palaceId: 12,
  title: '第一节',
  startedAt: '2026-06-09T05:00:00.000Z',
  endedAt: '2026-06-09T05:08:57.000Z',
  effectiveSeconds: 537,
  pauseCount: 1,
  completionMethod: 'manual_complete',
  durationEdited: false,
  events: [],
}

const localStarted = formatLocalDateTimeInputValue(baseRecord.startedAt)
const localEnded = formatLocalDateTimeInputValue(baseRecord.endedAt)

describe('time-record-form', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('displays effective duration in minutes while preserving seconds precision', () => {
    expect(formatEffectiveSecondsAsMinutes(537)).toBe('8.95')
    expect(formatEffectiveSecondsAsMinutes(3600)).toBe('60')
    expect(parseEffectiveMinutesToSeconds('8.95')).toBe(537)
  })

  it('formats table times with 0–23 hour clock (never 24:xx at midnight)', () => {
    // 16:24:42Z → 00:24:42 in China (UTC+8). h24 environments would show 24:24:42.
    const chinaMidnight = '2026-07-23T16:24:42.000Z'
    const time = formatTableTime(chinaMidnight)
    const dateTime = formatTableDateTime(chinaMidnight)
    expect(time).toMatch(/^00:24:42$/)
    expect(time).not.toMatch(/^24:/)
    expect(dateTime).toContain('00:24:42')
    expect(dateTime).not.toMatch(/\s24:/)
  })

  it('builds edit form state with minute duration input', () => {
    const form = buildTimeRecordFormState(baseRecord)

    expect(form.effectiveMinutes).toBe('8.95')
    expect(form.startedAt).toBe(localStarted)
    expect(form.endedAt).toBe(localEnded)
  })

  it('builds create form state with current time defaults', () => {
    vi.setSystemTime(new Date('2026-06-12T12:53:41'))

    const form = buildTimeRecordFormState()

    expect(form.title).toBe('2026-06-12 12:53:41')
    expect(form.startedAt).toBe('2026-06-12T12:53:41')
    expect(form.endedAt).toBe('2026-06-12T12:53:41')
    expect(form.effectiveMinutes).toBe('0')
  })

  it('parses minute input back to effective seconds for persistence', () => {
    const form = buildTimeRecordFormState(baseRecord)
    const parsed = parseTimeRecordFormState({
      ...form,
      effectiveMinutes: '1.5',
      endedAt: calculateEndedAtFromEffectiveMinutes(form.startedAt, '1.5') ?? form.endedAt,
    })

    expect('value' in parsed && parsed.value.effectiveSeconds).toBe(90)
    if ('value' in parsed) {
      // API payload must be UTC with Z, not local wall clock.
      expect(parsed.value.startedAt.endsWith('Z')).toBe(true)
      expect(parsed.value.endedAt.endsWith('Z')).toBe(true)
    }
  })

  it('infers ended time from started time and effective minutes', () => {
    expect(
      calculateEndedAtFromEffectiveMinutes(localStarted, '8.95'),
    ).toBe(localEnded)
  })

  it('updates ended time when effective minutes are edited', () => {
    const next = applyTimeRecordFormPatch(buildTimeRecordFormState(baseRecord), {
      effectiveMinutes: '30',
    })

    expect(next.durationEdited).toBe(true)
    expect(next.endedAt).toBe(
      calculateEndedAtFromEffectiveMinutes(localStarted, '30'),
    )
  })

  it('updates effective minutes from manual ended time while duration is not edited', () => {
    const thirtyMinEnded =
      calculateEndedAtFromEffectiveMinutes(localStarted, '30') ?? localEnded
    const next = applyTimeRecordFormPatch(buildTimeRecordFormState(baseRecord), {
      endedAt: thirtyMinEnded,
    })

    expect(next.effectiveMinutes).toBe('30')
  })

  it('offers quiz as a manual time record kind', () => {
    expect(sessionKindOptions).toContain('quiz')
  })

  it('builds quick-add form with tag and integer minutes defaults', () => {
    vi.setSystemTime(new Date('2026-07-21T15:30:00'))
    const form = applyTimeRecordQuickAddPatch(
      buildTimeRecordQuickAddFormState(),
      {},
      [{ id: 'tag_paper', name: '论文', createdAt: '2026-07-21T00:00:00.000Z' }],
    )

    expect(form.tagId).toBe('review')
    expect(form.minutes).toBe('30')
    expect(form.date).toBe('2026-07-21')
    expect(form.title).toContain('正式复习')
  })

  it('parses quick-add form into custom tag payload', () => {
    vi.setSystemTime(new Date('2026-07-21T15:30:00'))
    const form = applyTimeRecordQuickAddPatch(
      buildTimeRecordQuickAddFormState(),
      { tagId: 'tag_paper', minutes: '45' },
      [{ id: 'tag_paper', name: '论文', createdAt: '2026-07-21T00:00:00.000Z' }],
    )
    const parsed = parseTimeRecordQuickAddFormState(form, [
      { id: 'tag_paper', name: '论文', createdAt: '2026-07-21T00:00:00.000Z' },
    ])

    expect('value' in parsed).toBe(true)
    if (!('value' in parsed)) return
    expect(parsed.value.kind).toBe('custom')
    expect(parsed.value.effectiveSeconds).toBe(2700)
    expect(parsed.value.activityTag).toBe('tag_paper')
    expect(parsed.value.activityTagLabel).toBe('论文')
    expect(parsed.value.durationEdited).toBe(true)
  })
})
