import { beijingStudyDay } from '@/shared/lib/dateTime'
import { INTERVAL_BAND_BOUNDS } from './intervalBands'

/**
 * The latest due date the scheduler can produce: the top band plus the same
 * ±5% spread a top-stage booking may add (`unit_scheduler.latest_schedulable_due`).
 * The server rejects anything later with 「到期日不能超过一年」.
 */
export function schedulableDueMax(now = new Date()) {
  const top = INTERVAL_BAND_BOUNDS[INTERVAL_BAND_BOUNDS.length - 1]
  const span = Math.max(1, Math.round(top * 0.05))
  const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  limit.setDate(limit.getDate() + top + span)
  return toIsoDate(limit)
}

export function toIsoDate(value: Date) {
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

/**
 * The study day the server would use: it rolls over at 03:00 Beijing time, so
 * 01:00 still belongs to yesterday. Manual presets ("明天") must count from that
 * day or an after-midnight tap books a date the learner did not pick.
 *
 * The calendar parts come from `beijingStudyDay`, not from the browser's local
 * timezone. A Windows install left on UTC otherwise disagrees with the server
 * about "today" for eight hours a day, and the preset books the wrong date.
 */
export function studyDayStart(now = new Date()) {
  const [year, month, day] = beijingStudyDay(now).split('-').map(Number)
  if (!year || !month || !day) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }
  return new Date(year, month - 1, day)
}

export function isoDateFromStudyDay(daysFromToday: number, now = new Date()) {
  const target = studyDayStart(now)
  target.setDate(target.getDate() + daysFromToday)
  return toIsoDate(target)
}

export function intervalDaysUntil(isoDate: string, now = new Date()) {
  const [year, month, day] = isoDate.split('-').map(Number)
  if (!year || !month || !day) return null
  const target = new Date(year, month - 1, day)
  const anchor = studyDayStart(now)
  return Math.max(0, Math.round((target.getTime() - anchor.getTime()) / 86_400_000))
}
