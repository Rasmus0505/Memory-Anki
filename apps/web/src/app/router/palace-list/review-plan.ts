import type { PalaceReviewPlanResponse } from '@/shared/api/contracts'

export interface ReviewPlanDayGroup {
  date: string
  items: PalaceReviewPlanResponse['plan']
  completedCount: number
  pendingCount: number
}

export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

export function formatPlanDate(value: string | null): string {
  if (!value) return '未设置'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date).replace(/\//g, '-')
}

function formatPlanType(item: PalaceReviewPlanResponse['plan'][number]): string {
  return `${item.interval_days}天`
}

export function formatPlanSummary(item: PalaceReviewPlanResponse['plan'][number]) {
  const parts = [`间隔 ${formatPlanType(item)}`]
  if (item.pending_count > 1) {
    parts.push(`累计 ${item.pending_count} 次待复习`)
  }
  if (item.completed_count > 0) {
    parts.push(`已完成 ${item.completed_count} 次`)
  }
  return parts.join(' · ')
}

export function parsePlanDate(value: string): Date {
  return new Date(`${value}T00:00:00`)
}

export function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function addMonths(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1)
}

export function getMonthLabel(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
  }).format(date)
}

export function getMonthGrid(month: Date): Date[] {
  const start = getMonthStart(month)
  const startWeekday = (start.getDay() + 6) % 7
  const gridStart = new Date(start)
  gridStart.setDate(start.getDate() - startWeekday)

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart)
    day.setDate(gridStart.getDate() + index)
    return day
  })
}

export function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getDayGroup(
  plan: PalaceReviewPlanResponse['plan'],
): Map<string, ReviewPlanDayGroup> {
  return plan.reduce((map, item) => {
    if (!item.date) return map

    const existing = map.get(item.date)
    if (existing) {
      existing.items.push(item)
      existing.completedCount += item.completed_count
      existing.pendingCount += item.pending_count
      return map
    }

    map.set(item.date, {
      date: item.date,
      items: [item],
      completedCount: item.completed_count,
      pendingCount: item.pending_count,
    })
    return map
  }, new Map<string, ReviewPlanDayGroup>())
}
