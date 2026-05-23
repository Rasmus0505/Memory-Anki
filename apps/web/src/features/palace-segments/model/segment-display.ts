import type { PalaceSegmentSummary } from '@/shared/api/contracts'
import { formatApiDate, formatApiDateTime, parseApiDateTime } from '@/shared/lib/dateTime'

export function formatSegmentDateTime(value: string | null) {
  return value ? formatApiDateTime(value).slice(0, 16) : '未设置'
}

export function formatRelativeReviewTime(value: string | null): string {
  if (!value) return '未排入正式复习'
  const target = parseApiDateTime(value)
  if (Number.isNaN(target.getTime())) return '未排入正式复习'

  const diffMs = target.getTime() - Date.now()
  if (diffMs <= 0) return '开始复习'

  const totalMinutes = Math.floor(diffMs / (1000 * 60))
  const totalHours = Math.floor(diffMs / (1000 * 60 * 60))
  const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (totalMinutes < 60) {
    return `${Math.max(1, totalMinutes)}分钟`
  }

  if (totalHours < 24) {
    const hours = totalHours
    const minutes = totalMinutes % 60
    return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`
  }

  if (totalDays < 30) {
    const days = totalDays
    const hours = totalHours % 24
    return hours > 0 ? `${days}天${hours}小时` : `${days}天`
  }

  const months = Math.floor(totalDays / 30)
  const days = totalDays % 30
  return days > 0 ? `${months}月${days}天` : `${months}月`
}

export function formatCreatedAt(value: string | null): string {
  return formatApiDate(value)
}

export function getSegmentDisplayName(
  segment: PalaceSegmentSummary,
  index: number,
): string {
  if (segment.display_name) return segment.display_name
  if (segment.is_virtual_default) return '第 1 部分'
  if (/^第\s*1\s*部分$/.test(segment.name)) {
    return `第 ${index + 1} 部分`
  }
  return segment.name
}
