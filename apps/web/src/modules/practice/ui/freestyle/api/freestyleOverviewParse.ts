import type { FreestyleOverviewCounts, FreestyleOverviewResponse } from '@/shared/api/contracts'

/**
 * The start page must never be taken down by the overview payload.
 *
 * 随心 opens on this read, so a field the running API does not send yet (or a
 * field it renamed) would otherwise reach a render like `milestones.groups.length`
 * and throw `undefined is not an object`, white-screening the whole page. That is
 * exactly what a half-updated pair produced: new frontend, API still answering
 * `milestones: { reminders: [] }`.
 *
 * So every field is read defensively here, once, and consumers get the contract
 * shape: numbers are numbers, lists are lists, and an unknown shape degrades to
 * today-with-nothing rather than an exception. Adding a field to the contract
 * means adding it here too; a missing normalizer entry stays `undefined` and is
 * a visible bug in tests instead of a runtime crash for the learner.
 */

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseCounts(raw: unknown): FreestyleOverviewCounts {
  const counts = asRecord(raw)
  return {
    palaces: asNumber(counts.palaces),
    units: asNumber(counts.units),
    new: asNumber(counts.new),
    review: asNumber(counts.review),
    done: asNumber(counts.done),
    remaining: asNumber(counts.remaining),
    remaining_palaces: asNumber(counts.remaining_palaces),
    remaining_units: asNumber(counts.remaining_units),
  }
}

function parseRound(raw: unknown): NonNullable<FreestyleOverviewResponse['round']> | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const round = asRecord(raw)
  return {
    round_id: asString(round.round_id),
    version: asNumber(round.version),
    counts: parseCounts(round.counts),
    by_subject: asArray<{ subject_id: number | null; name: string; done: number; total: number }>(
      round.by_subject,
    ).map((entry) => {
      const row = asRecord(entry)
      return {
        subject_id: typeof row.subject_id === 'number' ? row.subject_id : null,
        name: asString(row.name),
        done: asNumber(row.done),
        total: asNumber(row.total),
      }
    }),
  }
}

function parseToday(raw: unknown): FreestyleOverviewResponse['today'] {
  const today = asRecord(raw)
  return {
    due_count: asNumber(today.due_count),
    due_palace_count: asNumber(today.due_palace_count),
    overdue_count: asNumber(today.overdue_count),
    new_unit_count: asNumber(today.new_unit_count),
    new_palace_count: asNumber(today.new_palace_count),
  }
}

function parseYesterday(raw: unknown): FreestyleOverviewResponse['yesterday'] {
  const yesterday = asRecord(raw)
  return {
    date: asString(yesterday.date),
    learned_units: asNumber(yesterday.learned_units),
    learned_palace_count: asNumber(yesterday.learned_palace_count),
    weak_units: asArray<{ unit_id: string; name: string; palace_name: string; again_ratio: number }>(
      yesterday.weak_units,
    )
      .map((entry) => {
        const row = asRecord(entry)
        return {
          unit_id: asString(row.unit_id),
          name: asString(row.name),
          palace_name: asString(row.palace_name),
          again_ratio: asNumber(row.again_ratio),
        }
      })
      .filter((row) => row.unit_id !== ''),
  }
}

function parseNextReviews(raw: unknown): FreestyleOverviewResponse['next_reviews'] {
  return asArray<{
    unit_id: string
    name: string
    palace_name: string
    due_date: string
    interval_days: number
  }>(raw)
    .map((entry) => {
      const row = asRecord(entry)
      return {
        unit_id: asString(row.unit_id),
        name: asString(row.name),
        palace_name: asString(row.palace_name),
        due_date: asString(row.due_date),
        interval_days: asNumber(row.interval_days),
      }
    })
    .filter((row) => row.unit_id !== '')
}

function parseMilestones(raw: unknown): FreestyleOverviewResponse['milestones'] {
  const milestones = asRecord(raw)
  const groups = asArray<unknown>(milestones.groups)
    .map((entry) => {
      const group = asRecord(entry)
      const date = asString(group.date)
      if (!date) return null
      return {
        date,
        days_left: asNumber(group.days_left),
        items: asArray<unknown>(group.items)
          .map((item) => {
            const row = asRecord(item)
            const id = asString(row.id)
            const title = asString(row.title)
            if (!id || !title) return null
            return {
              id,
              title,
              category: asString(row.category),
              detail: asString(row.detail),
            }
          })
          .filter((item): item is NonNullable<typeof item> => item !== null),
      }
    })
    .filter((group): group is NonNullable<typeof group> => group !== null)
  return {
    today: asString(milestones.today),
    groups,
    overdue_count: asNumber(milestones.overdue_count),
  }
}

export function parseFreestyleOverview(raw: unknown): FreestyleOverviewResponse {
  const root = asRecord(raw)
  return {
    round: parseRound(root.round),
    milestones: parseMilestones(root.milestones),
    today: parseToday(root.today),
    yesterday: parseYesterday(root.yesterday),
    next_reviews: parseNextReviews(root.next_reviews),
  }
}
