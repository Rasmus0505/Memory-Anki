import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimeSessionRecord } from '@/entities/session/model'
import {
  applyTimeRecordFormPatch,
  buildTimeRecordFormState,
  calculateEndedAtFromEffectiveMinutes,
  formatEffectiveSecondsAsMinutes,
  parseEffectiveMinutesToSeconds,
  parseTimeRecordFormState,
  sessionKindOptions,
} from '@/features/profile/model/time-record-form'

const baseRecord: TimeSessionRecord = {
  id: 'record-1',
  kind: 'review',
  palaceId: 12,
  title: '第一节',
  startedAt: '2026-06-09T13:00:00.000',
  endedAt: '2026-06-09T13:08:57.000',
  effectiveSeconds: 537,
  pauseCount: 1,
  completionMethod: 'manual_complete',
  durationEdited: false,
  events: [],
}

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

  it('builds edit form state with minute duration input', () => {
    const form = buildTimeRecordFormState(baseRecord)

    expect(form.effectiveMinutes).toBe('8.95')
    expect(form.startedAt).toBe('2026-06-09T13:00:00')
    expect(form.endedAt).toBe('2026-06-09T13:08:57')
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
    const parsed = parseTimeRecordFormState({
      ...buildTimeRecordFormState(baseRecord),
      effectiveMinutes: '1.5',
      endedAt: '2026-06-09T13:01:30',
    })

    expect('value' in parsed && parsed.value.effectiveSeconds).toBe(90)
  })

  it('infers ended time from started time and effective minutes', () => {
    expect(
      calculateEndedAtFromEffectiveMinutes(
        '2026-06-09T13:00:00',
        '8.95',
      ),
    ).toBe('2026-06-09T13:08:57')
  })

  it('updates ended time when effective minutes are edited', () => {
    const next = applyTimeRecordFormPatch(buildTimeRecordFormState(baseRecord), {
      effectiveMinutes: '30',
    })

    expect(next.durationEdited).toBe(true)
    expect(next.endedAt).toBe('2026-06-09T13:30:00')
  })

  it('updates effective minutes from manual ended time while duration is not edited', () => {
    const next = applyTimeRecordFormPatch(buildTimeRecordFormState(baseRecord), {
      endedAt: '2026-06-09T13:30:00',
    })

    expect(next.effectiveMinutes).toBe('30')
  })

  it('offers quiz as a manual time record kind', () => {
    expect(sessionKindOptions).toContain('quiz')
  })
})
