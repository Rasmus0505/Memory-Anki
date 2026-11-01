import { describe, expect, it } from 'vitest'
import { beijingStudyDay } from '@/shared/lib/dateTime'
import { isoDateFromStudyDay, studyDayStart, toIsoDate } from './scheduleLimits'

describe('studyDayStart', () => {
  it('uses the Beijing study day instead of the browser timezone', () => {
    // 00:30 Beijing on 11-01 still belongs to the 10-31 study day.
    const instant = new Date('2026-10-31T16:30:00Z')

    expect(beijingStudyDay(instant)).toBe('2026-10-31')
    expect(toIsoDate(studyDayStart(instant))).toBe('2026-10-31')
  })

  it('rolls over at 03:00 Beijing', () => {
    const instant = new Date('2026-10-31T19:00:00Z')

    expect(beijingStudyDay(instant)).toBe('2026-11-01')
    expect(toIsoDate(studyDayStart(instant))).toBe('2026-11-01')
  })

  it('counts a manual preset from the study day, not the calendar day', () => {
    const afterMidnight = new Date('2026-10-31T16:30:00Z')

    expect(isoDateFromStudyDay(1, afterMidnight)).toBe('2026-11-01')
  })
})
